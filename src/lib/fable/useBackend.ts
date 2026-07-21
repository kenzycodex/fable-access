"use client";

// Dashboard data source. Uses SWR to poll the Next.js /api/transactions route
// (Prisma + SQLite) so live transfers made in /demo appear in the console
// within a couple of seconds, then derives every dashboard metric from the
// shared analytics helpers. Falls back to the local client store when the API
// is unreachable, so the dashboard always renders something.

import useSWR from "swr";
import { CADENCE, livePolling } from "./polling";
import { summarize, type FeedSummary } from "./analytics";
import {
  agentsCopilotCustomers,
  agentsGhostContainers,
  agentsOverview,
  agentsShieldDecisions,
  apiAvailable,
  copilotBaseline,
  dashboardAlerts,
  dashboardCompliance,
  dashboardIntelligence,
  dashboardStats,
  dashboardTransactions,
  type AgentsOverview,
  type CopilotBaseline,
  type CopilotCustomer,
  type DashboardAlerts,
  type DashboardCompliance,
  type DashboardIntelligence,
  type DashboardStats,
  type GhostContainers,
  type ShieldDecisions,
} from "./api";
import { useFableStore } from "./store";
import type { Transaction } from "./types";

export interface DashboardFeed {
  ready: boolean;
  source: "api" | "local";
  stats: FeedSummary;
  transactions: Transaction[];
}

/** The institution the console is signed in as. Every read is scoped to it so
 * one tenant can never see another's transactions. */
function useTenant(): string | null {
  const store = useFableStore();
  return store?.session.institutionId ?? null;
}

export function useDashboardFeed(pollMs = CADENCE.live): DashboardFeed {
  const store = useFableStore();
  const institution = store?.session.institutionId ?? null;
  const { data, isLoading } = useSWR<Transaction[]>(
    ["fable:dashboard-transactions", institution],
    () => dashboardTransactions(300, institution),
    livePolling(pollMs),
  );

  // Any successful response is used, even when the newest poll failed.
  //
  // This previously required `!error`, which meant a single transient failure
  // during the 4-second poll threw away perfectly good data and swapped the
  // console to the local seed feed. The figures visibly jumped — 200 scored
  // and 27 blocked one second, 22 and 3 the next — and both were presented as
  // the institution's real numbers. Keeping the last good response is the
  // entire reason keepPreviousData is on.
  if (data) {
    const liveIds = new Set((store?.transactions ?? []).filter((t) => t.live).map((t) => t.id));
    const transactions = data
      .map((t) => (liveIds.has(t.id) ? { ...t, live: true } : t))
      .sort((a, b) => b.timestamp - a.timestamp);
    return { ready: true, source: "api", transactions, stats: summarize(transactions) };
  }

  // No successful response yet. Only the operator's own live transfers are
  // shown here — the seeded demo feed is deliberately excluded, because
  // rendering fabricated transactions as an institution's fraud metrics is
  // worse than rendering nothing.
  const liveOnly = (store?.transactions ?? [])
    .filter((t) => t.live)
    .sort((a, b) => b.timestamp - a.timestamp);

  // `ready` stays false while the first request is still in flight. It used to
  // be true as soon as the store hydrated, so every reload painted the local
  // fallback — the operator's own one or two live transfers — under the same
  // KPI labels the API numbers use, and the cards read "1 transaction scored,
  // 1 threat blocked" for a frame before snapping to 200/28. Two different
  // answers to "how much fraud did we stop today", a few hundred milliseconds
  // apart, both stated as fact. The fallback is for a *failed* fetch, not a
  // pending one.
  return {
    ready: !isLoading,
    source: "local",
    transactions: liveOnly,
    stats: summarize(liveOnly),
  };
}

/** Headline stats. The only place measured decision latency comes from. */
export function useDashboardStats(pollMs = CADENCE.standard) {
  const institution = useTenant();
  return useSWR<DashboardStats>(["fable:stats", institution], () => dashboardStats(institution), livePolling(pollMs));
}

/** Intelligence rollups (scam patterns, channel risk, signal frequency). */
export function useIntelligence(pollMs = CADENCE.standard) {
  const institution = useTenant();
  return useSWR<DashboardIntelligence>(["fable:intelligence", institution], () => dashboardIntelligence(institution), livePolling(pollMs));
}

/** Watch Alerts feed (flagged/blocked transfers). */
export function useAlerts(pollMs = CADENCE.live) {
  const institution = useTenant();
  return useSWR<DashboardAlerts>(["fable:alerts", institution], () => dashboardAlerts(60, institution), livePolling(pollMs));
}

/** Compliance rollups (audit, CSAT proxy, incident log, frameworks). */
export function useCompliance(pollMs = CADENCE.slow) {
  const institution = useTenant();
  return useSWR<DashboardCompliance>(["fable:compliance", institution], () => dashboardCompliance(institution), livePolling(pollMs));
}

/** Copilot's learned baseline — what Fable actually knows about a customer.
 * Keyed on the user so switching customers shows that customer's real baseline
 * rather than a single hardcoded demo user. */
export function useCopilotBaseline(userId?: string | null) {
  return useSWR<CopilotBaseline>(
    ["fable:copilot-baseline", userId ?? null],
    () => copilotBaseline(userId ?? undefined),
    { keepPreviousData: true },
  );
}

/** Agents overview: live stats for Copilot, Shield, Ghost, Watch. */
export function useAgentsOverview(pollMs = CADENCE.standard) {
  const institution = useTenant();
  return useSWR<AgentsOverview>(["fable:agents-overview", institution], () => agentsOverview(institution), livePolling(pollMs));
}

/** Copilot deep-dive: per-customer learned baselines. */
export function useCopilotCustomers(pollMs = CADENCE.slow) {
  const institution = useTenant();
  return useSWR<{ customers: CopilotCustomer[]; total: number }>(
    ["fable:agents-copilot", institution],
    () => agentsCopilotCustomers(institution),
    livePolling(pollMs),
  );
}

/** Shield deep-dive: pipeline config + recent decisions with full signals. */
export function useShieldDecisions(pollMs = CADENCE.live) {
  const institution = useTenant();
  return useSWR<ShieldDecisions>(["fable:agents-shield", institution], () => agentsShieldDecisions(40, institution), livePolling(pollMs));
}

/** Ghost deep-dive: containers, resolution stats, cooling windows. */
export function useGhostContainers(pollMs = CADENCE.live) {
  const institution = useTenant();
  return useSWR<GhostContainers>(["fable:agents-ghost", institution], () => agentsGhostContainers(60, institution), livePolling(pollMs));
}

/** Backend-status chip datum. Probes the FastAPI /health endpoint. */
export function useApiStatus(): "api" | "local" | "checking" {
  const { data, isLoading } = useSWR<boolean>(
    "fable:api-health",
    () => apiAvailable(),
    livePolling(CADENCE.standard),
  );
  if (isLoading && data === undefined) return "checking";
  return data ? "api" : "local";
}
