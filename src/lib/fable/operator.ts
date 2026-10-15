"use client";

/**
 * The Fable operator platform's client: staff sign-in and the calls the
 * /operator screens make. Kept apart from the console's session on purpose: an
 * operator session lives under its own storage key and travels in its own
 * header (X-Fable-Operator), so it can never be sent as a bank's console session.
 */
import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { API_BASE } from "./api";

const KEY = "fable_operator_session";

export interface OperatorSession {
  token: string;
  expiresAt: number;
  email: string;
  role: OperatorRole;
}

export type OperatorRole = "platform_owner" | "platform_admin" | "support";

export const ROLE_LABEL: Record<OperatorRole, string> = {
  platform_owner: "Platform owner",
  platform_admin: "Platform admin",
  support: "Support",
};

const listeners = new Set<() => void>();
let cached: OperatorSession | null | undefined;

function readSession(): OperatorSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as OperatorSession) : null;
    return s && s.expiresAt > Math.floor(Date.now() / 1000) ? s : null;
  } catch {
    return null;
  }
}

export function setOperatorSession(s: OperatorSession | null): void {
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session lasts until the page is closed.
  }
  cached = s;
  listeners.forEach((l) => l());
}

export function useOperatorSession(): OperatorSession | null | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (cached === undefined ? (cached = readSession()) : cached),
    () => undefined,
  );
}

export class OperatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = cached ?? (typeof window !== "undefined" ? readSession() : null);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { "X-Fable-Operator": session.token } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && session && !path.startsWith("/operator/auth/")) {
    setOperatorSession(null);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : detail?.message ?? `Request failed (${res.status}).`;
    throw new OperatorError(message, res.status, detail);
  }
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// ── Sign-in ──────────────────────────────────────────────────────────────────

export type LoginStep =
  | { step: "mfa"; challenge: string }
  | { step: "enroll"; challenge: string; secret: string; otpauth_uri: string };

export const operatorLogin = (email: string, password: string) =>
  call<LoginStep>("/operator/auth/login", post({ email, password }));

export interface Operator {
  email: string;
  name: string | null;
  role: OperatorRole;
  status: "active" | "invited" | "removed";
  mfa: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export async function operatorVerify(challenge: string, code: string): Promise<Operator> {
  const r = await call<{ token: string; expires_at: number; operator: Operator }>(
    "/operator/auth/verify",
    post({ challenge, code }),
  );
  setOperatorSession({ token: r.token, expiresAt: r.expires_at, email: r.operator.email, role: r.operator.role });
  return r.operator;
}

export const acceptOperatorInvite = (token: string, password: string, name?: string) =>
  call<{ email: string }>("/operator/auth/accept-invite", post({ token, password, name: name || null }));

export function operatorSignOut(): void {
  setOperatorSession(null);
  window.location.assign("/operator/login");
}

// ── Institutions ─────────────────────────────────────────────────────────────

export interface InstitutionRow {
  institution_id: string;
  name: string;
  type: string | null;
  contact_email: string | null;
  mode: "sandbox" | "live";
  status: "active" | "suspended";
  created_at: string | null;
  suspended_reason: string | null;
  customers: number;
  real_customers: number;
  history: number;
  decisions_30d: number;
  last_decision: string | null;
  members: number;
  invites_pending: number;
  owners: number;
  setup_done: number;
  setup_total: number;
  ready_to_go_live: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  detail: string;
}

export interface Checklist {
  ready_to_go_live: boolean;
  done: number;
  total: number;
  items: ChecklistItem[];
}

export interface InstitutionDetail {
  institution: InstitutionRow;
  onboarding: Checklist;
  members: { email: string; name: string | null; role: string; status: string; created_at: string | null }[];
  recent_events: { event_type: string; payload: Record<string, unknown>; created_at: string }[];
  assistant: {
    override: AssistantOverride;
    usage: { questions_today: number; model_answers_today: number; questions: number; model_answers: number; input_tokens: number; output_tokens: number };
    platform: { ai_enabled: boolean; institution_daily_answers: number };
  };
}

export interface AssistantOverride {
  enabled: boolean | null;
  daily_answers: number | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Invite {
  email: string;
  emailed: boolean;
  invite_link: string | null;
}

export const useInstitutions = () =>
  useSWR(["operator:institutions"], () => call<{ institutions: InstitutionRow[]; total: number }>("/operator/institutions"));

export const useInstitution = (id: string) =>
  useSWR(["operator:institution", id], () => call<InstitutionDetail>(`/operator/institutions/${encodeURIComponent(id)}`));

export const provisionInstitution = (body: { name: string; type?: string; owner_email: string; owner_name?: string }) =>
  call<{ institution: InstitutionRow; owner_invite: Invite }>("/operator/institutions", post(body));

export const suspendInstitution = (id: string, reason: string) =>
  call<InstitutionRow>(`/operator/institutions/${encodeURIComponent(id)}/suspend`, post({ reason }));

export const reactivateInstitution = (id: string) =>
  call<InstitutionRow>(`/operator/institutions/${encodeURIComponent(id)}/reactivate`, { method: "POST" });

export const inviteOwner = (id: string, email: string, name?: string) =>
  call<Invite>(`/operator/institutions/${encodeURIComponent(id)}/owner-invite`, post({ email, name: name || null }));

export const clearInstitutionData = (id: string, confirm: string, reason: string) =>
  call<{ customers_removed: number }>(`/operator/institutions/${encodeURIComponent(id)}/clear-data`, post({ confirm, reason }));

export const deleteInstitution = (id: string, confirm: string, reason: string) =>
  call<{ rows_removed: number }>(`/operator/institutions/${encodeURIComponent(id)}/delete`, post({ confirm, reason }));

/** Download the institution's export, using the operator session. */
export async function downloadInstitutionExport(id: string): Promise<void> {
  const session = cached ?? readSession();
  const res = await fetch(`${API_BASE}/operator/institutions/${encodeURIComponent(id)}/export.zip`, {
    headers: session ? { "X-Fable-Operator": session.token } : {},
  });
  if (!res.ok) throw new OperatorError(`Export failed (${res.status}).`, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `fable-${id}-export.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Team and audit ───────────────────────────────────────────────────────────

export const useOperatorMe = () => useSWR(["operator:me"], () => call<Operator>("/operator/me"));
export const useOperatorTeam = () => useSWR(["operator:team"], () => call<{ operators: Operator[] }>("/operator/team"));

export const inviteOperator = (email: string, role: OperatorRole, name?: string) =>
  call<Operator & Invite>("/operator/team", post({ email, role, name: name || null }));

export const changeOperatorRole = (email: string, role: OperatorRole) =>
  call<Operator>(`/operator/team/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ role }) });

