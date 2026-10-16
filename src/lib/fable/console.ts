/**
 * The institution console's own API: the review queue, the team, risk policy,
 * keys, webhooks and exports.
 *
 * Kept apart from api.ts, which also serves the public demo bank, because every
 * call here needs a signed-in console session and reports the server's own
 * error message so a refused action says why ("Only an owner can change this")
 * rather than a bare status code.
 */
import { API_BASE, mapApiRow, type ApiTransactionRow } from "./api";
import { authHeaders } from "./tenant";
import type { ReviewOutcome, ReviewState, Transaction } from "./types";

export class ConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : typeof body?.detail?.message === "string"
          ? body.detail.message
          : `Request failed (${res.status}).`;
    throw new ConsoleError(detail, res.status);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Who is signed in
// ---------------------------------------------------------------------------

export type Role = "owner" | "analyst" | "viewer" | "service";

export interface Me {
  email: string;
  name: string | null;
  role: Role;
  institution_id: string;
}

export const me = () => call<Me>("/auth/me");

/** Change the signed-in user's password. The response carries a fresh session:
 * the change ends every other session for the account, but not this one. */
export function changePassword(oldPassword: string, newPassword: string) {
  return call<{ success: boolean; token: string; expires_at: number; institution_id: string }>("/auth/change-password", {
    method: "POST",
    ...json({ old_password: oldPassword, new_password: newPassword }),
  });
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export interface ReviewCounts {
  open: number;
  in_review: number;
  escalated: number;
  resolved: number;
  active: number;
  confirmed_fraud: number;
  confirmed_legitimate: number;
}

export type QueueView = "active" | ReviewState;

export interface QueueQuery {
  state?: QueueView;
  action?: "FLAG" | "BLOCK";
  assignee?: "me" | string;
  limit?: number;
  offset?: number;
}

export async function reviewQueue(q: QueueQuery = {}): Promise<{ total: number; cases: Transaction[] }> {
  const params = new URLSearchParams();
  if (q.state) params.set("state", q.state);
  if (q.action) params.set("action", q.action);
  if (q.assignee) params.set("assignee", q.assignee);
  params.set("limit", String(q.limit ?? 100));
  if (q.offset) params.set("offset", String(q.offset));
  const res = await call<{ total: number; cases: ApiTransactionRow[] }>(`/v1/review/queue?${params.toString()}`);
  return { total: res.total, cases: res.cases.map(mapApiRow) };
}

export const reviewCounts = () => call<ReviewCounts>("/v1/review/counts");

export interface CaseNote {
  id: number;
  author: string;
  body: string;
  created_at: string;
}

export interface CaseDetail {
  case: Transaction;
  notes: CaseNote[];
  history: {
    transactions: number;
    avg_amount: number;
    max_amount: number;
    first_seen: string | null;
    previously_flagged: number;
    confirmed_fraud: number;
    paid_this_recipient_before: number;
  };
  containment: {
    ghost_id: string;
    status: "HELD" | "RELEASED" | "CANCELLED" | "EXPIRED";
    cooling_window_minutes: number | null;
    created_at: string;
    expires_at?: string | null;
    resolved_at: string | null;
    resolved_by?: string | null;
    resolution_note?: string | null;
    transaction_id?: string | null;
  } | null;
  activity: { event_type: string; payload: Record<string, unknown>; created_at: string }[];
}

export async function caseDetail(id: string): Promise<CaseDetail> {
  const res = await call<Omit<CaseDetail, "case"> & { case: ApiTransactionRow }>(
    `/v1/review/${encodeURIComponent(id)}`,
  );
  return { ...res, case: mapApiRow(res.case) };
}

const caseAction = <T>(id: string, action: string, body?: unknown) =>
  call<T>(`/v1/review/${encodeURIComponent(id)}/${action}`, { method: "POST", ...(body ? json(body) : {}) });

export const assignCase = (id: string, assignee: string | null) => caseAction(id, "assign", { assignee });
export const escalateCase = (id: string, reason?: string) => caseAction(id, "escalate", { reason: reason || null });
export const addCaseNote = (id: string, body: string) => caseAction<CaseNote>(id, "notes", { body });
export const resolveCase = (id: string, outcome: ReviewOutcome, note?: string) =>
  caseAction(id, "resolve", { outcome, note: note || null });
export const reopenCase = (id: string) => caseAction(id, "reopen");

/** Cancel a held transfer from the console. The money stays with the customer. */
export const cancelCaseHold = (id: string, note: string) =>
  call(`/v1/review/${encodeURIComponent(id)}/hold/cancel`, { method: "POST", ...json({ note }) });

/** Release a held transfer after the bank confirmed it with the customer by its
 * own means. Owners only; the note says how the customer confirmed. */
export const releaseCaseHold = (id: string, note: string) =>
  call(`/v1/review/${encodeURIComponent(id)}/hold/release`, { method: "POST", ...json({ note }) });

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface TeamMember {
  email: string;
  name: string | null;
  role: Exclude<Role, "service">;
  status: "active" | "invited";
  created_at: string;
  you: boolean;
}

export const teamMembers = () => call<{ members: TeamMember[]; you: { email: string; role: Role } }>("/v1/team");

export const inviteMember = (email: string, role: TeamMember["role"], name?: string) =>
  call<{ email: string; emailed: boolean; invite_link: string | null }>("/v1/team/invite", {
    method: "POST",
    ...json({ email, role, name: name || null }),
  });

export const changeMemberRole = (email: string, role: TeamMember["role"]) =>
  call(`/v1/team/${encodeURIComponent(email)}`, { method: "PATCH", ...json({ role }) });

export const removeMember = (email: string) => call(`/v1/team/${encodeURIComponent(email)}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Risk policy, keys and mode
// ---------------------------------------------------------------------------

export interface RiskPolicy {
  flag_threshold: number;
  block_threshold: number;
  hold_high_minutes: number;
  hold_medium_minutes: number;
  hold_low_minutes: number;
  /** 1 when a customer may route a flagged transfer into a hold, not only a blocked one. */
  hold_on_flag: number;
  custom: string[];
  updated_by: string | null;
  updated_at: string | null;
}

export type PolicyFields = Omit<RiskPolicy, "custom" | "updated_by" | "updated_at">;

export interface PolicyResponse {
  policy: RiskPolicy;
  defaults: PolicyFields;
  mode: "sandbox" | "live";
}

const inst = (id: string) => `/v1/institutions/${encodeURIComponent(id)}`;

export const riskPolicy = (institutionId: string) => call<PolicyResponse>(`${inst(institutionId)}/settings`);

export const updateRiskPolicy = (institutionId: string, changes: Partial<PolicyFields>, reset: string[] = []) =>
  call<PolicyResponse>(`${inst(institutionId)}/settings`, { method: "PUT", ...json({ ...changes, reset }) });

export const rotateApiKey = (institutionId: string) =>
  call<{ api_key: string; masked_key: string }>(`${inst(institutionId)}/keys/rotate`, { method: "POST" });

export const setInstitutionMode = (institutionId: string, mode: "sandbox" | "live") =>
  call<{ mode: "sandbox" | "live" }>(`${inst(institutionId)}/mode`, { method: "PUT", ...json({ mode }) });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookDelivery {
  id?: number;
  event: string;
  status_code: number | null;
  ok: boolean | number;
  error: string | null;
  attempt?: number;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  created_by: string | null;
  last_delivery: WebhookDelivery | null;
}

export const webhookEndpoints = () => call<{ endpoints: WebhookEndpoint[]; events: string[] }>("/v1/webhooks");

export const createWebhook = (url: string, events: string[]) =>
  call<WebhookEndpoint & { secret: string }>("/v1/webhooks", { method: "POST", ...json({ url, events }) });

export const deleteWebhook = (id: string) => call(`/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });

