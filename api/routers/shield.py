import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Request

from agents.copilot.baseline import log_transaction
from agents.shield.analyzer import analyze_transaction_safe
from agents.shield.explainer import generate_llm_explanation, llm_available
from core.tenancy import customer_guard, require_role, scoring_guard
from models.schemas import (
    FeedbackRequest,
    ShieldAnalyzeRequest,
    ShieldAnalyzeResponse,
    ShieldExplanationResponse,
)
from services import audit, notifications, webhooks
from services.accounts import InsufficientFunds, assert_can_spend, debit

router = APIRouter(prefix="/v1/shield", tags=["shield"])

# Explanation work runs on its own small pool rather than FastAPI's
# BackgroundTasks. BackgroundTasks share the threadpool that also serves sync
# request handlers, so a burst of in-flight LLM calls pushed decision p95 from
# 131ms to 206ms — prose competing with verdicts for the same threads, which is
# exactly the coupling this change exists to remove. Two workers is deliberate:
# the queue is allowed to back up, because a late explanation costs nothing and
# a late decision costs everything.
_explainer_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fable-explainer")


def _upgrade_explanation(transaction_id: str, signals: list[str], amount: float, action: str) -> None:
    """Generate polished prose after the response has already gone out.

    Nothing here is on the caller's clock. A failure leaves the deterministic
    template in place, which is a complete and accurate explanation in its own
    right.
    """
    from core.db import cursor

    text, elapsed_ms = generate_llm_explanation(signals, amount, action)
    if not text:
        return
    try:
        with cursor() as cur:
            cur.execute(
                """UPDATE transactions
                   SET explanation = ?, explanation_ms = ?, explanation_source = 'llm'
                   WHERE id = ?""",
                (text, elapsed_ms, transaction_id),
            )
    except Exception:
        pass


def _record_shadow(transaction_id: str, result: dict, channel: str | None, institution_id: str | None) -> None:
    """Re-weight the decision's own signals under the shadow version, if any.

    Runs after the live row is written. It re-adds stored score parts, so it
    costs microseconds and calls nothing external. Any error is logged and
    ignored: shadow mode exists to observe, and it must never cost a decision.
    """
    try:
        from services import engine_admin

        engine_admin.record_shadow(transaction_id, result, channel, institution_id)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("fable.engine").warning("Shadow scoring skipped: %s", type(exc).__name__)


