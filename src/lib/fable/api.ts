// Client for the Fable backend — the FastAPI service in api/ (Shield's
// scikit-learn ML + GPT-4o explanations, SQLite persistence). Every call
// degrades gracefully: if the API is unreachable the store falls back to the
// built-in client engine (scoring.ts), so the demo never breaks.
//
// Point NEXT_PUBLIC_FABLE_API_URL at the deployed API (e.g. Railway) in prod;
// defaults to the local FastAPI dev server.

import type { BehavioralProfile } from "./biometrics";
import type { DeviceFingerprint } from "./fingerprint";
import type { GeoLocation } from "./geolocation";
import { CHANNEL_LABELS } from "./scoring";
import type { SessionContext } from "./session";
import type { Channel, RiskAction, ScoreResult, Signal, Transaction, TransactionInput } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_FABLE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
export const DEMO_USER_ID = "demo_user_001";

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Fable API ${res.status} on ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

let availabilityCache = { at: 0, ok: false };

/** Cached /health probe (10s TTL). */
export async function apiAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (Date.now() - availabilityCache.at < 10_000) return availabilityCache.ok;
  try {
    await fetchJson<{ status: string }>("/health", undefined, 2_500);
    availabilityCache = { at: Date.now(), ok: true };
  } catch {
    availabilityCache = { at: Date.now(), ok: false };
  }
  return availabilityCache.ok;
}

// ---------------------------------------------------------------------------
// Channel + signal mapping (FastAPI wire shapes <-> frontend domain types)
// ---------------------------------------------------------------------------

const CHANNEL_TO_API: Record<Channel, string> = {
  app: "mobile_app",
  ussd: "ussd",
  web: "internet",
  pos: "pos",
  atm: "atm",
};
const CHANNEL_FROM_API: Record<string, Channel> = {
  mobile_app: "app",
  ussd: "ussd",
  internet: "web",
  pos: "pos",
  atm: "atm",
};

const SIGNAL_LABELS: Record<string, string> = {
  amount_anomaly: "Amount anomaly",
  new_recipient: "New recipient",
  time_anomaly: "Unusual time",
  channel_risk: "Higher-risk channel",
  scam_pattern: "Scam-script match",
  ml_anomaly: "ML anomaly",
  device_anomaly: "Unrecognized device",
  location_anomaly: "Location anomaly",
  session_freshness: "Fresh session",
  behavioral_anomaly: "Behavioral anomaly",
  timezone_mismatch: "Timezone mismatch",
  system_error: "System notice",
};
const SIGNAL_WEIGHTS: Record<string, number> = {
  amount_anomaly: 0.25,
  new_recipient: 0.2,
  time_anomaly: 0.12,
  channel_risk: 0.18,
  scam_pattern: 0.15,
  ml_anomaly: 0.08,
  device_anomaly: 0.18,
  location_anomaly: 0.22,
  session_freshness: 0.12,
  behavioral_anomaly: 0.15,
  timezone_mismatch: 0.08,
};

/** FastAPI returns signals as strings ("amount_anomaly: 8x above baseline");
 * parse into the structured Signal[] the UI renders. */
export function parseApiSignals(raw: string[]): Signal[] {
  return raw.map((s) => {
    const idx = s.indexOf(":");
    const rawCode = (idx === -1 ? s : s.slice(0, idx)).trim();
    const detail = (idx === -1 ? "" : s.slice(idx + 1)).trim();
    const code = rawCode.startsWith("nip_") ? "nip_code" : rawCode;
    const weightMatch = detail.match(/\+([0-9.]+)/);
    return {
      code,
      label: code === "nip_code" ? "NIP risk code" : (SIGNAL_LABELS[code] ?? rawCode.replace(/_/g, " ")),
      detail: detail.replace(/\s*\(\+[0-9.]+\)/, "") || "Signal detected",
      weight: weightMatch ? Number(weightMatch[1]) : (SIGNAL_WEIGHTS[code] ?? 0.1),
    };
  });
}