export const testWebhook = (id: string) =>
  call<{ ok: boolean; status_code: number | null; error: string | null }>(
    `/v1/webhooks/${encodeURIComponent(id)}/test`,
    { method: "POST" },
  );

export const webhookDeliveries = (id: string) =>
  call<{ deliveries: WebhookDelivery[] }>(`/v1/webhooks/${encodeURIComponent(id)}/deliveries`);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Fetch a CSV with the session attached and hand it to the browser as a file.
 * A plain link cannot carry the session header, so it would always be refused. */
export async function downloadCsv(
  kind: "transactions" | "audit",
  range: { from?: string; to?: string; action?: string } = {},
): Promise<void> {
  const q = new URLSearchParams();
  if (range.from) q.set("from", range.from);
  if (range.to) q.set("to", range.to);
  if (range.action) q.set("action", range.action);
  const res = await fetch(`${API_BASE}/v1/dashboard/export/${kind}.csv?${q.toString()}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ConsoleError(typeof body?.detail === "string" ? body.detail : "Export failed.", res.status);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `fable-${kind}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** A YYYY-MM-DD string for `days` ago, in UTC to match the API's timestamps. */
export function daysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/** The API stores naive UTC timestamps; read them as UTC. */
export function parseUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Board report
// ---------------------------------------------------------------------------

export interface BoardReport {
  institution: { id: string; name: string };
  period: { from: string | null; to: string | null };
  generated_at: string;
  volume: {
    transactions: number;
    value_ngn: number;
    passed: number;
    flagged: number;
    blocked: number;
    frictionless_rate: number | null;
  };
  protection: { kept_from_fraud_ngn: number; transfers_stopped: number; blocked_value_ngn: number };
  review: {
    open: number;
    in_review: number;
    escalated: number;
    resolved: number;
    fraud: number;
    legitimate: number;
    reviewed: number;
    precision: number | null;
  };
  latency_ms: { p50: number; p95: number; p99: number } | null;
  channels: { label: string; total: number; risky: number }[];
  top_signals: { code: string; label: string; count: number }[];
  controls: {
    identity_checks_passed: number;
    identity_checks_failed: number;
    holds_created: number;
    holds_cancelled: number;
    policy_changes: number;
    team_changes: number;
    key_rotations: number;
  };
  policy: RiskPolicy;
}

export function boardReport(range: { from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (range.from) q.set("from", range.from);
  if (range.to) q.set("to", range.to);
  return call<BoardReport>(`/v1/dashboard/report?${q.toString()}`);
}

// ---------------------------------------------------------------------------
// Customers, imports, onboarding and the sandbox
// ---------------------------------------------------------------------------

export interface NewCustomer {
  reference: string;
  name?: string;
  phone?: string;
  email?: string;
  segment?: string;
  kind?: "test" | "real";
  opening_balance?: number;
}

export const addCustomer = (body: NewCustomer) =>
  call<import("./api").BankCustomer>("/v1/customers", { method: "POST", ...json(body) });

export const editCustomer = (id: string, body: { name?: string; phone?: string; email?: string; segment?: string; status?: "active" | "closed" }) =>
  call<import("./api").BankCustomer>(`/v1/customers/${encodeURIComponent(id)}`, { method: "PATCH", ...json(body) });

export type ImportKind = "customers" | "transactions";

export interface ImportError {
  line: number | null;
  field: string;
  message: string;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  filename: string | null;
  status: "validated" | "applying" | "completed" | "failed" | "discarded";
  total: number;
  valid: number;
  invalid: number;
  inserted: number;
  skipped: number;
  errors?: ImportError[];
  created_by: string | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface ImportSummary {
  customers: { total: number; real: number; test: number };
  history: { transfers: number; from: string | null; to: string | null };
}

export const importSummary = () => call<ImportSummary>("/v1/imports/summary");
export const importJobs = () => call<{ imports: ImportJob[] }>("/v1/imports");
export const importJob = (id: string) => call<ImportJob>(`/v1/imports/${encodeURIComponent(id)}`);
export const applyImport = (id: string) => call<ImportJob>(`/v1/imports/${encodeURIComponent(id)}/apply`, { method: "POST" });
export const discardImport = (id: string) => call(`/v1/imports/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Upload a CSV for validation. Nothing is applied until applyImport. */
export async function uploadImport(kind: ImportKind, file: File): Promise<ImportJob> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/imports/${kind}/csv`, { method: "POST", body: form, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ConsoleError(typeof body?.detail === "string" ? body.detail : "Upload failed.", res.status);
  }
  return (await res.json()) as ImportJob;
}

/** Download a CSV template with the expected columns and an example row. */
export async function downloadTemplate(kind: ImportKind): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/imports/templates/${kind}.csv`, { headers: authHeaders() });
  if (!res.ok) throw new ConsoleError("Template download failed.", res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `fable-${kind}-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  detail: string;
}

export interface Onboarding {
  mode: "sandbox" | "live";
  ready_to_go_live: boolean;
  required_remaining: string[];
  done: number;
  total: number;
  items: ChecklistItem[];
  agreements: { confirmed_at: string | null; confirmed_by: string | null };
}

export const onboarding = () => call<Onboarding>("/v1/onboarding");
export const confirmAgreements = () =>
  call<Onboarding>("/v1/onboarding/agreements", { method: "POST", ...json({ data_processing_agreement: true, dpia: true }) });

export const resetSandbox = (confirm: string) =>
  call<{ customers_removed: number }>("/v1/sandbox/reset", { method: "POST", ...json({ confirm }) });
