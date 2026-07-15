from typing import Literal, Optional
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    amount: float
    currency: str = "NGN"
    recipient_id: Optional[str] = None
    recipient_account: str
    recipient_bank_code: Optional[str] = None
    recipient_bank: Optional[str] = None
    narration: str = ""
    channel: Literal["mobile_app", "ussd", "pos", "internet", "atm", "qr", "branch", "unknown"] = "mobile_app"
    nip_response_code: Optional[str] = None
    # PCI fields accepted but always stripped before processing
    card_number: Optional[str] = None
    cvv: Optional[str] = None
    pin: Optional[str] = None
    track_data: Optional[str] = None


class Device(BaseModel):
    fingerprint_id: Optional[str] = None
    timezone: Optional[str] = "Africa/Lagos"
    hardware_concurrency: Optional[int] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None


class Context(BaseModel):
    session_duration_seconds: Optional[int] = None
    previous_failed_attempts: Optional[int] = 0


class ShieldAnalyzeRequest(BaseModel):
    user_id: str
    transaction: Transaction
    device: Optional[Device] = Device()
    context: Optional[Context] = Context()


class ShieldAnalyzeResponse(BaseModel):
    risk_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    action: Literal["PASS", "FLAG", "BLOCK"]
    signals: list[str]
    explanation: str
    agent: str = "fable-shield-v1"
    latency_ms: float
    transaction_id: str


class GhostCreateRequest(BaseModel):
    user_id: str
    transaction: Transaction
    risk_score: float
    explanation: str = ""


class GhostActionRequest(BaseModel):
    user_id: str


class FeedbackRequest(BaseModel):
    user_id: str
    transaction_id: str
    was_fraud: bool


class DemoSeedRequest(BaseModel):
    user_id: str = "demo_user_001"
    days: int = 90
