// Server-side guard for the Next.js route handlers that spend a paid or
// sensitive third-party lookup (Paystack account-name resolution).
//
// /api/resolve-account was open to the internet, so anyone could enumerate
// account holders' names through it and spend the Paystack quota. It now needs
// a signed-in console session, checked against the Fable API, and each session
// and each address is rate limited. The limits are per server instance (on
// Vercel, per function instance), which slows abuse rather than making it
// impossible; the session requirement is the real gate.

import { API_BASE } from "@/lib/fable/base";

const SESSION_CACHE_MS = 60_000;
const PER_SESSION_PER_MINUTE = 30;
const PER_ADDRESS_PER_MINUTE = 60;

const verified = new Map<string, number>();
const hits = new Map<string, number[]>();

function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

async function sessionIsValid(token: string): Promise<boolean> {
  const until = verified.get(token);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { "X-Fable-Session": token },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    verified.set(token, Date.now() + SESSION_CACHE_MS);
    return true;
  } catch {
    return false;
  }
}

/** null when the request may proceed, else the status and message to return. */
export async function guardLookup(request: Request): Promise<{ status: number; error: string } | null> {
  const token = request.headers.get("x-fable-session") ?? "";
  const address = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!allow(`ip:${address}`, PER_ADDRESS_PER_MINUTE)) {
    return { status: 429, error: "Too many lookups. Try again in a minute." };
  }
  if (!token || !(await sessionIsValid(token))) {
    return { status: 401, error: "Sign in to look up account names." };
  }
  if (!allow(`session:${token}`, PER_SESSION_PER_MINUTE)) {
    return { status: 429, error: "Too many lookups. Try again in a minute." };
  }
  return null;
}
