import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Request

from models.schemas import (
    ShieldAnalyzeRequest,
    ShieldAnalyzeResponse,
    ShieldExplanationResponse,
    FeedbackRequest,
)
from agents.shield.analyzer import analyze_transaction_safe
from agents.shield.explainer import generate_llm_explanation, llm_available
from agents.copilot.baseline import log_transaction
from tenancy import resolve_institution
from accounts import InsufficientFunds, assert_can_spend, debit

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
    from db import cursor

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


@router.post("/analyze", response_model=ShieldAnalyzeResponse)
def analyze(payload: ShieldAnalyzeRequest, request: Request):
    start = time.perf_counter()

    transaction = payload.transaction.model_dump()
    device = payload.device.model_dump() if payload.device else {}
    context = payload.context.model_dump() if payload.context else {}

    # Server-observed client IP as a fallback when the SDK didn't send one.
    if not device.get("ip") and request.client:
        device["ip"] = request.client.host

    institution_id = resolve_institution(request, payload.institution_id)

    # A replayed offline transfer must be recognised, not re-scored. Returning
    # the original decision keeps the customer's history and the console
    # consistent no matter how many times the client retries.
    if payload.client_reference:
        from db import cursor, loads

        with cursor() as cur:
            cur.execute(
                """SELECT id, risk_score, risk_level, action_taken, shield_signals
                   FROM transactions WHERE client_reference = ?""",
                (payload.client_reference,),
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
            )

    # Funds are checked before scoring, for two reasons. Scoring a transfer
    # that cannot execute burns an LLM call for nothing, and a
    # declined-for-funds transfer is not a fraud signal — recording it as one
    # would teach Copilot that the customer's normal includes transfers they
    # never actually made.
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
    if result["action"] == "PASS":
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
    )


@router.get("/explanation/{transaction_id}", response_model=ShieldExplanationResponse)
def explanation(transaction_id: str):
    """Collect the polished write-up for a decision already returned.

    The client shows the template immediately and calls this to swap in better
    prose when it lands. `ready` false means generation is still running; the
    explanation returned alongside it is the template, which is always valid to
    keep displaying.
    """
    from db import cursor

    with cursor() as cur:
        cur.execute(
            """SELECT explanation, explanation_source, explanation_ms
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
    )


@router.post("/feedback")
def feedback(payload: FeedbackRequest):
    from db import cursor

    with cursor() as cur:
        cur.execute(
            "UPDATE transactions SET confirmed_legitimate = ? WHERE id = ?",
            (0 if payload.was_fraud else 1, payload.transaction_id),
        )
    return {"status": "recorded", "transaction_id": payload.transaction_id}
