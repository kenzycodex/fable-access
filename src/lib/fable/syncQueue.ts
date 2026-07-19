"use client";

// Offline transfer queue.
//
// A transfer made while the Fable API is unreachable is still scored — the
// local engine takes over so the bank keeps working — but until now that
// decision existed only in the browser. It never reached the server, so the
// institution's console never saw it and Copilot never learned from it. A
// customer could transact all afternoon on a flaky connection and the bank's
// fraud team would have no record of any of it.
//
// Queued transfers are replayed when the API comes back. Each carries a stable
// client reference so a retry is recognised rather than booked twice.

import { apiAvailable, shieldAnalyze, type SdkTelemetry } from "./api";
import type { TransactionInput } from "./types";

const QUEUE_KEY = "fable_sync_queue";
const MAX_QUEUE = 50;
const MAX_ATTEMPTS = 5;

export interface QueuedTransfer {
  /** Stable across retries — this is what makes replay idempotent. */
  reference: string;
  institutionId: string;
  userId: string;
  input: TransactionInput;
  sdk: Partial<SdkTelemetry> | null;
  queuedAt: number;
  attempts: number;
}

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();

function emit() {
  const n = readQueue().length;
  listeners.forEach((l) => l(n));
}

export function subscribeQueue(cb: Listener): () => void {
  listeners.add(cb);
  cb(readQueue().length);
  return () => listeners.delete(cb);
}

function readQueue(): QueuedTransfer[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedTransfer[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedTransfer[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable: the transfer still completed locally, so
    // losing the queue entry degrades sync rather than breaking the transfer.
  }
  emit();
}

export function pendingCount(): number {
  return readQueue().length;
}

/** Hold a transfer that couldn't reach the server. */
export function enqueue(item: Omit<QueuedTransfer, "queuedAt" | "attempts">): void {
  const queue = readQueue();
  if (queue.some((q) => q.reference === item.reference)) return;

  // Oldest first out when full: a very old offline transfer is the least
  // useful to replay, and an unbounded queue would eventually break storage.
  const next = [...queue, { ...item, queuedAt: Date.now(), attempts: 0 }].slice(-MAX_QUEUE);
  writeQueue(next);
}

let flushing = false;

/**
 * Replay everything queued. Safe to call often — it no-ops while the API is
 * down or a flush is already running.
 */
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing || typeof window === "undefined") {
    return { synced: 0, remaining: pendingCount() };
  }
  const queue = readQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };
  if (!(await apiAvailable())) return { synced: 0, remaining: queue.length };

  flushing = true;
  let synced = 0;
  const remaining: QueuedTransfer[] = [];

  try {
    for (const item of queue) {
      try {
        await shieldAnalyze(item.input, item.sdk ?? undefined, {
          clientReference: item.reference,
          userId: item.userId,
          institutionId: item.institutionId,
        });
        synced++;
      } catch {
        const attempts = item.attempts + 1;
        // Give up eventually rather than retrying a poisoned entry forever.
        if (attempts < MAX_ATTEMPTS) remaining.push({ ...item, attempts });
      }
    }
    writeQueue(remaining);
  } finally {
    flushing = false;
  }

  return { synced, remaining: remaining.length };
}

/** Flush on reconnect, on tab focus, and periodically while anything waits. */
export function startAutoSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const attempt = () => void flushQueue();
  window.addEventListener("online", attempt);
  window.addEventListener("focus", attempt);
  // The browser's online event is unreliable — it fires for any network
  // interface, not for whether this API is reachable — so poll as well.
  const timer = setInterval(() => {
    if (pendingCount() > 0) attempt();
  }, 20_000);

  attempt();
  return () => {
    window.removeEventListener("online", attempt);
    window.removeEventListener("focus", attempt);
    clearInterval(timer);
  };
}
