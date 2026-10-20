// Client for the Fable backend, the FastAPI service in api/. Every decision is
// the server's: when the API cannot be reached the caller is told so, and
// nothing is scored or held in the browser.
//
// Point NEXT_PUBLIC_FABLE_API_URL at the deployed API in production; it
// defaults to the local FastAPI dev server.

import type { BehavioralProfile } from "./biometrics";
import type { DeviceFingerprint } from "./fingerprint";
import { TRUSTED_CITY_M, type GeoLocation } from "./geolocation";
import { CHANNEL_LABELS } from "./constants";
import type { SessionContext } from "./session";
import { activeInstitution, activeUserId, authHeaders } from "./tenant";
import type { Channel, ReviewOutcome, ReviewState, RiskAction, ScoreResult, Signal, Transaction, TransactionInput } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_FABLE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
/** Legacy single-tenant user id. Still the fallback for dashboard reads that
 * predate multi-tenancy; live demo transfers use the customer picked in the
 * demo bank (see tenant.ts). */

// Dashboard reads used to take 4-7 seconds, which was treated as a network
// budget problem and worked around by raising this timeout to 20s. It was not:
// the database had no indexes, so every rollup was a full table scan. With the
// indexes in place the same reads are fast, and the budget comes back down to
// something that surfaces a real problem instead of hiding it. Callers that
// need to fail faster still (the /health probe) pass their own value.
async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        // Sends the institution's API key when the demo bank has been
        // connected, which is how a real integrating bank authenticates.
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Fable API ${res.status} on ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** A test customer in the sandbox app. */
export interface SandboxCustomer {
  user_id: string;
  reference: string;
  name: string;
  segment: string | null;
}

/** Why the sandbox roster could not be read. */
export class SandboxUnavailable extends Error {
  constructor(public status: number) {
    super(`Sandbox unavailable (${status})`);
  }
}

/** GET /v1/sandbox/customers: the signed-in bank's test customers. Needs the
 * console session; 401 means signed out, 409 means the bank is live. */
