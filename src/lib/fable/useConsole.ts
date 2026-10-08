"use client";

// SWR hooks for the console's workspace data: who is signed in, the review
// queue, the team, risk policy and webhooks. Every key carries the institution,
// so signing in as another bank never shows the previous bank's cached data.

import useSWR from "swr";
import { dashboardTransactionPage } from "./api";
import {
  caseDetail,
  me,
  reviewCounts,
  reviewQueue,
  riskPolicy,
  teamMembers,
  webhookDeliveries,
  webhookEndpoints,
  type QueueQuery,
  type Role,
} from "./console";
import { CADENCE, livePolling } from "./polling";
import { useFableStore } from "./store";

function useTenant(): string | null {
  const store = useFableStore();
  return store?.session.institutionId ?? null;
}

/** The signed-in member, with their role as the server sees it right now. */
export function useMe() {
  const inst = useTenant();
  return useSWR(inst ? ["console:me", inst] : null, () => me(), {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  });
}

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, service: 1, owner: 2 };

/** What the signed-in member may do. The server enforces the same rules; this
 * only decides which controls to offer, so nobody clicks a button to be told no. */
export function usePermissions() {
  const { data } = useMe();
  const role: Role = data?.role ?? "viewer";
  return {
    role,
    loaded: Boolean(data),
    canReview: RANK[role] >= RANK.analyst,
    canManage: role === "owner",
  };
}

export function useReviewCounts() {
  const inst = useTenant();
  return useSWR(inst ? ["console:review-counts", inst] : null, () => reviewCounts(), livePolling(CADENCE.live));
}

export function useReviewQueue(q: QueueQuery) {
  const inst = useTenant();
  return useSWR(
    inst ? ["console:review-queue", inst, q.state, q.action, q.assignee, q.limit, q.offset] : null,
    () => reviewQueue(q),
    livePolling(CADENCE.live),
  );
}

export function useCase(id: string | null) {
  const inst = useTenant();
  return useSWR(inst && id ? ["console:case", inst, id] : null, () => caseDetail(id as string), {
    ...livePolling(CADENCE.standard),
  });
}

export function useTeam() {
  const inst = useTenant();
  return useSWR(inst ? ["console:team", inst] : null, () => teamMembers(), livePolling(CADENCE.slow));
}

export function useRiskPolicy() {
  const inst = useTenant();
  return useSWR(inst ? ["console:policy", inst] : null, () => riskPolicy(inst as string), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useWebhooks() {
  const inst = useTenant();
  return useSWR(inst ? ["console:webhooks", inst] : null, () => webhookEndpoints(), livePolling(CADENCE.slow));
}

export function useWebhookDeliveries(id: string | null) {
  const inst = useTenant();
  return useSWR(inst && id ? ["console:deliveries", inst, id] : null, () => webhookDeliveries(id as string), {
    ...livePolling(CADENCE.standard),
  });
}

/** One page of the institution's transactions, optionally for a date range or
 * one customer. Separate from the live feed, which is always the latest 200. */
export function useTransactionRange(filters: { from?: string; to?: string; user?: string; limit?: number }) {
  const inst = useTenant();
  return useSWR(
    inst ? ["console:txn-range", inst, filters.from, filters.to, filters.user, filters.limit] : null,
    () => dashboardTransactionPage(filters.limit ?? 200, inst, filters),
    livePolling(CADENCE.standard),
  );
}
