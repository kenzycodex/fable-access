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

const CUSTOMER_KEY = "fable_active_customer";
const API_KEY_KEY = "fable_institution_api_key";

export const DEFAULT_INSTITUTION = "meridian";

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

export function setCustomer(customerId: string, customerName: string): void {
  state = { ...state, customerId, customerName };
  try {
    sessionStorage.setItem(
      `${CUSTOMER_KEY}:${state.institutionId}`,
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

/** Auth header for Fable API calls, when the demo bank has been connected. */
export function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}