export async function sandboxCustomers(): Promise<{ institution_id: string; customers: SandboxCustomer[] }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/customers`, { headers: authHeaders() });
  if (!res.ok) throw new SandboxUnavailable(res.status);
  return (await res.json()) as { institution_id: string; customers: SandboxCustomer[] };
}

/** Someone a sandbox customer has sent money to before. The account number
 * stays on the server; `token` stands in for it on a transfer. */
export interface SavedRecipient {
  token: string;
  name: string;
  bank: string | null;
  account_last4: string;
  times: number;
  last_sent: string | null;
}

/** GET /v1/sandbox/recipients/{user_id}: the customer's saved recipients. */
export function sandboxRecipients(userId: string) {
  return fetchJson<{ recipients: SavedRecipient[] }>(`/v1/sandbox/recipients/${encodeURIComponent(userId)}`);
}

/** A bank's customer as its console sees it. */
export interface BankCustomer {
  id: string;
  reference: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  segment: string | null;
  kind: "test" | "real";
  status: "active" | "closed";
  source: "console" | "csv" | "api";
  created_at: string | null;
}

/** GET /v1/customers: the signed-in bank's customers. */
export function listCustomers(params: { q?: string; kind?: string; status?: string; limit?: number; offset?: number } = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return fetchJson<{ customers: BankCustomer[]; total: number }>(`/v1/customers${qs ? `?${qs}` : ""}`);
}

/** Query fragment scoping a dashboard read to one institution. `first`
 * omits the leading ampersand when it opens the query string. */
function tenantParam(institution?: string | null, first = false): string {
  if (!institution) return "";
  return `${first ? "" : "&"}institution=${encodeURIComponent(institution)}`;
}

// Two consecutive failures before the app is considered offline.
//
// One failed probe used to flip it, and the probe has its own 2.5s timeout, so
// a single slow response under load pinned the app to the local engine for a
// full 10 seconds. Everything scored in that window got a client-generated id
// and no server row, which then failed with a bare 404 when the customer tried
// to verify a flagged transfer. A blip is not an outage.
let consecutiveFailures = 0;
const FAILURES_BEFORE_OFFLINE = 2;

let availabilityCache = { at: 0, ok: false };

/** Cached /health probe (10s TTL). */
export async function apiAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (Date.now() - availabilityCache.at < 10_000) return availabilityCache.ok;
  try {
    await fetchJson<{ status: string }>("/health", undefined, 4_000);
    consecutiveFailures = 0;
    availabilityCache = { at: Date.now(), ok: true };
  } catch {
    consecutiveFailures += 1;
    // Stay online until the failures are consistent. The cache window is also
    // shortened on the first failure so a recovering API is picked up in two
    // seconds rather than ten.
    const offline = consecutiveFailures >= FAILURES_BEFORE_OFFLINE;
    availabilityCache = { at: offline ? Date.now() : Date.now() - 8_000, ok: !offline };
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
  ml_anomaly: "Unusual for this customer",
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
  ml_anomaly: 0.1,
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
  decision_ms?: number;
  explanation_source?: "cache" | "template" | "llm" | "pending";
  transaction_id: string;
}

export interface ShieldExplanation {
  transaction_id: string;
  explanation: string;
  explanation_source: "cache" | "template" | "llm" | "pending";
  ready: boolean;
  explanation_ms: number | null;
}

/** Collect the fuller write-up for a decision that already came back.
 *
 * Shield answers with a deterministic explanation immediately and generates a
 * richer one off the request path, so the verdict is never held up by prose.
 * Returns null if the transfer is unknown or the call fails: the explanation
 * already on screen stays, which is always valid to keep showing.
 */
export async function shieldExplanation(transactionId: string): Promise<ShieldExplanation | null> {
  try {
    return await fetchJson<ShieldExplanation>(`/v1/shield/explanation/${transactionId}`);
  } catch {
    return null;
  }
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

/** Fable could not be reached (network error, timeout, or a server error), so
 * no decision was made. Nothing was sent; the customer should try again. */
export class FableUnavailableError extends Error {
  constructor(message = "We couldn't reach Fable to check this transfer, so it hasn't been sent. Please try again.") {
    super(message);
    this.name = "FableUnavailableError";
  }
}

/** POST /v1/shield/analyze: Fable's decision on a transfer. `sdk` carries the
 * collected context; omitted fields are simply absent. */
/** Options for a scoring call. `clientReference` is stable across retries of
 * one transfer, so the server returns the decision it already made instead of
 * booking a second one. */
export interface ReplayOptions {
  clientReference?: string;
  userId?: string;
  institutionId?: string;
}

export async function shieldAnalyze(
  input: TransactionInput,
  sdk?: Partial<SdkTelemetry>,
  replay?: ReplayOptions,
): Promise<RemoteScoreResult> {
  const device = sdk?.device ?? null;
  const location = sdk?.location ?? null;
  const session = sdk?.session ?? null;
  const behavior = sdk?.behavior ?? null;

  const body = JSON.stringify({
      user_id: replay?.userId ?? activeUserId(),
      institution_id: replay?.institutionId ?? activeInstitution(),
      client_reference: replay?.clientReference ?? null,
      transaction: {
        amount: input.amount,
        currency: "NGN",
        recipient_id: input.recipient.name.toLowerCase(),
        // The account holder exactly as resolved. recipient_id is a lowercased
        // slug, so deriving display from it lost the real NUBAN name.
        recipient_name: input.recipient.name,
        recipient_account: input.recipient.token ? "" : input.recipient.accountNumber,
        recipient_token: input.recipient.token ?? null,
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
        // An IP address names the carrier's city, often tens of km from the
        // customer, so only a GPS fix is allowed to say "new city". Country is
        // reliable either way.
        city: location?.source === "gps" && (location.accuracy_m ?? 0) <= TRUSTED_CITY_M ? location.city : null,
        region: location?.region ?? null,
        country: location?.country ?? null,
        country_code: location?.country_code ?? null,
        location_source: location?.source ?? null,
        typing_speed_ms: behavior?.typing_speed_ms ?? null,
        paste_detected: behavior?.paste_detected ?? null,
        pasted_fields: behavior?.pasted_fields ?? null,
        time_to_first_input_seconds: behavior?.time_to_first_input_seconds ?? null,
        time_to_submit_seconds: behavior?.time_to_submit_seconds ?? null,
        client_timestamp: localIsoTimestamp(),
        client_timezone: device?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      },
  });

  // Not routed through fetchJson: a 422 here means the account cannot cover
  // the transfer, which is a different outcome from the API being unreachable.
  // The decision never waits for the AI write-up, so a long wait here means
  // the API is in trouble; 15 seconds is the most a customer should be kept.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let raw: Response;
  try {
    raw = await fetch(`${API_BASE}/v1/shield/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (raw.status === 422) {
    // 422 is overloaded: it's both our insufficient-funds refusal and FastAPI's
    // schema-validation error. Only the former is a dict tagged
    // "insufficient_funds"; a validation error's detail is an array. Treating
    // every 422 as insufficient funds mislabels a malformed request as an empty
    // wallet, so disambiguate before throwing.
    const detail = (await raw.json().catch(() => ({})))?.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail) && detail.error === "insufficient_funds") {
      throw new InsufficientFundsError(
        detail.available ?? 0,
        detail.requested ?? 0,
        detail.shortfall ?? 0,
        detail.message ?? "Insufficient funds for this transfer.",
      );
    }
    // A validation problem, not an empty wallet: report it as one.
    throw new Error("Shield rejected the transfer payload (422 validation).");
  }
  if (!raw.ok) throw new Error(`Fable API ${raw.status} on /v1/shield/analyze`);
  const res = (await raw.json()) as ApiShieldResponse;

  return {
    riskScore: res.risk_score,
    action: res.action,
    signals: parseApiSignals(res.signals),
    explanation: res.explanation,
    latencyMs: Math.round(res.latency_ms),
    decisionMs: res.decision_ms !== undefined ? Math.round(res.decision_ms) : undefined,
    explanationSource: res.explanation_source,
    transactionId: res.transaction_id,
  };
}

