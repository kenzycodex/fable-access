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
    # Either the account number, or a sandbox saved-recipient token that the
    # server resolves to one (so the browser never holds the full number).
    recipient_account: str = ""
    recipient_token: Optional[str] = Field(None, max_length=1000)
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
    # What the customer could spend just before this transfer, in naira, from
    # the bank's own core system. Optional; when present Shield scores a
    # transfer that takes most of it (balance drain). In the sandbox Fable's
    # ledger is used instead and this value is ignored.
    balance_before: Optional[float] = Field(None, ge=0, le=100_000_000_000)


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
    # Behavioural signals. Paste and time to submit are scored; typing speed is
    # stored as context for analysts and not scored.
    typing_speed_ms: Optional[float] = None
    paste_detected: Optional[bool] = None
    pasted_fields: Optional[list[str]] = None
    # Accepted from older clients and ignored: never stored or scored.
    keypress_count: Optional[int] = None
    pointer_avg_velocity: Optional[float] = None
    scroll_direction_changes: Optional[int] = None
    time_to_first_input_seconds: Optional[float] = None
    # Page opening to tapping Send. Scored (behavioral_anomaly).
    time_to_submit_seconds: Optional[float] = None
    # Time on a review-before-send step, after Send. Stored with the decision's
    # feature snapshot; not scored.
    review_seconds: Optional[float] = None
    # Device-local time (Shield judges time-of-day against this, not server UTC)
    client_timestamp: Optional[str] = None
    client_timezone: Optional[str] = None
    # A NIP response code the bank's server observed on the rail (a retry after
    # a failed attempt, or an integration that already spoke to NIBSS). Only
    # honoured from the bank's API key, never from a browser session: code 34
    # forces a block, so the party being scored must not be able to set it.
    nip_source: Optional[Literal["rail"]] = None
    nip_response_code: Optional[str] = Field(None, pattern=r"^[0-9A-Za-z]{2}$")


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
    # Time to reach the verdict: funds check, every signal, scoring.
    # This is the figure the sub-200ms budget governs, because it is the only
    # part a payment rail has to wait for.
    decision_ms: float
    # How the explanation prose was produced. "cache" and "template" are
    # synchronous; "pending" means an LLM write-up is being generated off the
    # request path and can be collected from /v1/shield/explanation/{id}.
    explanation_source: Literal["cache", "template", "llm", "pending"] = "template"
    transaction_id: str
    # Which engine version scored this, so a decision can always be traced to
    # the approved weights and thresholds behind it.
    engine_version: Optional[int] = None
    # What the transfer was judged against: the customer's own history, the
    # bank's customers as a whole (too little history of their own), or
    # nothing. Lets an app word a pass honestly. Null on a replayed retry.
    baseline_source: Optional[Literal["personal", "population", "none"]] = None


class ShieldExplanationResponse(BaseModel):
    """Late-arriving prose for a decision that was already returned."""

    transaction_id: str
    explanation: str
    explanation_source: Literal["cache", "template", "llm", "pending"]
    ready: bool
    explanation_ms: Optional[float] = None
    # The engine version that scored the decision (Engine page in the console).
    engine_version: Optional[int] = None


class GhostCreateRequest(BaseModel):
    user_id: str
    # The stored decision to hold. Its risk, signals and explanation are used.
    transaction_id: Optional[str] = None
    # Deprecated. Accepted from older clients only to find their recent block
    # when no transaction_id is sent; never used for the hold's risk.
    transaction: Optional[Transaction] = None
    # Deprecated and ignored: the stored decision decides these.
    risk_score: Optional[float] = None
    explanation: Optional[str] = None
    institution_id: Optional[str] = None
    signals: list[str] = Field(default_factory=list)


class GhostActionRequest(BaseModel):
    user_id: str
    # Proof of a completed step-up factor. Required to release, never to cancel.
    stepup_token: Optional[str] = None


class FeedbackRequest(BaseModel):
    user_id: str
    transaction_id: str
    was_fraud: bool
