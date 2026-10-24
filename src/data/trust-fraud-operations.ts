import type { IconCard } from "@/components/sections/IconCardGrid";

export const tfoSubNav = [
  { label: "Pipeline", href: "#pipeline" },
  { label: "Agents", href: "#agents" },
  { label: "API", href: "#api" },
  { label: "Latency", href: "#latency" },
];

export const pipelineIntro = {
  title: "Three Agents, In Order",
  body: "Every transfer routes through the same pipeline: Copilot supplies the user's baseline, Shield scores the transfer against sixteen signals, and if a user still wants a blocked transfer sent, Ghost holds it for a cooling window. A clean transfer is one call; a flagged one adds a short verification flow.",
  image: { src: "/images/solutions/legacy-solutions.png", alt: "The Fable agent pipeline", width: 1024, height: 840 },
};

// "Agents" 3-card grid: what each one actually does, no images needed.
export const agentCards: IconCard[] = [
  {
    title: "Copilot — Baseline Engine",
    body: "Learns a per-user behavioral baseline from day one: who they pay, when, how much, and which devices. A transfer that matches clears with zero added friction.",
  },
  {
    title: "Shield — Sixteen Signals",
    body: "Amount, recipient, timing, channel, device, location, session and behavioural signals, scored against that customer's own baseline and explained in plain language, within a 200ms decision budget.",
  },
  {
    title: "Ghost — Cooling Window",
    body: "Holds an overridden block for a cooling window instead of letting it clear, so even a fully-scammed user has a way back. The bank holds the funds and acts on Fable's webhook.",
  },
];

export const apiRequestExample = `POST /v1/shield/analyze
X-API-Key: fbl_live_...
{
  "user_id": "usr_44210",
  "transaction": {
    "amount": 150000,
    "currency": "NGN",
    "recipient_account": "0123456789",
    "recipient_bank_code": "058",
    "recipient_name": "ADEOLA MUSA",
    "channel": "mobile_app",
    "narration": "urgent help abeg"
  },
  "device": { "fingerprint_id": "fp_9c1e4b7a", "timezone": "Africa/Lagos" },
  "context": { "session_duration_seconds": 14, "paste_detected": true },
  "client_reference": "txn_8f2ac1"
}`;

export const apiResponseExample = `{
  "risk_score": 0.64,
  "risk_level": "MEDIUM",
  "action": "FLAG",
  "signals": [
    "amount_anomaly: 12x above your baseline (+0.28)",
    "new_recipient: first transfer to this account (+0.2)",
    "scam_pattern: urgency script (+0.13)"
  ],
  "explanation": "This is much larger than your usual transfers, to someone you have never paid before...",
  "decision_ms": 48.2,
  "latency_ms": 51.7,
  "explanation_source": "template",
  "transaction_id": "txn_a1b2c3d4e5f6"
}`;

export const latencyStats = [
  { value: "200ms", label: "Decision budget per scored transfer, measured on every call (no load test published yet)" },
  { value: "10s", label: "NIP's clearing window; Fable uses a fraction of it" },
];