/** Persist a transfer's lifecycle outcome so every surface — the customer's
 * history after a refresh, the institution console — agrees on where the money
 * ended up. Best-effort: a failure leaves the in-session status correct and the
 * next poll reconciles. */
export async function finalizeTransaction(id: string, status: string): Promise<void> {
  try {
    await fetchJson(`/v1/transactions/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  } catch {
    // Non-fatal; the local feed already shows the right status this session.
  }
}

/** Proceed with a flagged transfer after step-up. Throws StepUpRequiredError
 * (401) carrying the demanded level when no valid proof is supplied, so the
 * caller can run the factor and retry with a token. */
export async function approveTransfer(id: string, userId: string, stepupToken?: string | null): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/v1/transactions/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ user_id: userId, stepup_token: stepupToken ?? null }),
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail ?? {};
    throw new StepUpRequiredError(d.level ?? "pin", d.message ?? "Verification required.");
  }
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail ?? {};
    throw new InsufficientFundsError(d.available ?? 0, d.requested ?? 0, d.shortfall ?? 0, d.message ?? "Insufficient funds.");
  }
  if (!res.ok) throw new Error(`Could not send this transfer (${res.status})`);
  return (await res.json()) as { status: string };
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
  // Only the decision's id: the server takes the hold's risk, signals and
  // explanation from the decision it stored, never from the browser.
  const res = await fetchJson<ApiGhostResponse>("/v1/ghost/create", {
    method: "POST",
    body: JSON.stringify({ user_id: activeUserId(), transaction_id: txn.id }),
  });
  return {
    id: res.ghost_id,
    expiresAt: parseApiDate(res.expires_at),
    windowSeconds: res.cooling_window_minutes * 60,
  };
}

/** POST /v1/ghost/{id}/cancel|confirm — money back / release. */
/** Thrown when releasing money needs a factor the session hasn't proved. */
export class StepUpRequiredError extends Error {
  constructor(readonly level: string, message: string) {
    super(message);
    this.name = "StepUpRequiredError";
  }
}

/** The hold's cooling window closed before it was released, so nothing was
 * sent and the money stayed with the customer. */
export class GhostExpiredError extends Error {
  constructor(message = "This hold expired, so the money stayed in your account. Start the transfer again if you still want to send it.") {
    super(message);
    this.name = "GhostExpiredError";
  }
}

export async function ghostResolve(
  ghostId: string,
  action: "cancel" | "confirm",
  stepupToken?: string | null,
): Promise<void> {
  const endpoint = action === "cancel" ? "cancel" : "confirm";
  // Not routed through fetchJson: a 401 here is meaningful (which factor is
  // needed), not a generic failure, so the body has to be read before throwing.
  const res = await fetch(`${API_BASE}/v1/ghost/${ghostId}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ user_id: activeUserId(), stepup_token: stepupToken ?? null }),
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail ?? {};
    throw new StepUpRequiredError(
      detail.level ?? "passkey",
      detail.message ?? "Verification required before this transfer can be released.",
    );
  }
  if (res.status === 410) throw new GhostExpiredError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : typeof detail?.message === "string"
          ? detail.message
          : "We couldn't reach Fable just now. Your money is still held. Please try again.",
    );
  }
}

/** A sandbox test customer's inbox: the codes and notices they would have
 * received. The server refuses this for a live institution. */
export function sandboxInbox(userId: string): Promise<{
  items: {
    id: number;
    kind: "code" | "notice";
    channel: string | null;
    destination: string | null;
    subject: string | null;
    body: string | null;
    code: string | null;
    purpose: string | null;
    created_at: string;
  }[];
}> {
  return fetchJson(`/v1/sandbox/inbox/${encodeURIComponent(userId)}`);
}

/** Ask the bank to verify the customer another way and release the hold.
 * For a customer whose factors cannot reach the release level. */
export async function ghostRequestRelease(ghostId: string): Promise<{ status: string; expires_at?: string }> {
  return fetchJson(`/v1/ghost/${encodeURIComponent(ghostId)}/request-release`, {
    method: "POST",
    body: JSON.stringify({ user_id: activeUserId() }),
  });
}

