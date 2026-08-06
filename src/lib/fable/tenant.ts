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
/** What we remember about a connected institution.
 *
 * Deliberately not the key. The raw `fbl_live_…` value used to be kept in
 * localStorage and sent as `X-API-Key` from the demo bank — a page anyone can
 * open — so an integration secret worth full tenant access was readable by any
 * script on the origin and persisted across restarts.
 *
 * It was also unnecessary. The connect flow already resolves the key against
 * the API and redirects to that tenant's URL, and the server derives the
 * institution from the URL slug for anything without a stronger credential. So
 * the key proves nothing at write time that the URL does not already say, and
 * we keep only what the UI needs to show: which institution, and a mask.
 */
export interface ConnectedInstitution {
  institutionId: string;
  name: string;
  maskedKey: string;
}

const CONNECTED_KEY = "fable_connected_institution";

export function getConnected(): ConnectedInstitution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONNECTED_KEY);
    return raw ? (JSON.parse(raw) as ConnectedInstitution) : null;
  } catch {
    return null;
  }
}

export function setConnected(next: ConnectedInstitution | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next) localStorage.setItem(CONNECTED_KEY, JSON.stringify(next));
    else localStorage.removeItem(CONNECTED_KEY);
    // Clear the legacy raw-key entry from any browser that stored one before
    // this change, so the secret does not linger.
    localStorage.removeItem(API_KEY_KEY);
  } catch {
    // storage unavailable; connection state is per-session only
  }
}

export function maskKey(key: string): string {
  return key.length <= 16 ? "•".repeat(8) : `${key.slice(0, 13)}${"•".repeat(8)}${key.slice(-4)}`;
}

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

  // No X-API-Key. The institution's integration key is a server-to-server
  // secret and has no business in a browser, least of all on the demo bank,
  // which is a public page. Writes from the demo bank are attributed by the
  // institution slug in the URL, which the server resolves and which carries
  // no secret. A real integrating bank sends the key from its own backend.

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