@router.post("/analyze", response_model=ShieldAnalyzeResponse, dependencies=[Depends(scoring_guard)])
def analyze(payload: ShieldAnalyzeRequest, request: Request):
    start = time.perf_counter()

    transaction = payload.transaction.model_dump()
    device = payload.device.model_dump() if payload.device else {}
    context = payload.context.model_dump() if payload.context else {}

    # Server-observed client IP as a fallback when the SDK didn't send one.
    if not device.get("ip") and request.client:
        device["ip"] = request.client.host

    # The bank comes from the caller's credential; the guard has already
    # replaced the customer reference with this bank's customer id.
    institution_id = request.state.institution_id
    customer_ref = request.state.customer["external_ref"]
    sandbox = request.state.mode != "live"

    # A saved recipient arrives as a token issued to this customer; the account
    # number behind it is filled in here, server side.
    from services.sandbox_recipients import apply_token

    apply_token(transaction, request.state.customer["id"])

    # A replayed offline transfer must be recognised, not re-scored. Returning
    # the original decision keeps the customer's history and the console
    # consistent no matter how many times the client retries.
    if payload.client_reference:
        from core.db import cursor, loads

        with cursor() as cur:
            cur.execute(
                """SELECT id, risk_score, risk_level, action_taken, shield_signals, engine_version
                   FROM transactions WHERE institution_id = ? AND client_reference = ?""",
                (institution_id, payload.client_reference),
            )
            existing = cur.fetchone()
        if existing:
            replay_ms = round((time.perf_counter() - start) * 1000, 2)
            return ShieldAnalyzeResponse(
                risk_score=existing["risk_score"] or 0.0,
                risk_level=existing["risk_level"] or "LOW",
                action=existing["action_taken"] or "PASS",
                signals=loads(existing["shield_signals"], []) or [],
                explanation="Previously scored offline; synced without rescoring.",
                latency_ms=replay_ms,
                decision_ms=replay_ms,
                explanation_source="template",
                transaction_id=existing["id"],
                engine_version=existing["engine_version"],
            )

    # Funds are checked before scoring, for two reasons. Scoring a transfer
    # that cannot execute burns an LLM call for nothing, and a
    # declined-for-funds transfer is not a fraud signal — recording it as one
    # would teach Copilot that the customer's normal includes transfers they
    # never actually made.
    #
    # Only in the sandbox, where Fable keeps a simulated ledger. A live bank
    # checks funds in its own core banking system before it asks for a score.
    if sandbox:
        try:
            assert_can_spend(payload.user_id, transaction["amount"], institution_id)
        except InsufficientFunds as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "insufficient_funds",
                    "message": str(exc),
                    "available": exc.available,
                    "requested": exc.requested,
                    "shortfall": exc.shortfall,
                },
            )

    result = analyze_transaction_safe(payload.user_id, transaction, device, context, institution_id)

    # The verdict is final here. Everything after this point is bookkeeping and
    # prose, so this is where the budgeted clock stops: a payment rail waits
    # for the decision, not for the sentence describing it.
    decision_ms = round((time.perf_counter() - start) * 1000, 2)
    transaction_id = f"txn_{uuid.uuid4().hex[:12]}"

    # A template explanation means no cached prose existed for this decision
    # shape, so a proper write-up is queued off the request path below. It has
    # to be queued *after* the row exists: the worker updates the transaction
    # by id, and racing the insert would leave it updating nothing.
    explanation_source = result.get("explanation_source", "template")
    pending = explanation_source == "template" and result["action"] != "PASS" and llm_available()

    log_transaction(
        user_id=payload.user_id,
        transaction_id=transaction_id,
        transaction=transaction,
        device_fingerprint=device.get("fingerprint_id"),
        risk_score=result["risk_score"],
        risk_level=result["risk_level"],
        action_taken=result["action"],
        signals=result["signals"],
        confirmed_legitimate=(result["action"] == "PASS"),
        device=device,
        context=context,
        institution_id=institution_id,
        client_reference=payload.client_reference,
        latency_ms=round((time.perf_counter() - start) * 1000, 2),
        decision_ms=decision_ms,
        explanation=result["explanation"],
        explanation_source=explanation_source,
        score_parts=result.get("score_parts"),
        engine_version=result.get("engine_version"),
        engine_params_hash=result.get("engine_params_hash"),
    )

    # The live decision is committed. Only now, and never able to change it,
    # the shadow version (if one is running) scores the same signals.
    _record_shadow(transaction_id, result, transaction.get("channel"), institution_id)

    # Tell the customer, in-app, that this was stopped or questioned. Recorded
    # only for real decisions: seeded history bypasses this endpoint entirely,
    # which is why the feed shows what actually happened to the customer rather
    # than 90 days of backfill nobody was ever notified about.
    if result["action"] in ("BLOCK", "FLAG"):
        try:
            notifications.notify_decision(
                payload.user_id, institution_id, transaction_id, result["action"],
                transaction.get("amount", 0), transaction.get("recipient_name"),
                result["explanation"],
            )
        except Exception:  # noqa: BLE001 — a notification must never fail a decision
            pass
    # Every decision is an event, including a pass: a bank that waits on the
    # webhook rather than the response needs to hear about all three.
    webhooks.emit(
        institution_id,
        {"BLOCK": "transaction.blocked", "FLAG": "transaction.flagged"}.get(result["action"], "transaction.passed"),
        {
            "id": transaction_id,
            "user_id": payload.user_id,
            "customer_ref": customer_ref,
            "amount": transaction.get("amount"),
            "recipient_account": transaction.get("recipient_account"),
            "recipient_bank": transaction.get("recipient_bank"),
            "channel": transaction.get("channel"),
            "risk_score": result["risk_score"],
            "action_taken": result["action"],
            "signals": list(result["signals"]),
            "explanation": result["explanation"],
        },
    )

    # Row is committed; the write-up worker now has something to update. It
    # also populates the cache, so the next decision of this shape resolves
    # synchronously with no LLM call at all.
    if pending:
        _explainer_pool.submit(
            _upgrade_explanation,
            transaction_id,
            list(result["signals"]),
            transaction["amount"],
            result["action"],
        )

    # A cleared transfer moves money now. Anything flagged or blocked does
    # not: it is either abandoned or routed into Ghost, and Ghost reserves
    # rather than debits so the funds stay recoverable.
    if result["action"] == "PASS" and sandbox:
        debit(
            payload.user_id, transaction["amount"], institution_id,
            transaction_id=transaction_id, reference=f"txn:{transaction_id}",
        )

    return ShieldAnalyzeResponse(
        risk_score=result["risk_score"],
        risk_level=result["risk_level"],
        action=result["action"],
        signals=result["signals"],
        explanation=result["explanation"],
        latency_ms=round((time.perf_counter() - start) * 1000, 2),
        decision_ms=decision_ms,
        explanation_source="pending" if pending else explanation_source,
        transaction_id=transaction_id,
        engine_version=result.get("engine_version"),
    )


