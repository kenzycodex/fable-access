"use client";

// Client-side store, backed by localStorage. This is the connective tissue of
// the whole demo: the demo bank (/demo) WRITES transfers here, and the
// institution dashboard (/dashboard) READS the same feed. A transfer made in
// the demo shows up in the dashboard's Transaction Explorer, live, even across
// two browser tabs (via the storage event).
//
// Every decision comes from the Fable API. The mutating actions below call it
// (Shield scoring, Ghost holds, step-up) and mirror the result here so the UI
// stays reactive. When the API cannot be reached, nothing is decided in the
// browser: the transfer is not sent and the customer is asked to try again.
// There used to be a browser copy of Shield that scored transfers while the
// API was down and showed the result as a Fable decision; it was not one, and
// it is gone.

import { useSyncExternalStore } from "react";
import {
  approveTransfer,
  FableUnavailableError,
  finalizeTransaction,
  ghostCreate as apiGhostCreate,
  ghostResolve,
  shieldAnalyze,
  InsufficientFundsError,
  type SdkTelemetry,
} from "./api";
import { getTenant, subscribeTenant } from "./tenant";
import type {
  GhostContainer,
  SessionState,
  Transaction,
  TransactionInput,
  TransactionStatus,
  TransparencyState,
} from "./types";

const STORAGE_PREFIX = "fable_demo_v2";
const CHANGE_EVENT = "fable:change";

// The console session is not tenant-scoped demo state — it is who is signed
// into the dashboard. Keeping it inside the per-institution bucket meant
// switching tenant (or introducing the bucketing at all) silently signed the
// operator out, because their session lived under the previous key.
const SESSION_KEY = "fable_console_session";

function readSession(): SessionState {
  if (!canUseDom()) return { loggedIn: false, institutionId: null, token: null, expiresAt: null };
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as SessionState;
    // One-time migration from the pre-split bucket, so an operator who was
    // already signed in stays signed in.
    const legacy = window.localStorage.getItem(`${STORAGE_PREFIX}`);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<StoreState>;
      if (parsed?.session?.loggedIn) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(parsed.session));
        return parsed.session;
      }
    }
  } catch {
    // fall through to signed out
  }
  return { loggedIn: false, institutionId: null, token: null, expiresAt: null };
}

function writeSession(session: SessionState): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage unavailable; session stays in memory for this tab
  }
}

/** One bucket per institution.
 *
 * A single shared key meant a transfer made at one bank appeared in another's
 * demo app, and — because the feed keys on customer name — collided outright
 * when two tenants had a customer with the same name. Tenants are supposed to
 * be isolated; the local mirror has to honour that too.
 *
 * The dashboard reads before any institution is known; those calls share an
 * "unscoped" bucket that no institution's data is ever written to.
 */
function storageKey(): string {
  const tenant = getTenant().institutionId || "unscoped";
  return `${STORAGE_PREFIX}:${tenant}`;
}

interface StoreState {
  transactions: Transaction[];
  ghosts: GhostContainer[];
  transparency: TransparencyState;
  session: SessionState;
  /** The transfer currently being decided (scored, awaiting the user). */
  pending: Transaction | null;
}

const DEFAULT_TRANSPARENCY: TransparencyState = {
  typicalRange: true,
  activeHours: true,
  trustedRecipients: true,
  knownDevices: true,
  channel: true,
  velocityLimit: 15,
  containmentWindow: 12,
  biometricStrictness: 80,
  geofenceRadius: 50,
};

function seedState(): StoreState {
  return {
    // Empty, deliberately. This used to seed a hardcoded institution feed,
    // which meant any surface reading the store before the API answered
    // rendered fabricated transactions as though they were the bank's real
    // ones. Everything shown now comes from the API or from transfers the
    // operator actually made.
    transactions: [],
    ghosts: [],
    transparency: DEFAULT_TRANSPARENCY,
    session: { loggedIn: false, institutionId: null, token: null, expiresAt: null },
    pending: null,
  };
}

const canUseDom = () => typeof window !== "undefined";

