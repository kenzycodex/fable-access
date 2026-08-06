"use client";

// Active tenant + customer for the demo bank.
//
// The institution comes from the URL (/demo/{institution}); the customer is
// chosen in the demo bank's picker. Both are held in a plain module store
// rather than React context alone, because the non-React layers (api.ts,
// store.ts) need to read them when building a Shield request.
//
// An optional API key can be pasted into the demo bank's "Connect institution"
// field. That is the real integration path: a bank's app authenticates to
// Fable with the key it was issued at provisioning, and the backend derives
// the institution from the key rather than trusting the URL.

import { DEFAULT_INSTITUTION } from "./constants";

const CUSTOMER_KEY = "fable_active_customer";
const API_KEY_KEY = "fable_institution_api_key";

export { DEFAULT_INSTITUTION };

interface TenantState {
  institutionId: string;
  customerId: string | null;
  customerName: string | null;
}

let state: TenantState = {
  institutionId: DEFAULT_INSTITUTION,
  customerId: null,
  customerName: null,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeTenant(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getTenant(): TenantState {
  return state;
}

/** Called by the demo layout once the URL's institution is known. */
export function setInstitution(institutionId: string): void {
  if (state.institutionId === institutionId) return;
  state = { ...state, institutionId };
  restoreCustomer();
  emit();
}

/**
 * Select the customer for a tenant.
 *
 * `institutionId` is explicit because React runs child effects before parent
 * ones: the switcher can select a customer before the provider has told this
 * store which tenant is active, and keying off the stale value silently filed
 * the choice under the previous institution.
 */
export function setCustomer(customerId: string, customerName: string, institutionId?: string): void {
  const tenant = institutionId ?? state.institutionId;
  state = { ...state, institutionId: tenant, customerId, customerName };
  try {
    sessionStorage.setItem(
      `${CUSTOMER_KEY}:${tenant}`,
      JSON.stringify({ customerId, customerName }),
    );
  } catch {
    // sessionStorage unavailable; the in-memory value still works this session
  }
  emit();
}

/** Re-read the customer chosen for the current institution, if any. */
export function restoreCustomer(): void {
  try {
    const raw = sessionStorage.getItem(`${CUSTOMER_KEY}:${state.institutionId}`);
    if (!raw) {
      state = { ...state, customerId: null, customerName: null };
      return;
    }
    const parsed = JSON.parse(raw) as { customerId: string; customerName: string };
    state = { ...state, customerId: parsed.customerId, customerName: parsed.customerName };
  } catch {
    state = { ...state, customerId: null, customerName: null };
  }
}

/** The user_id Shield scores against. Falls back to the institution's Ada so a
 * transfer is never attributed to a null customer. */
export function activeUserId(): string {
  return state.customerId ?? `${state.institutionId}_ada`;
}

export function activeInstitution(): string {
  return state.institutionId;
}

// --- Optional API key ("Connect institution") -------------------------------

/** Persisted across sessions: a bank integrates once, not every visit. */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(API_KEY_KEY, key);
    else localStorage.removeItem(API_KEY_KEY);
  } catch {
    // ignore quota/private-mode failures
  }
  emit();
}

/** Auth headers for Fable API calls.
 *
 * Two independent credentials, and they mean different things:
 *
 * - `X-API-Key` is the institution's integration key, present when the demo
 *   bank has been connected to a tenant. It identifies the *bank*.
 * - `X-Fable-Session` is the console operator's signed session token. It
 *   identifies *who is signed in*, and is what lets the server derive the
 *   tenant for dashboard reads from a verified identity rather than from a
 *   query parameter the caller picks.
 *
 * Read lazily from the session store rather than captured at module load, so a
 * sign-in mid-session starts being honoured immediately.
 */
export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = getApiKey();
  if (key) headers["X-API-Key"] = key;

  if (typeof window !== "undefined") {
    try {
      // Imported lazily: tenant.ts is imported by api.ts, which store.ts also
      // imports, so a static import here would be circular.
      const raw = window.localStorage.getItem("fable_console_session");
      if (raw) {
        const s = JSON.parse(raw) as { token?: string | null; expiresAt?: number | null };
        const live = s.token && (!s.expiresAt || s.expiresAt > Math.floor(Date.now() / 1000));
        if (live && s.token) headers["X-Fable-Session"] = s.token;
      }
    } catch {
      // No session, or unreadable storage: fall through unauthenticated and
      // let the server decide.
    }
  }
  return headers;
}