@router.get("/explanation/{transaction_id}", response_model=ShieldExplanationResponse,
            dependencies=[Depends(customer_guard)])
def explanation(transaction_id: str):
    """Collect the polished write-up for a decision already returned.

    The client shows the template immediately and calls this to swap in better
    prose when it lands. `ready` false means generation is still running; the
    explanation returned alongside it is the template, which is always valid to
    keep displaying.
    """
    from core.db import cursor

    with cursor() as cur:
        cur.execute(
            """SELECT explanation, explanation_source, explanation_ms, engine_version
               FROM transactions WHERE id = ?""",
            (transaction_id,),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Unknown transaction")

    source = row["explanation_source"] or "template"
    return ShieldExplanationResponse(
        transaction_id=transaction_id,
        explanation=row["explanation"] or "",
        explanation_source=source,
        ready=source in ("llm", "cache"),
        explanation_ms=row["explanation_ms"],
        engine_version=row["engine_version"],
    )


@router.post("/feedback")
def feedback(payload: FeedbackRequest, request: Request):
    """The bank's verdict on a decision, from its own systems.

    This used to accept anyone's word for any transaction: no credential and no
    tenant check, so a caller could relabel another bank's fraud as legitimate
    and teach Copilot that it was normal. It now needs the institution's API key
    or a console session, and only touches that institution's transactions.
    It is the API equivalent of resolving a case in the review queue.
    """
    from datetime import datetime, timezone

    from core.db import cursor

    who = require_role(request, "analyst")
    outcome = "fraud" if payload.was_fraud else "legitimate"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with cursor() as cur:
        cur.execute(
            """UPDATE transactions
               SET confirmed_legitimate = ?, review_outcome = ?, reviewed_by = ?, reviewed_at = ?,
                   review_state = CASE WHEN action_taken IN ('FLAG','BLOCK') THEN 'resolved' ELSE review_state END
               WHERE id = ? AND institution_id = ?""",
            (0 if payload.was_fraud else 1, outcome, who["email"], now, payload.transaction_id, who["inst"]),
        )
        found = cur.rowcount > 0
    if not found:
        raise HTTPException(status_code=404, detail="Unknown transaction")
    audit.record(audit.FEEDBACK_RECORDED, payload.user_id, institution_id=who["inst"],
                 transaction_id=payload.transaction_id, outcome=outcome, by=who["email"])
    return {"status": "recorded", "transaction_id": payload.transaction_id, "outcome": outcome}
