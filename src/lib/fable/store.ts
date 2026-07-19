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
      const seeded = seedState();
      window.localStorage.setItem(storageKey(), JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw) as StoreState;
  } catch {
    return seedState();
  }
}

// A referentially-stable snapshot cache so useSyncExternalStore doesn't loop
// (getSnapshot must return the same object until the data actually changes).
let snapshotCache: StoreState | null = null;

function write(next: StoreState): void {
  if (!canUseDom()) return;
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
  if (!result) result = scoreTransaction(input);

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
    customerName: getTenant().customerName ?? DEMO_USER.name,
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
  if (ghost?.remote) {
    // Deliberately not swallowed: a refusal must reach the UI so it can run
    // the factor, rather than silently marking the transfer released locally.
    await ghostResolve(ghostId, "confirm", stepupToken);
  }
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