/** Ghost container detail, including the signals that justified the hold. */
export function ghostDetail(ghostId: string): Promise<{
  ghost_id: string;
  risk_score: number | null;
  signals?: string[];
  status: "HELD" | "RELEASE_REQUESTED" | "RELEASED" | "CANCELLED" | "EXPIRED";
  expires_at?: string;
}> {
  return fetchJson(`/v1/ghost/${ghostId}`);
}

// ---------------------------------------------------------------------------
// Dashboard reads + seeding
// ---------------------------------------------------------------------------

export interface ApiTransactionRow {
  id: string;
  /** Which customer made it. */
  user_id?: string | null;
  /** Resolved display name, when the API can name this customer. */
  customer_name?: string | null;
  amount: number;
  recipient_id: string | null;
  recipient_name?: string | null;
  recipient_account: string | null;
  recipient_bank: string | null;
  narration: string | null;
  channel: string | null;
  risk_score: number | null;
  risk_level: string | null;
  action_taken: RiskAction | null;
  signals: string[];
  latency_ms?: number | null;
  created_at: string;
  status?: string | null;
  explanation?: string | null;
  review_state?: ReviewState | null;
  review_outcome?: ReviewOutcome | null;
  assignee?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  engine_version?: number | null;
  /** On review-queue rows: the status of the hold opened from this decision. */
  hold_status?: string | null;
}

function prettyRecipient(id: string | null, account: string | null): string {
  if (id && id !== "unknown") return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (id === "unknown") return "Unknown";
  return account ? `•••• ${account.slice(-4)}` : "Unknown";
}

/** Fallback label for a user id the API could not name (a real integrator's
 *  customer, rather than a demo archetype). Renders the id's own suffix rather
 *  than inventing a person. */
