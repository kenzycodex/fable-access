import type { IconCard } from "@/components/sections/IconCardGrid";

export const tfoSubNav = [
  { label: "Pipeline", href: "#pipeline" },
  { label: "Agents", href: "#agents" },
  { label: "API", href: "#api" },
  { label: "Latency", href: "#latency" },
];

export const pipelineIntro = {
  title: "One Call, Four Agents, In Order",
  body: "Every transfer routes through the same pipeline: Copilot checks it against the user's baseline first. If it doesn't match, Shield scores it across six signal layers. If a user overrides a Shield block anyway, Ghost holds the money instead of losing it. Watch runs underneath all of it, passively, between sessions.",
  image: { src: "/images/solutions/legacy-solutions.png", alt: "The Fable agent pipeline", width: 1024, height: 840 },
};

// "Agents" 4-card grid: what each one actually does, no images needed.
export const agentCards: IconCard[] = [
  {
    title: "Copilot — Baseline Engine",
    body: "Learns a per-user behavioral baseline from day one: who they pay, when, how much, and which devices. A transfer that matches clears with zero added friction.",
  },
  {
    title: "Shield — Six Signal Layers",
    body: "Amount anomaly, new recipient, time-of-day, channel risk, narration keywords, and NIP response code. Scored and explained in plain language, inside a 200ms budget.",
  },
  {
    title: "Ghost — Cooling Window",
    body: "Routes an overridden block into a disposable holding account instead of letting the transfer clear outright, so even a fully-scammed user has a way back.",
  },
  {
    title: "Watch — Passive Monitoring",
    body: "Runs between sessions, watching for pattern drift and device changes, without adding latency to the transfer path itself.",
  },
];

export const apiRequestExample = `POST /v1/score
{
  "transfer_id": "txn_8f2ac1",
  "user_id": "usr_44210",
  "amount": 150000,
  "recipient": { "account_number": "0123456789", "bank_code": "058" },
  "channel": "app",
  "narration": "urgent help abeg"
}`;

export const apiResponseExample = `{
  "decision": "FLAG",
  "risk_score": 78,
  "signals": ["new_recipient", "narration_keyword", "time_anomaly"],
  "action": "ghost_hold",
  "latency_ms": 142
}`;

export const latencyStats = [
  { value: "<200ms", label: "End-to-end response time, all four agents included" },
  { value: "10s", label: "NIP's clearing window; Fable uses a fraction of it" },
];
