"use client";

// Shared polling policy for every live console read.
//
// The console previously polled on a flat 4-second interval that ran whether
// or not anyone was looking at the tab, retried instantly and forever when the
// API was struggling, and had no jitter — so every open tab hit the same
// endpoint at the same moment. On a single small instance that turns a slow
// backend into a slower one.
//
// This policy is deliberately conservative about *when* to ask and generous
// about *how long* to wait, because the deployed API answers dashboard reads
// in several seconds.

import type { SWRConfiguration } from "swr";

/** Base cadence, in ms, for how fresh each surface needs to be. */
export const CADENCE = {
  /** The live activity stream — the one surface people watch update. */
  live: 6_000,
  /** Rollups that change slowly. */
  standard: 15_000,
  /** Reference data that rarely moves at all. */
  slow: 60_000,
} as const;

/**
 * Spread requests so multiple tabs (and multiple hooks) don't align into
 * bursts against one instance. Without jitter every poller fires on the same
 * tick, which is exactly the shape that overloads a small server.
 */
function withJitter(ms: number): number {
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

/**
 * The polling policy every live read shares.
 *
 * - Stops entirely when the tab is hidden. A backgrounded console does not
 *   need fresh numbers, and this is the single biggest reduction in load.
 * - Backs off exponentially on errors instead of hammering a struggling API,
 *   capped so it always recovers on its own.
 * - Keeps the previous response while revalidating, so a slow or failed
 *   refresh never blanks the screen or swaps in different figures.
 */
export function livePolling(baseMs: number = CADENCE.standard): SWRConfiguration {
  return {
    refreshInterval: () => (document.visibilityState === "hidden" ? 0 : withJitter(baseMs)),
    refreshWhenHidden: false,
    refreshWhenOffline: false,

    // Revalidate on focus, but not more than once every few seconds — tab
    // switching used to fire a request every time.
    revalidateOnFocus: true,
    focusThrottleInterval: 10_000,
    revalidateOnReconnect: true,

    // Collapse duplicate requests for the same key across components.
    dedupingInterval: 3_000,

    // Exponential backoff, capped. A failing API gets progressively more
    // room rather than a request every few seconds indefinitely.
    shouldRetryOnError: true,
    errorRetryInterval: 5_000,
    errorRetryCount: 6,
    onErrorRetry: (_err, _key, config, revalidate, { retryCount }) => {
      if (retryCount > (config.errorRetryCount ?? 6)) return;
      const delay = Math.min(5_000 * 2 ** (retryCount - 1), 60_000);
      setTimeout(() => revalidate({ retryCount }), withJitter(delay));
    },

    // The point of the whole policy: never replace good data with nothing.
    keepPreviousData: true,
  };
}