function prettyUserId(userId: string | null | undefined): string {
  if (!userId) return "Unknown customer";
  const key = userId.includes("_") ? userId.slice(userId.lastIndexOf("_") + 1) : userId;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function mapApiRow(r: ApiTransactionRow): Transaction {
  const action: RiskAction = r.action_taken ?? "PASS";
  return {
    id: r.id,
    timestamp: parseApiDate(r.created_at),
    amount: r.amount,
    direction: "debit",
    channel: CHANNEL_FROM_API[r.channel ?? "mobile_app"] ?? "app",
    narration: r.narration ?? "",
    // The persisted lifecycle outcome wins. The action-derived fallback only
    // covers rows written before status was recorded, so an old blocked row
    // still reads "blocked" and an old flag "flagged".
    status: (r.status as Transaction["status"]) ?? (action === "BLOCK" ? "blocked" : action === "FLAG" ? "flagged" : "completed"),
    riskScore: r.risk_score ?? 0,
    action,
    signals: parseApiSignals(r.signals ?? []),
    explanation: r.explanation ?? "",
    // Measured, or 0 when this row predates latency being recorded. It was
    // hardcoded to 143, which is why the console advertised a decision time
    // nothing had ever measured.
    latencyMs: r.latency_ms ?? 0,
    // The stored name wins; prettyRecipient only reconstructs a label for
    // older rows and seeded recipients that never had one.
    recipientName: r.recipient_name || prettyRecipient(r.recipient_id, r.recipient_account),
    recipientBank: r.recipient_bank ?? "—",
    recipientAccount: r.recipient_account ?? "",
    // The API resolves this now. It used to be hardcoded, so every customer
    // at every institution rendered as the same person, and the console kept
    // showing a name from a tenant that had been deleted.
    customerName: r.customer_name || prettyUserId(r.user_id),
    userId: r.user_id ?? undefined,
    engineVersion: r.engine_version ?? null,
    holdStatus: r.hold_status ?? null,
    remote: true,
    review: r.review_state
      ? {
          state: r.review_state,
          outcome: r.review_outcome ?? null,
          assignee: r.assignee ?? null,
          reviewedBy: r.reviewed_by ?? null,
          reviewedAt: r.reviewed_at ? parseApiDate(r.reviewed_at) : null,
        }
      : null,
  };
}

/** GET /v1/dashboard/transactions — the institution feed (frontend shape).
 * Clamped to the API's max page size (200) so an over-large limit can't 422. */
export async function dashboardTransactions(
  limit = 200,
  institution?: string | null,
  filters: { user?: string; from?: string; to?: string; action?: string; offset?: number } = {},
): Promise<Transaction[]> {
  return (await dashboardTransactionPage(limit, institution, filters)).transactions;
}

/** The same feed with its total, for paging and range views. */
export async function dashboardTransactionPage(
  limit = 200,
  institution?: string | null,
  filters: { user?: string; from?: string; to?: string; action?: string; offset?: number } = {},
): Promise<{ total: number; transactions: Transaction[] }> {
  const capped = Math.min(Math.max(1, limit), 200);
  const q = new URLSearchParams({ limit: String(capped) });
  if (filters.user) q.set("user", filters.user);
  if (filters.from) q.set("from", filters.from);
  if (filters.to) q.set("to", filters.to);
  if (filters.action) q.set("action", filters.action);
  if (filters.offset) q.set("offset", String(filters.offset));
  const res = await fetchJson<{ total: number; transactions: ApiTransactionRow[] }>(
    `/v1/dashboard/transactions?${q.toString()}${tenantParam(institution)}`,
  );
  return { total: res.total, transactions: res.transactions.map(mapApiRow) };
}

/** Human-readable channel label for an API channel string (dashboard rows). */
export function apiChannelLabel(channel: string): string {
  const mapped = CHANNEL_FROM_API[channel];
  return mapped ? CHANNEL_LABELS[mapped] : channel;
}

// ---------------------------------------------------------------------------
// Fable Copilot assistant + intelligence endpoints
// ---------------------------------------------------------------------------

export type AssistantTurn = { role: "user" | "assistant"; content: string };

/** What the answer stream can say: a piece of text, the end, or a failure. */
export type AssistantEvent =
  | { type: "delta"; text: string }
  | { type: "done"; engine: string; suggestions: string[]; notice?: string | null }
  | { type: "error"; message: string };

/**
 * POST /v1/assistant/chat/stream: the grounded analyst assistant, as server-sent
 * events. The institution comes from the console session, never the request.
 * `shown` lists the follow-ups already offered, so they are not offered again.
 */
export async function streamAssistant(
  body: { message: string; history: AssistantTurn[]; shown: string[] },
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/assistant/chat/stream`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().then((b) => (typeof b?.detail === "string" ? b.detail : null)).catch(() => null);
    throw new Error(detail ?? (res.status === 401 ? "Your session has ended. Sign in again." : "Fable couldn't answer just now."));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (data) onEvent(JSON.parse(data) as AssistantEvent);
    }
  }
}

/** GET /v1/assistant/starters: opening questions from this bank's own data. */
export function assistantStarters(page?: string) {
  return fetchJson<{ questions: string[] }>(`/v1/assistant/starters${page ? `?page=${encodeURIComponent(page)}` : ""}`);
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

export function dashboardIntelligence(institution?: string | null): Promise<DashboardIntelligence> {
  return fetchJson<DashboardIntelligence>(`/v1/dashboard/intelligence?${tenantParam(institution, true)}`);
}

/** Headline stats, including the only latency figures anyone measured. */
export interface DashboardStats {
  transactions_analyzed: number;
  live_transactions: number;
  threats_blocked: number;
  flagged: number;
  passed: number;
  fraud_prevented_ngn: number;
  /** Time to the verdict. null until Shield has actually decided something
   * with a timer running. This is the series the 200ms budget governs. */
  latency_ms: { p50: number; p95: number; p99: number } | null;
  latency_sample_size: number;
  /** Time to generate explanation prose. Tracked but deliberately not
   * budgeted: it runs off the request path and no caller waits on it. */
  explanation_ms: { p50: number; p95: number; p99: number } | null;
  explanation_sample_size: number;
}

export function dashboardStats(institution?: string | null): Promise<DashboardStats> {
  return fetchJson<DashboardStats>(`/v1/dashboard/stats?${tenantParam(institution, true)}`);
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
  latency_ms?: number | null;
  created_at: string;
}
export interface DashboardAlerts {
  alerts: AlertRow[];
  counts: { blocked: number; flagged: number; open: number };
}

export function dashboardAlerts(limit = 50, institution?: string | null): Promise<DashboardAlerts> {
  return fetchJson<DashboardAlerts>(`/v1/dashboard/alerts?limit=${limit}${tenantParam(institution)}`);
}

export interface DashboardCompliance {
  audit: {
    transactions_logged: number;
    ghost_containers: number;
    ghost_cancelled: number;
    decisions_explained: number;
    events_recorded?: number;
  };
  /** The recorded audit events, newest first. */
  audit_trail?: { id: number; user_id: string | null; event_type: string; payload: Record<string, unknown>; created_at: string }[];
  friction: { frictionless_rate: number; friction_events: number };
  fraud_prevented_ngn: number;
  incidents: { id: string; user_id: string; amount: number; recipient_bank: string | null; risk_score: number; action_taken: string; created_at: string }[];
  frameworks: { name: string; status: string }[];
}

export function dashboardCompliance(institution?: string | null): Promise<DashboardCompliance> {
  return fetchJson<DashboardCompliance>(`/v1/dashboard/compliance?${tenantParam(institution, true)}`);
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
    /** "active", "degraded" (expiry stalled or hold webhooks failing) or "off". */
    status: string;
    detail?: string;
    containers_created: number;
    cancelled: number;
    expired?: number;
    released: number;
    held: number;
    cancellation_rate: number;
    money_saved_ngn: number;
  };
  watch: { status: string; description: string };
}

export function agentsOverview(institution?: string | null): Promise<AgentsOverview> {
  return fetchJson<AgentsOverview>(`/v1/agents/overview?${tenantParam(institution, true)}`);
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
  /** Ledger balance, or null when the customer has no account row yet. */
  balance?: number | null;
  /** The verification factors this customer has set up. */
  verification?: {
    pin_set: boolean;
    pin_locked: boolean;
    passkeys: number;
    contact_set: boolean;
    two_factor: boolean;
  };
}

/** Clear a customer's PIN so they can choose a new one. Needs a console session
 * for this institution; the customer sets the new PIN themselves. */
export async function resetCustomerPin(institutionId: string, userId: string): Promise<void> {
  await fetchJson(
    `/v1/institutions/${encodeURIComponent(institutionId)}/customers/${encodeURIComponent(userId)}/pin/reset`,
    { method: "POST" },
  );
}

export function agentsCopilotCustomers(institution?: string | null): Promise<{ customers: CopilotCustomer[]; total: number }> {
  return fetchJson(`/v1/agents/copilot/customers?${tenantParam(institution, true)}`);
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

export function agentsShieldDecisions(limit = 25, institution?: string | null): Promise<ShieldDecisions> {
  return fetchJson(`/v1/agents/shield/decisions?limit=${limit}${tenantParam(institution)}`);
}

export interface GhostContainerRow {
  ghost_id: string;
  user_id: string;
  amount: number;
  recipient_id: string | null;
  recipient_name?: string | null;
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

export function agentsGhostContainers(limit = 50, institution?: string | null): Promise<GhostContainers> {
  return fetchJson(`/v1/agents/ghost/containers?limit=${limit}${tenantParam(institution)}`);
}

export interface InstitutionCredentials {
  institution_id: string;
  /** Only returned to an owner. */
  api_key: string | null;
  masked_key: string | null;
  created_at: string | null;
  mode?: "sandbox" | "live";
  can_manage?: boolean;
}

export interface InstitutionProfile {
  institution_id: string;
  name: string;
  type: string;
  contact_email: string | null;
}

/** GET /v1/institutions/{id} — the signed-in tenant's real profile.
 *
 * The console used to render a hardcoded institution constant, so the sidebar,
 * the greeting and the settings page all showed the same fictional bank
 * regardless of who was signed in — and kept showing it after that institution
 * had been deleted from the database. */
export async function institutionProfile(institutionId: string): Promise<InstitutionProfile> {
  return fetchJson<InstitutionProfile>(`/v1/institutions/${encodeURIComponent(institutionId)}`);
}

/** PATCH /v1/institutions/{id} — edit the institution's own name, type and
 * contact address. Needs a console session for that institution. The tenant id,
 * the sign-in email and the public demo URL are deliberately not editable here. */
export async function updateInstitutionProfile(
  institutionId: string,
  patch: { name?: string; type?: string; contact_email?: string },
): Promise<InstitutionProfile> {
  const res = await fetch(`${API_BASE}/v1/institutions/${encodeURIComponent(institutionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not save the profile.");
  }
  return (await res.json()) as InstitutionProfile;
}

/** GET /v1/institutions/{id}/credentials — the tenant's own live API key. */
export function institutionCredentials(institutionId: string): Promise<InstitutionCredentials> {
  return fetchJson<InstitutionCredentials>(
    `/v1/institutions/${encodeURIComponent(institutionId)}/credentials`,
  );
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
export async function copilotBaseline(userId: string): Promise<CopilotBaseline> {
  const res = await fetchJson<{ what_we_know: CopilotBaseline }>(`/v1/copilot/transparency/${userId}`);
  return res.what_we_know;
}

// ---------------------------------------------------------------------------
// Institution identity: key resolution + branding
// ---------------------------------------------------------------------------

export interface ResolvedKey {
  institution_id: string;
  name: string;
  demo_url: string;
}

/** Which institution does this API key belong to? Throws on an unknown key,
 * so the demo bank can refuse it instead of reporting a false success. */
export function resolveApiKey(apiKey: string): Promise<ResolvedKey> {
  return fetchJson<ResolvedKey>("/v1/institutions/resolve-key", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export interface Branding {
  institution_id: string;
  display_name: string | null;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  slug: string;
  support_email: string | null;
  tagline: string | null;
  updated_at: string | null;
  slug_locked: boolean;
  slug_locked_until: string | null;
  slug_lock_days: number;
}

/** One customer's own transaction history, straight from the server.
 *
 * The demo bank used to render a hardcoded client-side seed, which was the
 * same for every institution and keyed on customer name — so two tenants with
 * a similarly-named customer showed each other's transfers. This is the real
 * per-tenant, per-customer feed Copilot builds its baseline from. */
export async function customerTransactions(
  userId: string,
  institution: string | null,
  limit = 60,
): Promise<Transaction[]> {
  // The demo bank is a public page, so it reads through the public demo endpoint.
  // This used to call /v1/dashboard/transactions, which is the console's feed and
  // needs a console session, so once the API enforced that the Activity screen
  // and every transaction detail page got a 401 and sat on their loading state.
  return (await customerOverview(userId, institution, limit)).transactions;
}

export interface FableNotification {
  id: number;
  kind: "containment" | "block" | "flag" | "credit";
  title: string;
  body: string;
  reference: string | null;
  channel: "in_app" | "email" | "sms";
  /** Whether it actually reached the customer out-of-band, or only in-app. */
  delivered: boolean;
  read_at: string | null;
  created_at: string;
}

/** GET /v1/notifications/{user} — what this customer was actually told.
 *
 * Reads a real table rather than deriving a feed from transaction history.
 * Seeded history exists to populate the console's charts and nobody was ever
 * notified about any of it, so presenting it as "your notifications" would be
 * telling the customer about alerts they never received. */
export async function customerNotifications(
  userId: string,
  limit = 30,
): Promise<{ unread: number; notifications: FableNotification[] }> {
  const res = await fetchJson<{ unread: number; notifications: FableNotification[] }>(
    `/v1/notifications/${encodeURIComponent(userId)}?limit=${limit}`,
  );
  return { unread: res.unread ?? 0, notifications: res.notifications ?? [] };
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await fetchJson(`/v1/notifications/${encodeURIComponent(userId)}/read`, { method: "POST" });
}

export interface CustomerOverview {
  balance: AccountBalance;
  transactions: Transaction[];
  baseline: CopilotBaseline;
}

/** Balance, recent transactions and the learned baseline in one request.
 * Replaces three separate calls the home screen fired per customer, so a
 * switch or refresh is a single round-trip. */
export async function customerOverview(
  userId: string,
  institution: string | null,
  limit = 60,
): Promise<CustomerOverview> {
  const res = await fetchJson<{
    balance: AccountBalance;
    transactions: ApiTransactionRow[];
    baseline: CopilotBaseline;
    scoring_baseline: {
      avg_amount: number;
      typical_hours: number[];
      known_recipients: string[];
      transaction_count: number;
      tenure_discount: number;
    } | null;
  }>(`/v1/sandbox/overview/${encodeURIComponent(userId)}?limit=${limit}${tenantParam(institution)}`);



  return {
    balance: res.balance,
    transactions: res.transactions.map(mapApiRow),
    baseline: res.baseline,
  };
}

export function getBranding(institutionId: string): Promise<Branding> {
  return fetchJson<Branding>(`/v1/branding/${encodeURIComponent(institutionId)}`);
}

export async function updateBranding(institutionId: string, patch: Partial<Branding>): Promise<Branding> {
  const res = await fetch(`${API_BASE}/v1/branding/${encodeURIComponent(institutionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not save branding.");
  }
  return (await res.json()) as Branding;
}

/** Multipart upload — deliberately not routed through fetchJson, which sets a
 * JSON content-type the browser must choose itself for a boundary. */
export async function uploadLogo(institutionId: string, file: File): Promise<Branding> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/branding/${encodeURIComponent(institutionId)}/logo`, {
    method: "POST",
    // Logo writes need the owner's session; without it every upload was a 401.
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Logo upload failed.");
  }
  return (await res.json()) as Branding;
}

export function removeLogo(institutionId: string): Promise<Branding> {
  return fetchJson<Branding>(`/v1/branding/${encodeURIComponent(institutionId)}/logo`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Balances, top-ups and customer security
// ---------------------------------------------------------------------------

export interface AccountBalance {
  user_id: string;
  balance: number;
  /** Money inside an active Ghost container: reserved, not debited. */
  held: number;
  /** What can actually be spent. */
  available: number;
  updated_at: string | null;
  limits: { max_amount: number; daily_max: number; daily_count: number };
}

export function accountBalance(userId: string, institution: string | null): Promise<AccountBalance> {
  return fetchJson<AccountBalance>(
    `/v1/accounts/${encodeURIComponent(userId)}?institution=${encodeURIComponent(institution ?? "")}`,
  );
}

export interface TopUpResult extends Omit<AccountBalance, "limits"> {
  credited: number;
  method: string;
  remaining_today: number;
  top_ups_left_today: number;
}

/** Thrown when a guard rejects a top-up. Names the limit rather than failing
 * generically, so the UI can say which one and when it resets. */
export class TopUpRejectedError extends Error {
  constructor(readonly limit: string, readonly resetsAt: string | null, message: string) {
    super(message);
    this.name = "TopUpRejectedError";
  }
}

export async function topUp(
  userId: string,
  amount: number,
  institution: string | null,
  method: string,
  reference?: string,
): Promise<TopUpResult> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ amount, method, institution_id: institution, reference }),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail ?? {};
    throw new TopUpRejectedError(d.limit ?? "unknown", d.resets_at ?? null, d.message ?? "Top-up rejected.");
  }
  if (!res.ok) throw new Error(`Top-up failed (${res.status})`);
  return (await res.json()) as TopUpResult;
}

export interface SecurityStatus {
  pin_set: boolean;
  /** Digits in this customer's PIN (or the configured length if none is set yet).
   * Absent from a backend that predates configurable PINs. */
  pin_length?: number;
  /** The operator's PIN rules, from the server's environment. Same caveat. */
  pin_policy?: { length: number; block_weak: boolean };
  pin_locked: boolean;
  pin_locked_until: string | null;
  failed_attempts: number;
  two_factor_enabled: boolean;
  /** False when the customer chose not to share their location. */
  location_shared?: boolean;
  passkey_count: number;
  passkeys?: { credential_id: string; device_label: string | null; created_at: string; last_used_at: string | null }[];
  contact_email: string | null;
  contact_phone: string | null;
  email_set: boolean;
  phone_set: boolean;
  /** A new email waiting for its confirmation code (masked). */
  pending_email?: string | null;
  /** A new phone number waiting for its confirmation code (masked). */
  pending_phone?: string | null;
  /** Codes go by email only; no SMS provider is connected. */
  sms_available?: boolean;
}

/** A contact change that needs the code sent to the new address or number. */
export interface ContactVerification {
  channel?: "email" | "sms";
  challenge_id: string;
  destination: string;
  sandbox_inbox?: boolean;
  debug_code?: string;
}

/** Digits to expect when a customer enters their existing PIN. Falls back to 4
 * for a backend that does not report it, so the boxes never break on a version
 * mismatch between the frontend and the API. */
export function pinLengthOf(status: SecurityStatus | null | undefined): number {
  return status?.pin_length ?? status?.pin_policy?.length ?? 4;
}

/** Digits a newly chosen PIN must have, under the operator's current rules. */
export function newPinLengthOf(status: SecurityStatus | null | undefined): number {
  return status?.pin_policy?.length ?? 4;
}

export function securityStatus(userId: string): Promise<SecurityStatus> {
  return fetchJson<SecurityStatus>(`/v1/accounts/${encodeURIComponent(userId)}/security`);
}

/** Register the customer's own email and/or phone for verification codes.
 * `currentPin` is required once a PIN exists (gated so codes can't be rerouted). */
export async function setContact(
  userId: string,
  input: { email?: string | null; phone?: string | null; currentPin?: string | null; stepupToken?: string | null },
  institution: string | null,
): Promise<SecurityStatus & { verification?: ContactVerification; verifications?: ContactVerification[] }> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/security/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      email: input.email ?? null,
      phone: input.phone ?? null,
      institution_id: institution,
      current_pin: input.currentPin ?? null,
      stepup_token: input.stepupToken ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not save your contact details.");
  }
  return (await res.json()) as SecurityStatus & { verification?: ContactVerification; verifications?: ContactVerification[] };
}

/** Confirm a new email with the code that was sent to it. */
export async function confirmContact(userId: string, challengeId: string, code: string): Promise<SecurityStatus> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/security/contact/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "That code didn't work.");
  }
  return (await res.json()) as SecurityStatus;
}

