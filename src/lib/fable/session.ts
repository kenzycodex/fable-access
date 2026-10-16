"use client";

// Fable SDK — banking-session tracker. The demo bank has no separate login
// screen, so the first visit to any /demo surface starts the session (that's
// the "login"). Stored in sessionStorage so it clears when the tab closes,
// exactly like a real banking session.

export type AuthMethod = "biometric" | "pin" | "password";

export interface BankingSession {
  loginTimestamp: number; // ms epoch
  /** How the customer signed in to their bank app. The demo bank has no
   * customer sign-in (staff pick a test customer), so it is null: sending a
   * made-up value would put a fabricated fact in the decision record. A real
   * integration passes the method its own login used. */
  authMethod: AuthMethod | null;
  previousFailedAttempts: number;
}

export interface SessionContext {
  login_timestamp: string; // ISO
  auth_method: AuthMethod | null;
  session_duration_seconds: number;
  previous_failed_attempts: number;
}

const KEY = "fable_session_v1";

/** Start the session if one isn't running; returns the active session. */
export function ensureSession(): BankingSession {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as BankingSession;
  } catch {
    // fall through to a fresh session
  }
  const session: BankingSession = {
    loginTimestamp: Date.now(),
    authMethod: null,
    previousFailedAttempts: 0,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // sessionStorage unavailable (private mode edge cases) — still usable in-memory
  }
  return session;
}

/** The live context Shield receives: duration is computed at call time. */
export function getSessionContext(): SessionContext {
  const s = ensureSession();
  return {
    login_timestamp: new Date(s.loginTimestamp).toISOString(),
    auth_method: s.authMethod,
    session_duration_seconds: Math.max(0, Math.round((Date.now() - s.loginTimestamp) / 1000)),
    previous_failed_attempts: s.previousFailedAttempts,
  };
}
