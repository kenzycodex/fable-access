import time
import uuid

from fastapi import APIRouter, Request

from models.schemas import ShieldAnalyzeRequest, ShieldAnalyzeResponse, FeedbackRequest
from agents.shield.analyzer import analyze_transaction_safe
from agents.copilot.baseline import log_transaction
from tenancy import resolve_institution

router = APIRouter(prefix="/v1/shield", tags=["shield"])


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
            return ShieldAnalyzeResponse(
                risk_score=existing["risk_score"] or 0.0,
                risk_level=existing["risk_level"] or "LOW",
                action=existing["action_taken"] or "PASS",
                signals=loads(existing["shield_signals"], []) or [],
                explanation="Previously scored offline; synced without rescoring.",
                latency_ms=0.0,
                transaction_id=existing["id"],
            )

    result = analyze_transaction_safe(payload.user_id, transaction, device, context, institution_id)

    latency_ms = round((time.perf_counter() - start) * 1000, 2)
    transaction_id = f"txn_{uuid.uuid4().hex[:12]}"
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
        latency_ms=latency_ms,
    )

    return ShieldAnalyzeResponse(
        risk_score=result["risk_score"],
        risk_level=result["risk_level"],
        action=result["action"],
        signals=result["signals"],
        explanation=result["explanation"],
        latency_ms=latency_ms,
        transaction_id=transaction_id,
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
