import type { IconCard } from "@/components/sections/IconCardGrid";

export const tfoSubNav = [
  { label: "Pipeline", href: "#pipeline" },
  { label: "Agents", href: "#agents" },
  { label: "API", href: "#api" },
  { label: "Latency", href: "#latency" },
];

export const pipelineIntro = {
  title: "One Call, Four Agents, In Order",
  body: "Every transfer routes through the same pipeline: Copilot checks it against the user's baseline first. If it doesn't match, Shield scores it across fourteen signal layers. If a user overrides a Shield block anyway, Ghost holds the money instead of losing it. Watch, the passive monitor that will run between sessions, is on the roadmap.",
  image: { src: "/images/solutions/legacy-solutions.png", alt: "The Fable agent pipeline", width: 1024, height: 840 },
};

// "Agents" 4-card grid: what each one actually does, no images needed.
export const agentCards: IconCard[] = [
  {
    title: "Copilot — Baseline Engine",
    body: "Learns a per-user behavioral baseline from day one: who they pay, when, how much, and which devices. A transfer that matches clears with zero added friction.",
  },
  {
    title: "Shield — Fourteen Signal Layers",
    body: "Amount, recipient, timing, channel, device, location, session and behavioural signals, scored against that customer's own baseline and explained in plain language, inside a 200ms budget.",
  },
  {
    title: "Ghost — Cooling Window",
    body: "Routes an overridden block into a disposable holding account instead of letting the transfer clear outright, so even a fully-scammed user has a way back.",
  },
  {
    title: "Watch — Coming Soon",
    body: "Planned passive monitoring between sessions, watching for pattern drift and device changes without adding latency to the transfer path. Not live yet.",
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
  { value: "<200ms", label: "Decision budget for every scored transfer, explanation prose excluded" },
  { value: "10s", label: "NIP's clearing window; Fable uses a fraction of it" },
];
