"use client";

// Dashboard data source. Uses SWR to poll the Next.js /api/transactions route
// (Prisma + SQLite) so live transfers made in /demo appear in the console
// within a couple of seconds, then derives every dashboard metric from the
// shared analytics helpers. Falls back to the local client store when the API
// is unreachable, so the dashboard always renders something.

import useSWR from "swr";
import { summarize, type FeedSummary } from "./analytics";
import {
  apiAvailable,
  copilotBaseline,
  dashboardAlerts,
  dashboardCompliance,
  dashboardIntelligence,
  dashboardTransactions,
  type CopilotBaseline,
  type DashboardAlerts,
  type DashboardCompliance,
  type DashboardIntelligence,
} from "./api";
import { useFableStore } from "./store";
import type { Transaction } from "./types";

export interface DashboardFeed {
  ready: boolean;
  source: "api" | "local";
  stats: FeedSummary;
  transactions: Transaction[];
}

const fetcher = () => dashboardTransactions(300);

export function useDashboardFeed(pollMs = 4_000): DashboardFeed {
  const store = useFableStore();
  const { data, error } = useSWR<Transaction[]>("fable:dashboard-transactions", fetcher, {
    refreshInterval: pollMs,
    revalidateOnFocus: true,
    keepPreviousData: true,
    shouldRetryOnError: true,
  });

  // Backend is serving.
  if (data && !error) {
    const liveIds = new Set((store?.transactions ?? []).filter((t) => t.live).map((t) => t.id));
    const transactions = data
      .map((t) => (liveIds.has(t.id) ? { ...t, live: true } : t))
      .sort((a, b) => b.timestamp - a.timestamp);
    return { ready: true, source: "api", transactions, stats: summarize(transactions) };
  }

  // Fallback to the local store (API down or first paint).
  const txns = [...(store?.transactions ?? [])].sort((a, b) => b.timestamp - a.timestamp);
  return {
    ready: store !== null || Boolean(data),
    source: "local",
    transactions: txns,
    stats: summarize(txns),
  };
}

/** Intelligence rollups (scam patterns, channel risk, signal frequency). */
export function useIntelligence(pollMs = 8_000) {
  return useSWR<DashboardIntelligence>("fable:intelligence", () => dashboardIntelligence(), {
    refreshInterval: pollMs,
    keepPreviousData: true,
  });
}

/** Watch Alerts feed (flagged/blocked transfers). */
export function useAlerts(pollMs = 5_000) {
  return useSWR<DashboardAlerts>("fable:alerts", () => dashboardAlerts(60), {
    refreshInterval: pollMs,
    keepPreviousData: true,
  });
}

/** Compliance rollups (audit, CSAT proxy, incident log, frameworks). */
export function useCompliance(pollMs = 10_000) {
  return useSWR<DashboardCompliance>("fable:compliance", () => dashboardCompliance(), {
    refreshInterval: pollMs,
    keepPreviousData: true,
  });
}

/** Copilot's learned baseline for the demo user (what Fable actually knows). */
export function useCopilotBaseline() {
  return useSWR<CopilotBaseline>("fable:copilot-baseline", () => copilotBaseline(), {
    keepPreviousData: true,
  });
}

/** Backend-status chip datum. Probes the FastAPI /health endpoint. */
export function useApiStatus(): "api" | "local" | "checking" {
  const { data, isLoading } = useSWR<boolean>("fable:api-health", () => apiAvailable(), {
    refreshInterval: 10_000,
  });
  if (isLoading && data === undefined) return "checking";
  return data ? "api" : "local";
}
