from typing import Literal, Optional
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    # Bounded on both sides. Unbounded, a zero or negative amount tripped no
    # signal (nothing is "3x above baseline" when it is negative), scored 0.0,
    # and passed the funds check because `-1000 > available` is false — so it
    # reached debit() as a PASS. The upper bound is a sanity ceiling, well above
    # any legitimate NIP transfer.
    amount: float = Field(gt=0, le=1_000_000_000)
    # Single-currency until conversion exists. Accepting free text meant a
    # "USD" transfer of 100 was scored and debited as ₦100.
    currency: Literal["NGN"] = "NGN"
    recipient_id: Optional[str] = None
    recipient_account: str
    recipient_bank_code: Optional[str] = None
    recipient_bank: Optional[str] = None
    # The resolved account holder, exactly as the bank returned it.
    recipient_name: Optional[str] = None
    narration: str = Field(default="", max_length=500)
    channel: Literal["mobile_app", "ussd", "pos", "internet", "atm", "qr", "branch", "unknown"] = "mobile_app"
    # NIP response codes come from the rail, never from the caller. This field
    # is retained so existing clients don't break, but `analyze_transaction`
    # ignores it — see the note there. A signal worth up to 0.95 cannot be
    # supplied by the party being scored.
    nip_response_code: Optional[str] = None


class Device(BaseModel):
    fingerprint_id: Optional[str] = None
    timezone: Optional[str] = "Africa/Lagos"
    hardware_concurrency: Optional[int] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    # Real SDK fingerprint fields (all optional — old payloads keep working)
    screen_width: Optional[int] = None
    screen_height: Optional[int] = None
    color_depth: Optional[int] = None
    pixel_ratio: Optional[float] = None
    orientation: Optional[str] = None
    platform: Optional[str] = None
    os: Optional[str] = None
    browser: Optional[str] = None
    language: Optional[str] = None
    timezone_offset_minutes: Optional[int] = None
    touch_support: Optional[bool] = None
    max_touch_points: Optional[int] = None
    cookies_enabled: Optional[bool] = None
    do_not_track: Optional[bool] = None
    device_memory: Optional[float] = None
    gpu_renderer: Optional[str] = None
    battery_level: Optional[float] = None
    battery_charging: Optional[bool] = None
    network_type: Optional[str] = None
    network_downlink_mbps: Optional[float] = None
    network_rtt_ms: Optional[float] = None
    canvas_hash: Optional[str] = None


class Context(BaseModel):
    session_duration_seconds: Optional[int] = None
    previous_failed_attempts: Optional[int] = 0
    # Session
    login_timestamp: Optional[str] = None
    auth_method: Optional[str] = None  # "biometric" | "pin" | "password"
    # Location (GPS with permission, IP fallback)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    city: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    location_source: Optional[str] = None  # "gps" | "ip" | "unavailable"
    # Behavioral biometrics
    typing_speed_ms: Optional[float] = None
    keypress_count: Optional[int] = None
    paste_detected: Optional[bool] = None
    pasted_fields: Optional[list[str]] = None
    pointer_avg_velocity: Optional[float] = None
    scroll_direction_changes: Optional[int] = None
    time_to_first_input_seconds: Optional[float] = None
    time_to_submit_seconds: Optional[float] = None
    # Device-local time (Shield judges time-of-day against this, not server UTC)
    client_timestamp: Optional[str] = None
    client_timezone: Optional[str] = None


class ShieldAnalyzeRequest(BaseModel):
    user_id: str
    transaction: Transaction
    device: Optional[Device] = Device()
    context: Optional[Context] = Context()
    # Institution the calling app belongs to. An authenticated API key
    # overrides this; see tenancy.resolve_institution.
    institution_id: Optional[str] = None
    # Stable id from the client. Present when a transfer was scored offline
    # and is being replayed; lets the server ignore a duplicate.
    client_reference: Optional[str] = None


class ShieldAnalyzeResponse(BaseModel):
    risk_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    action: Literal["PASS", "FLAG", "BLOCK"]
    signals: list[str]
    explanation: str
    agent: str = "fable-shield-v1"
    # Total time spent in the handler. Kept for continuity with earlier
    # responses; it is NOT the number the latency budget is written against.
    latency_ms: float
    # Time to reach the verdict: funds check, twelve signal layers, scoring.
    # This is the figure the sub-200ms budget governs, because it is the only
    # part a payment rail has to wait for.
    decision_ms: float
    # How the explanation prose was produced. "cache" and "template" are
    # synchronous; "pending" means an LLM write-up is being generated off the
    # request path and can be collected from /v1/shield/explanation/{id}.
    explanation_source: Literal["cache", "template", "llm", "pending"] = "template"
    transaction_id: str


class ShieldExplanationResponse(BaseModel):
    """Late-arriving prose for a decision that was already returned."""

    transaction_id: str
    explanation: str
    explanation_source: Literal["cache", "template", "llm", "pending"]
    ready: bool
    explanation_ms: Optional[float] = None


class GhostCreateRequest(BaseModel):
    user_id: str
    transaction: Transaction
    risk_score: float
    explanation: str = ""
    institution_id: Optional[str] = None
    # Why Shield held it — decides how strong the release factor must be.
    signals: list[str] = Field(default_factory=list)


class GhostActionRequest(BaseModel):
    user_id: str
    # Proof of a completed step-up factor. Required to release, never to cancel.
    stepup_token: Optional[str] = None


class FeedbackRequest(BaseModel):
    user_id: str
    transaction_id: str
    was_fraud: bool


class DemoSeedRequest(BaseModel):
    user_id: str = "demo_user_001"
    days: int = 90


class InstitutionSeedRequest(BaseModel):
    institution_id: str
    days: int = 90
