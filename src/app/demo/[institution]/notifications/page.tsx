"use client";

import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Ghost, ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { customerTransactions } from "@/lib/fable/api";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";

/**
 * Notifications, derived from the customer's real activity.
 *
 * This page previously rendered two hardcoded cards. One of them announced
 * that "Fable blocked a suspicious login attempt from an unknown device in
 * Lagos" — an event that had not happened, describing a capability the system
 * does not have. Showing a customer a fabricated security alert is worse than
 * showing them nothing, so every item here now comes from a real decision.
 *
 * There is no notifications table and no push delivery; this is a derived view
 * over the transaction feed, which is the honest shape until real delivery
 * exists.
 */

type Kind = "blocked" | "flagged" | "contained" | "credit" | "cleared";

interface Notice {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  at: number;
  txnId?: string;
}

const STYLES: Record<Kind, { icon: React.ReactNode; wrap: string; badge: string }> = {
  blocked: {
    icon: <ShieldWarning size={20} weight="fill" />,
    wrap: "bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20",
    badge: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
  },
  flagged: {
    icon: <ShieldWarning size={20} weight="fill" />,
    wrap: "bg-amber-50 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20",
    badge: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
  },
  contained: {
    icon: <Ghost size={20} weight="fill" />,
    wrap: "bg-purple-50 border-purple-100 dark:bg-[var(--brand-primary)]/10 dark:border-[var(--brand-primary)]/20",
    badge: "bg-purple-100 text-purple-600 dark:bg-[var(--brand-primary)]/20 dark:text-[var(--brand-primary)]",
  },
  credit: {
    icon: <ArrowDown size={20} />,
    wrap: "",
    badge: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  cleared: {
    icon: <ShieldCheck size={20} weight="fill" />,
    wrap: "",
    badge: "bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-white/50",
  },
};

/** One transfer becomes at most one notice. Routine cleared transfers are
 *  deliberately excluded: a notification for every successful payment is noise,
 *  and noise is what trains people to ignore the alert that matters. */
function toNotice(t: Transaction): Notice | null {
  const when = formatNaira(t.amount);
  const who = t.recipientName || "a new recipient";

  if (t.direction === "credit") {
    return {
      id: t.id,
      kind: "credit",
      title: "Money in",
      body: `${when} was added to your account.`,
      at: t.timestamp,
    };
  }
  if (t.status === "held") {
    return {
      id: t.id,
      kind: "contained",
      title: "Transfer held for review",
      body: `${when} to ${who} is in a cooling window. You can cancel it and keep the money, or confirm it's you.`,
      at: t.timestamp,
      txnId: t.id,
    };
  }
  if (t.action === "BLOCK") {
    return {
      id: t.id,
      kind: "blocked",
      title: "Transfer blocked",
      body: `${when} to ${who} was stopped. ${t.explanation || "Your money is safe and has not left your account."}`,
      at: t.timestamp,
      txnId: t.id,
    };
  }
  if (t.action === "FLAG") {
    return {
      id: t.id,
      kind: "flagged",
      title: "Transfer needed a check",
      body: `${when} to ${who} looked unusual, so we asked you to confirm it first.`,
      at: t.timestamp,
      txnId: t.id,
    };
  }
  return null;
}

export default function NotificationsPage() {
  const store = useFableStore();
  const router = useRouter();
  const { customer, institutionId, href } = useInstitution();

  const { data: serverTxns } = useSWR(
    customer ? ["demo:notifications", customer.user_id, institutionId] : null,
    () => customerTransactions(customer!.user_id, institutionId, 100),
    { refreshInterval: 10_000, keepPreviousData: true },
  );

  // Session transfers appear immediately rather than waiting for the next poll,
  // scoped to the selected customer so one customer's activity never shows up
  // under another's.
  const local = (store?.transactions ?? []).filter((t) => t.live && t.userId === customer?.user_id);
  const all: Transaction[] = [
    ...local,
    ...(serverTxns ?? []).filter((t) => !local.some((l) => l.id === t.id)),
  ];

  const notices = all
    .map(toNotice)
    .filter((n): n is Notice => n !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, 30);

  return (
    <Screen>
      <ScreenHeader title="Notifications" />

      {notices.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <ShieldCheck size={24} weight="fill" />
          </span>
          <span className="text-[14px] font-semibold text-gray-900 dark:text-white">Nothing needs your attention</span>
          <span className="max-w-[260px] text-[13px] leading-relaxed text-gray-500 dark:text-white/45">
            You&rsquo;ll see a message here if Fable ever holds or questions a transfer.
          </span>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {notices.map((n) => {
            const s = STYLES[n.kind];
            const clickable = Boolean(n.txnId);
            const Wrapper = s.wrap ? "div" : Card;
            return (
              <Wrapper
                key={n.id}
                onClick={clickable ? () => router.push(href(`/tx/${n.txnId}`)) : undefined}
                className={`flex items-start gap-4 rounded-2xl p-4 ${s.wrap ? `border ${s.wrap}` : ""} ${
                  clickable ? "cursor-pointer transition-opacity hover:opacity-80" : ""
                }`}
              >
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${s.badge}`}>
                  {s.icon}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold text-gray-900 dark:text-white">{n.title}</span>
                  <span className="text-[13px] leading-relaxed text-gray-600 dark:text-white/60">{n.body}</span>
                  <span className="mt-1 text-[11px] font-medium text-gray-400 dark:text-white/30">
                    {formatRelativeTime(n.at)}
                  </span>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
