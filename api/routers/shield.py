import time
import uuid

from fastapi import APIRouter, Request

from models.schemas import ShieldAnalyzeRequest, ShieldAnalyzeResponse, FeedbackRequest
from agents.shield.analyzer import analyze_transaction_safe
from agents.copilot.baseline import log_transaction

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

    result = analyze_transaction_safe(payload.user_id, transaction, device, context)

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
    )

    latency_ms = (time.perf_counter() - start) * 1000

    return ShieldAnalyzeResponse(
        risk_score=result["risk_score"],
        risk_level=result["risk_level"],
        action=result["action"],
        signals=result["signals"],
        explanation=result["explanation"],
        latency_ms=round(latency_ms, 2),
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