function read(): StoreState {
  if (!canUseDom()) return seedState();
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) {
      const seeded = { ...seedState(), session: readSession() };
      window.localStorage.setItem(storageKey(), JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as StoreState;
    return { ...parsed, session: readSession() };
  } catch {
    return seedState();
  }
}

// A referentially-stable snapshot cache so useSyncExternalStore doesn't loop
// (getSnapshot must return the same object until the data actually changes).
let snapshotCache: StoreState | null = null;

function write(next: StoreState): void {
  if (!canUseDom()) return;
  writeSession(next.session);
  window.localStorage.setItem(storageKey(), JSON.stringify(next));
  snapshotCache = next;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function mutate(fn: (state: StoreState) => StoreState): StoreState {
  const next = fn(read());
  write(next);
  return next;
}

/** Browser data from the old offline engine: a queue of transfers to replay
 * and cached baselines it scored against. Replaying a queued transfer now would
 * book a decision the customer was never shown, so both are simply dropped. */
function dropOfflineLeftovers(): void {
  try {
    window.localStorage.removeItem("fable_sync_queue");
    window.localStorage.removeItem("fable_baseline_cache");
  } catch {
    // storage unavailable: nothing to clean
  }
}

function subscribe(cb: () => void): () => void {
  if (!canUseDom()) return () => {};
  dropOfflineLeftovers();
  const onChange = () => {
    snapshotCache = read();
    cb();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey()) {
      snapshotCache = read();
      cb();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  // Switching institution points at a different bucket, so the cached
  // snapshot has to be dropped or the previous tenant's feed lingers.
  const unsubscribeTenant = subscribeTenant(() => {
    snapshotCache = read();
    cb();
  });
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    unsubscribeTenant();
  };
}

/** Stable snapshot for useSyncExternalStore (client). */
function getSnapshot(): StoreState {
  if (snapshotCache === null) snapshotCache = read();
  return snapshotCache;
}

/** Server render (and the first hydration paint) sees no store yet, matching
 * the client's pre-mount state and avoiding hydration mismatches. */
function getServerSnapshot(): StoreState | null {
  return null;
}

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

/** Score a transfer with Fable and stash the decision as pending. `sdk`
 * carries the collected device, location, session and behavioural context.
 *
 * `clientReference` makes the call idempotent: the transfer page passes the
 * same reference for every retry of one transfer, so a double tap or a retry
 * after a dropped response returns the decision already made instead of a
 * second one.
 *
 * Throws InsufficientFundsError when the account cannot cover it, and
 * FableUnavailableError when Fable cannot be reached; in both cases nothing is
 * sent and nothing is decided in the browser. */
export async function submitTransfer(
  input: TransactionInput,
  sdk?: Partial<SdkTelemetry>,
  clientReference?: string,
): Promise<Transaction> {
  let result;
  try {
    result = await shieldAnalyze(input, sdk, clientReference ? { clientReference } : undefined);
  } catch (err) {
    if (err instanceof InsufficientFundsError) throw err;
    throw new FableUnavailableError();
  }
  const id = result.transactionId;
  const remote = true;

  const txn: Transaction = {
    ...result,
    id,
    timestamp: Date.now(),
    amount: input.amount,
    direction: "debit",
    channel: input.channel,
    narration: input.narration,
    status: result.action === "PASS" ? "completed" : "held",
    recipientName: input.recipient.name,
    recipientBank: input.recipient.bank,
    recipientAccount: input.recipient.accountNumber || input.recipient.last4 || "",
    recipientToken: input.recipient.token,
    customerName: getTenant().customerName ?? "Unknown customer",
    userId: getTenant().customerId ?? "",
    live: true,
    remote,
  };
  mutate((s) => ({ ...s, pending: txn }));
  return txn;
}

/** Replace the pending decision's explanation with the fuller write-up that
 * arrived after the verdict. Only the prose changes: the score, action and
 * signals are the decision itself and are never rewritten after the fact. */
export function upgradePendingExplanation(transactionId: string, explanation: string) {
  mutate((s) =>
    s.pending && s.pending.transactionId === transactionId
      ? { ...s, pending: { ...s.pending, explanation } }
      : s,
  );
}

export function getPending(): Transaction | null {
  return read().pending;
}

/** Commit the pending transfer with a final status and add it to the feed. */
export function resolvePending(status: TransactionStatus): Transaction | null {
  const state = read();
  const txn = state.pending;
  if (!txn) return null;
  const finalized: Transaction = { ...txn, status };
  mutate((s) => ({
    ...s,
    transactions: [finalized, ...s.transactions],
    pending: null,
  }));
  // Persist the final status to the DB so the dashboard reflects it (the
  // transfer was already stored as "held"/"completed" at score time).
  if (finalized.remote) void finalizeTransaction(finalized.id, status).catch(() => {});
  return finalized;
}

/** A PASS transfer is committed straight away (no decision needed). */
export function commitPass(): Transaction | null {
  return resolvePending("completed");
}

/** Record an incoming credit (e.g. an Add-money top-up) in the feed.
 *
 * The balance is already server-authoritative, but income/spend on the home
 * screen are derived from the transaction feed — so a top-up that only moved
 * the balance showed ₦0 income. This puts the credit where those stats read
 * from, as a cleared inbound transfer. */
export function recordCredit(amount: number, source: string): Transaction {
  const tenant = getTenant();
  const txn: Transaction = {
    id: uid("credit"),
    timestamp: Date.now(),
    amount,
    direction: "credit",
    channel: "app",
    narration: source,
    status: "completed",
    recipientName: source,
    recipientBank: "Fable",
    recipientAccount: "",
    customerName: tenant.customerName ?? "You",
    userId: tenant.customerId ?? "",
    riskScore: 0,
    action: "PASS",
    signals: [],
    explanation: "",
    latencyMs: 0,
    live: true,
    remote: false,
  };
  mutate((s) => ({ ...s, transactions: [txn, ...s.transactions] }));
  return txn;
}

/** Proceed with a flagged (not blocked) pending transfer after the customer
 * verifies it's them. A flag is medium risk, so a verified transfer completes
 * directly with no cooling window — the proportional, lower-friction path.
 *
 * Throws StepUpRequiredError (from the server) when no valid proof is supplied,
 * so the caller runs the factor and retries with a token. The money only moves
 * on success. */
export async function approvePending(stepupToken?: string | null): Promise<Transaction | null> {
  const txn = read().pending;
  if (!txn) return null;
  const userId = getTenant().customerId ?? "";

  // Deliberately not swallowed: a step-up refusal must reach the UI so it can
  // run the factor rather than silently marking the transfer sent.
  await approveTransfer(txn.id, userId, stepupToken);
  return resolvePending("completed");
}

/** Hold the pending (blocked) transfer for a cooling window. The hold lives on
 * the server, opened from Fable's stored decision; its length comes from that
 * decision. If the server cannot be reached the error reaches the screen and
 * nothing is held: there is no browser-only hold any more, because one could
 * never actually hold money. */
export async function createGhost(): Promise<GhostContainer | null> {
  const txn = read().pending;
  if (!txn) return null;
  const api = await apiGhostCreate(txn);
  const ghost: GhostContainer = {
    id: api.id,
    transactionId: txn.id,
    amount: txn.amount,
    recipientName: txn.recipientName,
    recipientBank: txn.recipientBank,
    expiresAt: api.expiresAt,
    windowSeconds: api.windowSeconds,
    status: "held",
    remote: true,
  };
  mutate((s) => ({ ...s, ghosts: [ghost, ...s.ghosts.filter((g) => g.id !== ghost.id)] }));
  return ghost;
}

export function getActiveGhost(): GhostContainer | null {
  return read().ghosts.find((g) => g.status === "held") ?? null;
}

/** Cancel a hold. The money stays with the customer. Waits for the server so
 * the screen never says "cancelled" for a hold the server still has. */
export async function cancelGhost(ghostId: string): Promise<void> {
  await ghostResolve(ghostId, "cancel");
  mutate((s) => ({
    ...s,
    ghosts: s.ghosts.map((g) => (g.id === ghostId ? { ...g, status: "cancelled" } : g)),
  }));
  resolvePending("cancelled");
}

/** Mark a hold the server says has ended on its own (expired). */
export function markGhostEnded(ghostId: string, status: "expired" | "cancelled" | "released"): void {
  mutate((s) => ({
    ...s,
    ghosts: s.ghosts.map((g) => (g.id === ghostId ? { ...g, status } : g)),
  }));
  if (read().pending) resolvePending(status === "released" ? "released" : "cancelled");
}

/** Release money out of containment. Requires proof of a completed step-up
 * factor when the container is remote — the server refuses otherwise, and the
 * caller is expected to run the factor and retry with a token. */
export async function confirmGhost(ghostId: string, stepupToken?: string | null): Promise<void> {
  // Deliberately not swallowed: a refusal must reach the UI so it can run
  // the factor, rather than silently marking the transfer released locally.
  await ghostResolve(ghostId, "confirm", stepupToken);

  mutate((s) => ({
    ...s,
    ghosts: s.ghosts.map((g) => (g.id === ghostId ? { ...g, status: "released" } : g)),
  }));
  resolvePending("released");
}

export function setTransparency(patch: Partial<TransparencyState>): void {
  mutate((s) => ({ ...s, transparency: { ...s.transparency, ...patch } }));
}

/** Sign the console in, holding the signed token /auth/login issued.
 *
 * The cookie used to be the literal string "1", and Next's middleware checked
 * only that it existed — so `document.cookie = "fable_auth=1"` in any console
 * granted access. It now holds the real token, which the middleware can
 * actually inspect, and which every API call presents so the server derives
 * the tenant from a verified identity.
 *
 * It is not httpOnly, deliberately: the console and the API are on different
 * origins, so this is read by JS to set an Authorization header rather than
 * being sent as ambient authority. That is also why there is no CSRF surface
 * here — a cross-site request cannot attach a header it cannot read.
 */
export function login(institutionId?: string | null, token?: string | null, expiresAt?: number | null): void {
  if (canUseDom() && token) {
    const maxAge = expiresAt ? Math.max(expiresAt - Math.floor(Date.now() / 1000), 0) : 43200;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `fable_auth=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  }
  mutate((s) => ({
    ...s,
    session: {
      loggedIn: true,
      institutionId: institutionId ?? null,
      token: token ?? null,
      expiresAt: expiresAt ?? null,
    },
  }));
}

export function logout(): void {
  if (canUseDom()) document.cookie = "fable_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  mutate((s) => ({
    ...s,
    session: { loggedIn: false, institutionId: null, token: null, expiresAt: null },
  }));

  // Hard navigation, not router.replace().
  //
  // Signing out used to clear the session and leave the console layout to
  // notice and client-side navigate. Next keeps an RSC payload for the authed
  // /dashboard tree in its router cache, so that navigation could stall behind
  // a request for a route the layout was simultaneously trying to leave — and
  // the user sat on "Starting console..." until they hard-refreshed.
  //
  // A full document load is also the honest semantics for logout: it drops
  // every cached RSC payload and all in-memory state, rather than trusting a
  // client-side transition to have cleared everything that mattered.
  if (canUseDom()) window.location.replace("/dashboard/login");
}

/** The live session token, or null when there is none or it has expired. */
export function sessionToken(): string | null {
  const s = read().session;
  if (!s.token) return null;
  if (s.expiresAt && s.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return s.token;
}

/** Wipe all demo state back to the seed (used by the dashboard settings). */
export function resetDemo(): void {
  write(seedState());
}

/** Drop the cached snapshot so the next read hits the active tenant's bucket. */
export function invalidateStoreCache(): void {
  snapshotCache = null;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Subscribe a client component to the store. Returns `null` on the server and
 * during the first client render (so SSR and hydration match), then the live
 * state after mount. Callers render a light loading state while it's null.
 */
export function useFableStore(): StoreState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
