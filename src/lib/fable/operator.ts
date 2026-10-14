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
  institution_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export const usePlatformAudit = () =>
  useSWR(["operator:audit"], () => call<{ events: PlatformEvent[] }>("/operator/audit?limit=200"));

/** Whether a role may do something: support reads, admins act on banks, owners do everything. */
export function can(role: OperatorRole | undefined, minimum: OperatorRole): boolean {
  const rank: Record<OperatorRole, number> = { support: 0, platform_admin: 1, platform_owner: 2 };
  return role ? rank[role] >= rank[minimum] : false;
}
