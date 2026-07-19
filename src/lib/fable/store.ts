"use client";

// Client-side store, backed by localStorage. This is the connective tissue of
// the whole demo: the demo bank (/demo) WRITES transfers here, and the
// institution dashboard (/dashboard) READS the same feed. A transfer made in
// the demo shows up in the dashboard's Transaction Explorer, live, even across
// two browser tabs (via the storage event).
//
// When the Fable API (api/ at the repo root) is running, the mutating actions
// below call it first — real Shield scoring, Ghost containers, and SQLite
// persistence — and mirror the result here so the UI stays reactive. When the
// API is unreachable, the pure client-side engine (scoring.ts) takes over, so
// the demo never breaks.

import { useSyncExternalStore } from "react";
import {
  apiAvailable,
  ensureBackendSeeded,
  finalizeTransaction,
  ghostCreate as apiGhostCreate,
  ghostResolve,
  shieldAnalyze,
  type SdkTelemetry,
} from "./api";
import { scoreTransaction } from "./scoring";
import { enqueue, startAutoSync } from "./syncQueue";
import { DEFAULT_INSTITUTION } from "./constants";
import { getTenant, subscribeTenant } from "./tenant";
import {
  DEMO_USER,
  INSTITUTION,
  SEED_INSTITUTION_FEED,
} from "./seed";
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
  if (!canUseDom()) return { loggedIn: false, institutionId: null };
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
  return { loggedIn: false, institutionId: null };
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
 * The dashboard reads before any institution is known, so an unscoped call
 * falls back to the default tenant's bucket rather than a nameless one.
 */
function storageKey(): string {
  const tenant = getTenant().institutionId || DEFAULT_INSTITUTION;
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
    transactions: SEED_INSTITUTION_FEED,
    ghosts: [],
    transparency: DEFAULT_TRANSPARENCY,
    session: { loggedIn: false, institutionId: null },
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

function subscribe(cb: () => void): () => void {
  if (!canUseDom()) return () => {};
  // First subscriber on an app surface: make sure the backend has Ada's
  // 90-day baseline (no-op when the API is down or already seeded).
  void ensureBackendSeeded();
  // Replay anything captured while the API was unreachable.
  const stopAutoSync = startAutoSync();
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
    stopAutoSync();
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

/** Score a transfer and stash it as the pending decision. Uses the Fable API
 * (real Shield scoring + persistence) when reachable, the client-side engine
 * otherwise. `sdk` carries the real collected device/location/session/
 * behavioral context. Returns the scored transaction so the caller can navigate. */
export async function submitTransfer(input: TransactionInput, sdk?: Partial<SdkTelemetry>): Promise<Transaction> {
  let id = uid("txn");
  let remote = false;
  let result = null as ReturnType<typeof scoreTransaction> | null;

  if (await apiAvailable()) {
    try {
      const api = await shieldAnalyze(input, sdk);
      id = api.transactionId;
      remote = true;
      result = api;
    } catch {
      result = null; // fall through to the local engine
    }
  }

  if (!result) {
    // Offline. The local engine keeps the bank usable, but the decision would
    // otherwise never leave the browser: the institution's console wouldn't
    // see the transfer and Copilot wouldn't learn from it. Queue it so the
    // server receives it once the API is reachable again.
    result = scoreTransaction(input);
    const tenant = getTenant();
    enqueue({
      reference: id,
      institutionId: tenant.institutionId,
      userId: tenant.customerId ?? `${tenant.institutionId}_ada`,
      input,
      sdk: sdk ?? null,
    });
  }

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
    recipientAccount: input.recipient.accountNumber,
    customerName: getTenant().customerName ?? "Unknown customer",
    live: true,
    remote,
  };
  mutate((s) => ({ ...s, pending: txn }));
  return txn;
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

/** Route the pending transfer into a Ghost cooling window. Creates the real
 * container in the Fable API when reachable (its risk-based cooling window
 * wins), otherwise a local 15-minute one. */
export async function createGhost(windowSeconds = 15 * 60): Promise<GhostContainer | null> {
  const txn = read().pending;
  if (!txn) return null;

  let ghost: GhostContainer | null = null;
  if (txn.remote && (await apiAvailable())) {
    try {
      const api = await apiGhostCreate(txn);
      ghost = {
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
    } catch {
      ghost = null; // fall through to the local container
    }
  }
  if (!ghost) {
    ghost = {
      id: uid("ghost"),
      transactionId: txn.id,
      amount: txn.amount,
      recipientName: txn.recipientName,
      recipientBank: txn.recipientBank,
      expiresAt: Date.now() + windowSeconds * 1000,
      windowSeconds,
      status: "held",
    };
  }
  mutate((s) => ({ ...s, ghosts: [ghost!, ...s.ghosts] }));
  return ghost;
}

export function getActiveGhost(): GhostContainer | null {
  return read().ghosts.find((g) => g.status === "held") ?? null;
}

export function cancelGhost(ghostId: string): void {
  const ghost = read().ghosts.find((g) => g.id === ghostId);
  if (ghost?.remote) void ghostResolve(ghostId, "cancel").catch(() => {});
  mutate((s) => ({
    ...s,
    ghosts: s.ghosts.map((g) => (g.id === ghostId ? { ...g, status: "cancelled" } : g)),
  }));
  resolvePending("cancelled");
}

/** Release money out of containment. Requires proof of a completed step-up
 * factor when the container is remote — the server refuses otherwise, and the
 * caller is expected to run the factor and retry with a token. */
export async function confirmGhost(ghostId: string, stepupToken?: string | null): Promise<void> {
  const ghost = read().ghosts.find((g) => g.id === ghostId);

  // Releasing always goes through the server, including for a container that
  // was created locally while the API was down. Skipping the call for local
  // containers meant the step-up gate never ran and release was free — the
  // containment guarantee disappeared exactly when the connection was worst,
  // which is not a state a scammer has to work hard to produce.
  //
  // If identity cannot be verified, the money does not move. Cancelling stays
  // available and still returns it immediately.
  if (!ghost?.remote && !(await apiAvailable())) {
    throw new Error(
      "Releasing needs a connection so we can verify it's you. Your money stays held, and you can cancel to get it back now.",
    );
  }

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

/** Sign the console in as a specific institution. The id comes from
 * /auth/login and scopes every dashboard query; it falls back to the seeded
 * demo tenant so the offline/local path still works. */
export function login(institutionId?: string | null): void {
  if (canUseDom()) document.cookie = "fable_auth=1; path=/; max-age=86400";
  mutate((s) => ({
    ...s,
    session: { loggedIn: true, institutionId: institutionId ?? INSTITUTION.id },
  }));
}

export function logout(): void {
  if (canUseDom()) document.cookie = "fable_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  mutate((s) => ({ ...s, session: { loggedIn: false, institutionId: null } }));
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