function parseApiDate(s: string): number {
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const withZone = /Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? Date.now() : t;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface RemoteScoreResult extends ScoreResult {
  transactionId: string;
}

interface ApiShieldResponse {
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  action: RiskAction;
  signals: string[];
  explanation: string;
  latency_ms: number;
  transaction_id: string;
}

/** Everything the Fable SDK collects on the client, bundled per transfer. */
export interface SdkTelemetry {
  device: DeviceFingerprint | null;
  location: GeoLocation | null;
  session: SessionContext | null;
  behavior: BehavioralProfile | null;
}

/** Device-local time WITH its UTC offset (e.g. 2026-07-18T21:04:11+01:00) so
 * the backend judges time-of-day on the user's clock, not server UTC. */
function localIsoTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

/** POST /v1/shield/analyze — real Shield scoring (ML + rules + LLM explanation).
 * `sdk` carries the real collected context; omitted fields degrade gracefully. */
export async function shieldAnalyze(input: TransactionInput, sdk?: Partial<SdkTelemetry>): Promise<RemoteScoreResult> {
  const device = sdk?.device ?? null;
  const location = sdk?.location ?? null;
  const session = sdk?.session ?? null;
  const behavior = sdk?.behavior ?? null;

  const res = await fetchJson<ApiShieldResponse>("/v1/shield/analyze", {
    method: "POST",
    body: JSON.stringify({
      user_id: DEMO_USER_ID,
      transaction: {
        amount: input.amount,
        currency: "NGN",
        recipient_id: input.recipient.name.toLowerCase(),
        recipient_account: input.recipient.accountNumber,
        recipient_bank: input.recipient.bank,
        recipient_bank_code: input.recipient.bankCode,
        narration: input.narration,
        channel: CHANNEL_TO_API[input.channel],
      },
      device: device
        ? { ...device, ip: location?.ip ?? null }
        : {
            // No fingerprint collected (SSR edge case) — legacy minimal shape.
            fingerprint_id: "fp_unknown_device",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Africa/Lagos",
            hardware_concurrency: typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 8) : 8,
          },
      context: {
        ...(session ?? {}),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy_m: location?.accuracy_m ?? null,
        city: location?.city ?? null,
        region: location?.region ?? null,
        country: location?.country ?? null,
        country_code: location?.country_code ?? null,
        location_source: location?.source ?? null,
        typing_speed_ms: behavior?.typing_speed_ms ?? null,
        keypress_count: behavior?.keypress_count ?? null,
        paste_detected: behavior?.paste_detected ?? null,
        pasted_fields: behavior?.pasted_fields ?? null,
        pointer_avg_velocity: behavior?.pointer_avg_velocity ?? null,
        scroll_direction_changes: behavior?.scroll_direction_changes ?? null,
        time_to_first_input_seconds: behavior?.time_to_first_input_seconds ?? null,
        time_to_submit_seconds: behavior?.time_to_submit_seconds ?? null,
        client_timestamp: localIsoTimestamp(),
        client_timezone: device?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      },
    }),
  // The AI explainer can take a few seconds on a cold call; don't let the
  // default 8s abort push a real score down to the local fallback engine.
  }, 20_000);
  return {
    riskScore: res.risk_score,
    action: res.action,
    signals: parseApiSignals(res.signals),
    explanation: res.explanation,
    latencyMs: Math.round(res.latency_ms),
    transactionId: res.transaction_id,
  };
}

/** FastAPI logs the transaction with its decision at analyze time, so there's
 * no separate status-finalize step (kept as a no-op for the store's contract). */
