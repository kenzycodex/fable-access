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