export async function setPin(
  userId: string,
  pin: string,
  currentPin: string | null,
  institution: string | null,
  stepupToken?: string | null,
): Promise<SecurityStatus> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/security/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ pin, current_pin: currentPin, institution_id: institution, stepup_token: stepupToken ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not set your PIN.");
  }
  return (await res.json()) as SecurityStatus;
}

export async function setTwoFactor(
  userId: string,
  enabled: boolean,
  currentPin?: string | null,
  stepupToken?: string | null,
): Promise<SecurityStatus> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/security/two-factor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ enabled, current_pin: currentPin ?? null, stepup_token: stepupToken ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not change this setting.");
  }
  return (await res.json()) as SecurityStatus;
}

/** Whether the customer's location is used. Turning it off needs a factor they
 * already have; turning it back on needs nothing. */
export async function setLocationSharing(
  userId: string,
  share: boolean,
  currentPin?: string | null,
  stepupToken?: string | null,
): Promise<SecurityStatus> {
  const res = await fetch(`${API_BASE}/v1/accounts/${encodeURIComponent(userId)}/security/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ share, current_pin: currentPin ?? null, stepup_token: stepupToken ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not change this setting.");
  }
  return (await res.json()) as SecurityStatus;
}

/** Thrown when a transfer exceeds available funds. Carries the shortfall so
 * the UI can say how much is missing rather than just refusing. */
export class InsufficientFundsError extends Error {
  constructor(readonly available: number, readonly requested: number, readonly shortfall: number, message: string) {
    super(message);
    this.name = "InsufficientFundsError";
  }
}