export async function finalizeTransaction(_id: string, _status: string): Promise<void> {
  return;
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

interface ApiGhostResponse {
  ghost_id: string;
  cooling_window_minutes: number;
  expires_at: string;
}

/** POST /v1/ghost/create — real cooling-window container. */
export async function ghostCreate(txn: Transaction): Promise<{ id: string; expiresAt: number; windowSeconds: number }> {
  const res = await fetchJson<ApiGhostResponse>("/v1/ghost/create", {
    method: "POST",
    body: JSON.stringify({
      user_id: DEMO_USER_ID,
      transaction: {
        amount: txn.amount,
        recipient_id: txn.recipientName.toLowerCase(),
        recipient_account: txn.recipientAccount,
        recipient_bank: txn.recipientBank,
        narration: txn.narration,
        channel: CHANNEL_TO_API[txn.channel],
      },
      risk_score: txn.riskScore,
      explanation: txn.explanation,
    }),
  });
  return {
    id: res.ghost_id,
    expiresAt: parseApiDate(res.expires_at),
    windowSeconds: res.cooling_window_minutes * 60,
  };
}

/** POST /v1/ghost/{id}/cancel|confirm — money back / release. */
export async function ghostResolve(ghostId: string, action: "cancel" | "confirm"): Promise<void> {
  const endpoint = action === "cancel" ? "cancel" : "confirm";
  await fetchJson(`/v1/ghost/${ghostId}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify({ user_id: DEMO_USER_ID }),
  });
}

// ---------------------------------------------------------------------------
// Dashboard reads + seeding
// ---------------------------------------------------------------------------

interface ApiTransactionRow {
  id: string;
  amount: number;
  recipient_id: string | null;
  recipient_account: string | null;
  recipient_bank: string | null;
  narration: string | null;
  channel: string | null;
  risk_score: number | null;
  risk_level: string | null;
  action_taken: RiskAction | null;
  signals: string[];
  created_at: string;
}

function prettyRecipient(id: string | null, account: string | null): string {
  if (id && id !== "unknown") return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (id === "unknown") return "Unknown";
  return account ? `•••• ${account.slice(-4)}` : "Unknown";
}

function mapApiRow(r: ApiTransactionRow): Transaction {
  const action: RiskAction = r.action_taken ?? "PASS";
  return {
    id: r.id,
    timestamp: parseApiDate(r.created_at),
    amount: r.amount,
    direction: "debit",
    channel: CHANNEL_FROM_API[r.channel ?? "mobile_app"] ?? "app",
    narration: r.narration ?? "",
    status: action === "BLOCK" ? "blocked" : "completed",
    riskScore: r.risk_score ?? 0,
    action,
    signals: parseApiSignals(r.signals ?? []),
    explanation: "",
    latencyMs: 143,
    recipientName: prettyRecipient(r.recipient_id, r.recipient_account),
    recipientBank: r.recipient_bank ?? "—",
    recipientAccount: r.recipient_account ?? "",
    customerName: "Ada Obi",
    remote: true,
  };
}

/** GET /v1/dashboard/transactions — the institution feed (frontend shape).
 * Clamped to the API's max page size (200) so an over-large limit can't 422. */
export async function dashboardTransactions(limit = 200): Promise<Transaction[]> {
  const capped = Math.min(Math.max(1, limit), 200);
  const res = await fetchJson<{ transactions: ApiTransactionRow[] }>(`/v1/dashboard/transactions?limit=${capped}`);
  return res.transactions.map(mapApiRow);
}

interface ApiTransparency {
  what_we_know: { transactions_analyzed: number };
}

let seedAttempted = false;

/** Seed the FastAPI backend's 90-day history once per session, only if it has
 * no baseline yet (so live transfers are never wiped). No-op if the API is down. */
export async function ensureBackendSeeded(): Promise<void> {
  if (seedAttempted) return;
  seedAttempted = true;
  try {
    if (!(await apiAvailable())) return;
    const t = await fetchJson<ApiTransparency>(`/v1/copilot/transparency/${DEMO_USER_ID}`, undefined, 3_000);
    if (t.what_we_know.transactions_analyzed >= 10) return;
    await fetchJson("/v1/demo/seed", { method: "POST", body: JSON.stringify({ user_id: DEMO_USER_ID, days: 90 }) }, 20_000);
  } catch {
    // Backend unreachable; the client-side engine covers the demo.
  }
}

/** Human-readable channel label for an API channel string (dashboard rows). */
export function apiChannelLabel(channel: string): string {
  const mapped = CHANNEL_FROM_API[channel];
  return mapped ? CHANNEL_LABELS[mapped] : channel;
}

// ---------------------------------------------------------------------------
// Fable Copilot assistant + intelligence endpoints
// ---------------------------------------------------------------------------

export interface AssistantReply {
  reply: string;
  /** "openai" | "anthropic" | "deterministic" — which engine answered. */
  engine: string;
}

/** POST /v1/assistant/chat — the grounded analyst assistant. */
export async function assistantChat(
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<AssistantReply> {
  return fetchJson<AssistantReply>("/v1/assistant/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  }, 30_000);
}

export interface ScamPatternStat {
  name: string;
  label: string;
  count: number;
}
export interface ChannelStat {
  channel: string;
  label: string;
  total: number;
  risky: number;
  risk_rate: number;
}
export interface DashboardIntelligence {
  summary: { transactions_analyzed: number; blocked: number; flagged: number; passed: number; avg_risk_score: number; fraud_prevented_ngn: number };
  scam_patterns: ScamPatternStat[];
  channels: ChannelStat[];
  signals: { label: string; count: number }[];
}

export function dashboardIntelligence(): Promise<DashboardIntelligence> {
  return fetchJson<DashboardIntelligence>("/v1/dashboard/intelligence");
}

export interface AlertRow {
  id: string;
  customer: string;
  amount: number;
  recipient: string;
  recipient_bank: string | null;
  channel: string;
  risk_score: number;
  severity: "HIGH" | "MEDIUM";
  action: RiskAction;
  signals: string[];
  created_at: string;
}
export interface DashboardAlerts {
  alerts: AlertRow[];
  counts: { blocked: number; flagged: number; open: number };
}

export function dashboardAlerts(limit = 50): Promise<DashboardAlerts> {
  return fetchJson<DashboardAlerts>(`/v1/dashboard/alerts?limit=${limit}`);
}

export interface DashboardCompliance {
  audit: { transactions_logged: number; ghost_containers: number; ghost_cancelled: number; decisions_explained: number };
  csat: { frictionless_rate: number; friction_events: number; score: number };
  fraud_prevented_ngn: number;
  incidents: { id: string; user_id: string; amount: number; recipient_bank: string | null; risk_score: number; action_taken: string; created_at: string }[];
  frameworks: { name: string; status: string }[];
}

export function dashboardCompliance(): Promise<DashboardCompliance> {
  return fetchJson<DashboardCompliance>("/v1/dashboard/compliance");
}

// ---------------------------------------------------------------------------
// Agents dashboard (agent-level analytics)
// ---------------------------------------------------------------------------

export interface AgentsOverview {
  copilot: {
    status: string;
    customers_learned: number;
    data_points: number;
    live_data_points: number;
    devices_tracked: number;
    locations_tracked: number;
    last_learned_at: string | null;
  };
  shield: {
    status: string;
    transactions_scored: number;
    blocked: number;
    flagged: number;
    passed: number;
    block_rate: number;
    flag_rate: number;
    avg_risk_score: number;
    signal_layers: number;
    thresholds: { block: number; flag: number };
  };
  ghost: {
    status: string;
    containers_created: number;
    cancelled: number;
    released: number;
    held: number;
    cancellation_rate: number;
    money_saved_ngn: number;
  };
  watch: { status: string; description: string };
}

export function agentsOverview(): Promise<AgentsOverview> {
  return fetchJson<AgentsOverview>("/v1/agents/overview");
}

export interface CopilotCustomer {
  user_id: string;
  has_baseline: boolean;
  transactions_analyzed: number;
  live_transactions: number;
  typical_range?: string;
  avg_amount?: number;
  active_hours?: string;
  trusted_recipients?: number;
  known_devices?: number;
  known_cities?: string[];
  home_country?: string | null;
  preferred_channel?: string;
  avg_session_duration_s?: number | null;
  avg_time_to_submit_s?: number | null;
  last_activity: string;
  last_updated?: string;
}

export function agentsCopilotCustomers(): Promise<{ customers: CopilotCustomer[]; total: number }> {
  return fetchJson("/v1/agents/copilot/customers");
}

export interface ShieldPipelineStep {
  step: number;
  code: string;
  label: string;
  max_weight: number;
  description: string;
}

export interface ShieldDecisionRow {
  id: string;
  user_id: string;
  amount: number;
  recipient_id: string | null;
  recipient_bank: string | null;
  channel: string | null;
  risk_score: number | null;
  risk_level: string | null;
  action_taken: RiskAction | null;
  signals: string[];
  city: string | null;
  country: string | null;
  location_source: string | null;
  auth_method: string | null;
  session_duration_seconds: number | null;
  typing_speed_ms: number | null;
  paste_detected: number | null;
  device_fingerprint: string | null;
  is_seed: number;
  created_at: string;
}

export interface ShieldDecisions {
  decisions: ShieldDecisionRow[];
  pipeline: ShieldPipelineStep[];
  thresholds: { block: number; flag: number };
  accuracy: {
    transactions_scored: number;
    pass_rate: number;
    friction_events: number;
    false_positive_proxy: number;
  };
}

export function agentsShieldDecisions(limit = 25): Promise<ShieldDecisions> {
  return fetchJson(`/v1/agents/shield/decisions?limit=${limit}`);
}

export interface GhostContainerRow {
  ghost_id: string;
  user_id: string;
  amount: number;
  recipient_id: string | null;
  recipient_account: string | null;
  recipient_bank: string | null;
  status: string;
  cooling_window_minutes: number | null;
  risk_score: number | null;
  explanation: string | null;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
}

export interface GhostContainers {
  containers: GhostContainerRow[];
  stats: {
    created: number;
    held: number;
    cancelled: number;
    released: number;
    cancellation_rate: number;
    money_saved_ngn: number;
  };
  cooling_windows: {
    high_risk_minutes: number;
    medium_risk_minutes: number;
    low_risk_minutes: number;
  };
}

export function agentsGhostContainers(limit = 50): Promise<GhostContainers> {
  return fetchJson(`/v1/agents/ghost/containers?limit=${limit}`);
}

export interface CopilotBaseline {
  typical_transfer_range: string;
  active_hours: string;
  trusted_recipients_count: number;
  known_devices_count: number;
  preferred_channel: string;
  transactions_analyzed: number;
}

/** GET /v1/copilot/transparency/{user} — what Copilot has actually learned. */
export async function copilotBaseline(userId = DEMO_USER_ID): Promise<CopilotBaseline> {
  const res = await fetchJson<{ what_we_know: CopilotBaseline }>(`/v1/copilot/transparency/${userId}`);
  return res.what_we_know;
}
