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
    const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${res.status}).`;
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

export function changePassword(oldPassword: string, newPassword: string) {
  return call<{ success: boolean }>("/auth/change-password", {
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
    status: string;
    cooling_window_minutes: number | null;
    created_at: string;
    resolved_at: string | null;
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