export const removeOperator = (email: string) =>
  call<{ email: string }>(`/operator/team/${encodeURIComponent(email)}`, { method: "DELETE" });

export interface PlatformEvent {
  id: number;
  user_id?: string | null;
  institution_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: string;
}

export type AuditScope = "operators" | "all" | "security";

export interface AuditQuery {
  scope: AuditScope;
  institution?: string;
  type?: string;
  q?: string;
  since?: string;
}

export interface AuditPage {
  events: PlatformEvent[];
  next_before: number | null;
  types: { event_type: string; n: number }[];
}

function auditParams(query: AuditQuery, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

export const fetchAuditPage = (query: AuditQuery, before?: number) =>
  call<AuditPage>(`/operator/audit?${auditParams(query, { before, limit: 50 })}`);

/** The first page of a view; later pages are fetched with fetchAuditPage. */
export const useAuditPage = (query: AuditQuery) =>
  useSWR(["operator:audit", JSON.stringify(query)], () => fetchAuditPage(query), { keepPreviousData: true });

/** Recent operator actions (the overview's feed). */
export const usePlatformAudit = () =>
  useSWR(["operator:audit:recent"], () => call<AuditPage>("/operator/audit?scope=operators&limit=50"));

export async function downloadAuditCsv(query: AuditQuery): Promise<void> {
  const session = cached ?? readSession();
  const res = await fetch(`${API_BASE}/operator/audit/export.csv?${auditParams(query)}`, {
    headers: session ? { "X-Fable-Operator": session.token } : {},
  });
  if (!res.ok) throw new OperatorError(`Export failed (${res.status}).`, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `fable-audit-${query.scope}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Overview ─────────────────────────────────────────────────────────────────

export interface PlatformOverview {
  institutions: number;
  stages: { setting_up: number; ready: number; live: number; suspended: number };
  customers: number;
  real_customers: number;
  decisions_30d: number;
  decisions_by_day: { day: string; n: number; blocked: number; flagged: number }[];
  operators: number;
  attention: { institution_id: string; name: string; reason: string; setup_done: number; setup_total: number }[];
  recent_events: PlatformEvent[];
  assistant: { today: UsageTotals; week: UsageTotals };
  security: { access_denied_24h: number; access_denied_7d: number };
  newest: {
    institution_id: string;
    name: string;
    created_at: string | null;
    setup_done: number;
    setup_total: number;
    mode: "sandbox" | "live";
    status: "active" | "suspended";
    ready_to_go_live: boolean;
  }[];
}

export const usePlatformOverview = () =>
  useSWR(["operator:overview"], () => call<PlatformOverview>("/operator/overview"), { refreshInterval: 60_000 });

// ── Ask Fable controls ───────────────────────────────────────────────────────

export interface UsageTotals {
  questions: number;
  model_answers: number;
  cached_answers: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AssistantSettings {
  ai_enabled: boolean;
  per_person_per_minute: number;
  per_person_per_day: number;
  institution_daily_answers: number;
  max_output_tokens: number;
  max_history_turns: number;
  max_question_chars: number;
  cache_minutes: number;
}

export interface AssistantAdmin {
  settings: AssistantSettings;
  fields: Record<keyof AssistantSettings, { default: number | boolean; min: number | boolean; max: number | boolean; help: string }>;
  providers: Record<"openai" | "anthropic", { configured: boolean; model: string }>;
  usage: {
    days: number;
    today: UsageTotals;
    totals: UsageTotals;
    by_day: (UsageTotals & { day: string })[];
    by_institution: (UsageTotals & {
      institution_id: string;
      name: string | null;
      questions_today: number;
      model_answers_today: number;
      people: number;
    })[];
  };
}

export const useAssistantAdmin = (days = 30) =>
  useSWR(["operator:assistant", days], () => call<AssistantAdmin>(`/operator/assistant?days=${days}`));

export const saveAssistantSettings = (changes: Partial<AssistantSettings>) =>
  call<{ settings: AssistantSettings }>("/operator/assistant", { method: "PUT", body: JSON.stringify(changes) });

export const setInstitutionAssistant = (id: string, body: { enabled: boolean | null; daily_answers: number | null }) =>
  call<AssistantOverride>(`/operator/institutions/${encodeURIComponent(id)}/assistant`, { method: "PUT", body: JSON.stringify(body) });

// ── Integration keys ─────────────────────────────────────────────────────────

export interface SecretVersion {
  name: string;
  version: number;
  status: "active" | "retired" | "revoked";
  last4: string | null;
  fingerprint: string | null;
  rotation_reason: string | null;
  set_by: string | null;
  approved_by: string | null;
  created_at: string | null;
  retired_at: string | null;
}

export interface SecretItem {
  name: string;
  label: string;
  group: string;
  kind: "secret" | "model" | "config";
  source: "environment" | "console" | "unset";
  unit: string | null;
  help: string | null;
  choices: number[] | null;
  value_type: "str" | "int" | "float" | "bool";
  minimum: number | null;
  maximum: number | null;
  note: string | null;
  display: string | null;
  default: string | null;
  active: SecretVersion | null;
  rotation_due: string | null;
  rotate_days: number;
  versions: SecretVersion[];
  allowed_models: string[] | null;
}

export interface SecretChange {
  id: string;
  name: string;
  action: "set" | "rollback" | "remove";
  status: "pending" | "cooling" | "applied" | "rejected" | "cancelled" | "expired";
  rotation_reason: string | null;
  reason: string | null;
  target_version: number | null;
  last4: string | null;
  fingerprint: string | null;
  proposed_by: string;
  single_approver: number;
  apply_after: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export interface SecretsOverview {
  items: SecretItem[];
  pending: SecretChange[];
  owners: number;
  write_enabled: boolean;
  master_key: boolean;
  key_id: string;
  me: { can_change: boolean; passkeys: number; locked_until: string | null };
}

/** One fresh factor: a passkey assertion (preferred) or an authenticator code. */
export interface StepUp {
  code?: string;
  challenge_id?: string;
  passkey?: Record<string, unknown>;
}

export interface StepUpOptions {
  totp: boolean;
  passkey: { challenge_id: string; options: import("./webauthn").PublicKeyCredentialRequestOptionsJSON } | null;
  locked_until: string | null;
}

export const useSecrets = () => useSWR(["operator:secrets"], () => call<SecretsOverview>("/operator/secrets"));
export const stepUpOptions = () => call<StepUpOptions>("/operator/secrets/stepup", { method: "POST" });
export const proposeSecret = (name: string, body: { value: string; reason: string; rotation: "routine" | "compromised"; note?: string; step_up: StepUp }) =>
  call<SecretChange>(`/operator/secrets/${encodeURIComponent(name)}/propose`, post(body));
export const proposeSecrets = (body: {
  items: { name: string; value: string; rotation?: "routine" | "compromised"; note?: string }[];
  reason: string;
  step_up: StepUp;
}) => call<{ changes: SecretChange[] }>("/operator/secrets/batch", post(body));
export const rollbackSecret = (name: string, body: { version: number; reason: string; step_up: StepUp }) =>
  call<SecretChange>(`/operator/secrets/${encodeURIComponent(name)}/rollback`, post(body));
export const removeSecret = (name: string, body: { reason: string; step_up: StepUp }) =>
  call<SecretChange>(`/operator/secrets/${encodeURIComponent(name)}/remove`, post(body));
export const approveSecretChange = (id: string, step_up: StepUp) =>
  call<SecretChange>(`/operator/secrets/changes/${encodeURIComponent(id)}/approve`, post({ step_up }));
export const rejectSecretChange = (id: string, reason?: string) =>
  call<SecretChange>(`/operator/secrets/changes/${encodeURIComponent(id)}/reject`, post({ reason: reason || null }));
export const testSecret = (name: string) =>
  call<{ ok: boolean; message: string }>(`/operator/secrets/${encodeURIComponent(name)}/test`, { method: "POST" });

// ── Engine (Shield's weights and thresholds) ────────────────────────────────

export type EngineStatus =
  | "draft" | "proposed" | "cooling" | "approved" | "shadow" | "active" | "retired"
  | "rejected" | "cancelled" | "discarded" | "expired";

export interface EngineParams {
  weights: Record<string, number>;
  thresholds: Record<string, { block: number; flag: number }>;
}

export type DecisionAction = "PASS" | "FLAG" | "BLOCK";
export type DecisionMatrix = Record<DecisionAction, Record<DecisionAction, number>>;

export interface BacktestGroup {
  n: number;
  changed: number;
  block_before: number;
  block_after: number;
  flag_before: number;
  flag_after: number;
  block_rate_before: number;
  block_rate_after: number;
}

export interface OutcomeLabel {
  n: number;
  low_sample: boolean;
  before: Partial<Record<DecisionAction, number>>;
  after: Partial<Record<DecisionAction, number>>;
  caught_before?: number;
  caught_after?: number;
  missed_before?: number;
  missed_after?: number;
  newly_caught?: number;
  newly_missed?: number;
  blocked_before?: number;
  blocked_after?: number;
  newly_blocked?: number;
}

export interface Metrics {
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  n: number;
  low_sample: boolean;
}

export interface BacktestReport {
  days: number;
  since: string;
  run_at: string;
  params_hash: string;
  rows: { replayed: number; exact: number; approximate: number; skipped: number; fidelity: number; truncated: boolean };
  matrix: DecisionMatrix;
  overall: BacktestGroup;
  by_channel: (BacktestGroup & { channel: string })[];
  by_bank: (BacktestGroup & { institution_id: string })[];
  outcomes: {
    fraud: OutcomeLabel;
    legitimate: OutcomeLabel;
    ghost_cancelled: OutcomeLabel;
    no_outcome_blocked: number;
    metrics_before: Metrics;
    metrics_after: Metrics;
  };
  warnings: { kind: string; scope?: string; message: string }[];
  needs_ack: boolean;
  env_keys: { path: string; env: string }[];
  policy_note: string;
  min_sample: number;
}

export interface EngineVersion {
  version: number;
  status: EngineStatus;
  params: EngineParams;
  params_hash: string;
  approved_hash: string | null;
  base_version: number | null;
  rollback_of: number | null;
  backtest_at: string | null;
  note: string | null;
  drift_note: string | null;
  impact_ack: boolean;
  created_by: string | null;
  created_at: string | null;
  proposed_by: string | null;
  proposed_at: string | null;
  single_approver: boolean;
  apply_after: string | null;
  expires_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decided_by: string | null;
  shadow_started_at: string | null;
  shadow_until: string | null;
  activated_at: string | null;
  activated_by: string | null;
  retired_at: string | null;
  backtest_summary?: { days: number; run_at: string; changed: number; replayed: number; warnings: number; fresh: boolean };
}

export interface EngineVersionDetail extends EngineVersion {
  backtest?: BacktestReport;
  changes: { path: string; label: string; from: number; to: number }[];
  errors: string[];
  drift: string[];
}

export interface ShadowDiff {
  version: number | null;
  since?: string;
  scored: number;
  disagreements: number;
  matrix?: DecisionMatrix;
  recent?: {
    id: string; institution_id: string; channel: string; amount: number; risk_score: number;
    action_taken: DecisionAction; shadow_score: number; shadow_action: DecisionAction; created_at: string;
  }[];
}

export interface EngineOverview {
  active: EngineVersion;
  effective: { params: EngineParams; hash: string };
  shadow: (EngineVersion & { diff: ShadowDiff | null }) | null;
  versions: EngineVersion[];
  activations: { id: number; version: number; started_at: string; ended_at: string | null; by: string; kind: string }[];
  previous_live: number | null;
  env_keys: { path: string; env: string; value: number }[];
  bounds: {
    weight_max: number; floors: Record<string, number>; threshold_min: number; threshold_max: number;
    min_gap: number; max_step: number; drift_cap: number; drift_days: number; windows: number[];
    backtest_max_age_hours: number; shadow_days_default: number; shadow_days_max: number;
  };
  catalogue: {
    groups: { group: string; weights: { key: string; label: string; default: number; env: string }[] }[];
    channels: string[];
  };
  owners: number;
  me: { role: OperatorRole; email: string; can_draft: boolean; can_decide: boolean };
}

const engine = (path: string) => `/operator/engine${path}`;
const v = (n: number, rest = "") => engine(`/versions/${n}${rest}`);

export const useEngine = () => useSWR(["operator:engine"], () => call<EngineOverview>(engine("")));
export const useEngineVersion = (n: number | null) =>
  useSWR(n ? ["operator:engine:version", n] : null, () => call<EngineVersionDetail>(v(n!)));
export const useShadowDiff = (on: boolean) =>
  useSWR(on ? ["operator:engine:shadow"] : null, () => call<ShadowDiff>(engine("/shadow-diff")), { refreshInterval: 30_000 });
export const createEngineDraft = (params: EngineParams, note?: string) =>
  call<EngineVersionDetail>(engine("/drafts"), post({ params, note: note || null }));
export const updateEngineDraft = (n: number, params: EngineParams, note?: string) =>
  call<EngineVersionDetail>(v(n), { method: "PUT", body: JSON.stringify({ params, note: note || null }) });
export const backtestEngine = (n: number, days: number) => call<BacktestReport>(v(n, "/backtest"), post({ days }));
export const proposeEngine = (n: number, body: { note?: string; drift_note?: string; acknowledge_impact: boolean; step_up: StepUp }) =>
  call<EngineVersionDetail>(v(n, "/propose"), post(body));
export const approveEngine = (n: number, body: { acknowledge_impact: boolean; step_up: StepUp }) =>
  call<EngineVersionDetail>(v(n, "/approve"), post(body));
export const rejectEngine = (n: number, reason?: string) => call<EngineVersionDetail>(v(n, "/reject"), post({ reason: reason || null }));
export const shadowEngine = (n: number, days: number, step_up: StepUp) => call<EngineVersionDetail>(v(n, "/shadow"), post({ days, step_up }));
export const stopShadowEngine = (n: number) => call<EngineVersionDetail>(v(n, "/shadow/stop"), { method: "POST" });
export const promoteEngine = (n: number, step_up: StepUp) => call<EngineVersionDetail>(v(n, "/promote"), post({ step_up }));
export const rollbackEngine = (version: number, reason: string, step_up: StepUp) =>
  call<EngineVersionDetail>(engine("/rollback"), post({ version, reason, step_up }));

export interface OperatorPasskey {
  credential_id: string;
  label: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export const useOperatorPasskeys = () => useSWR(["operator:passkeys"], () => call<{ passkeys: OperatorPasskey[] }>("/operator/passkeys"));

export async function addOperatorPasskey(label: string): Promise<void> {
  const { createPasskeyCredential } = await import("./webauthn");
  const begun = await call<{ challenge_id: string; options: import("./webauthn").PublicKeyCredentialCreationOptionsJSON }>(
    "/operator/passkeys/register", { method: "POST" });
  const credential = await createPasskeyCredential(begun.options);
  await call("/operator/passkeys/register/finish", post({ challenge_id: begun.challenge_id, credential, label }));
}

export const removeOperatorPasskey = (id: string, step_up: StepUp) =>
  call(`/operator/passkeys/${encodeURIComponent(id)}/remove`, post({ step_up }));

/** Whether a role may do something: support reads, admins act on banks, owners do everything. */
export function can(role: OperatorRole | undefined, minimum: OperatorRole): boolean {
  const rank: Record<OperatorRole, number> = { support: 0, platform_admin: 1, platform_owner: 2 };
  return role ? rank[role] >= rank[minimum] : false;
}
