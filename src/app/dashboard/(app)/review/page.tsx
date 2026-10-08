"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CheckCircle, Flag, Prohibit, ShieldCheck, Tray, UserCircle, Warning } from "@phosphor-icons/react";
import { CaseDetail, STATE_LABEL, STATE_TONE } from "@/components/dashboard/CaseDetail";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Skeleton,
  StatCard,
} from "@/components/dashboard/primitives";
import type { QueueView } from "@/lib/fable/console";
import { formatNaira, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import type { Transaction } from "@/lib/fable/types";
import { useMe, useReviewCounts, useReviewQueue } from "@/lib/fable/useConsole";

type Tab = "active" | "mine" | "escalated" | "resolved";
type ActionFilter = "ALL" | "BLOCK" | "FLAG";

export default function ReviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ReviewQueue />
    </Suspense>
  );
}

function ReviewQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("case");

  const [tab, setTab] = useState<Tab>("active");
  const [action, setAction] = useState<ActionFilter>("ALL");

  const { data: counts } = useReviewCounts();
  const { data: who } = useMe();
  const state: QueueView = tab === "mine" ? "active" : tab;
  const { data, isLoading, error } = useReviewQueue({
    state,
    action: action === "ALL" ? undefined : action,
    assignee: tab === "mine" ? "me" : undefined,
    limit: 100,
  });
  const cases = data?.cases ?? [];

  function open(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("case", id);
    else next.delete("case");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader title="Review queue" description="Flagged and blocked transfers waiting for a decision." />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Open" value={counts ? String(counts.open) : "-"} sub="Nobody has picked these up" icon={<Tray size={17} weight="fill" />} />
        <StatCard label="In review" value={counts ? String(counts.in_review) : "-"} sub="Assigned to someone" icon={<UserCircle size={17} weight="fill" />} tone="warning" />
        <StatCard label="Escalated" value={counts ? String(counts.escalated) : "-"} sub="Need a senior decision" icon={<Flag size={17} weight="fill" />} tone="danger" />
        <StatCard
          label="Resolved"
          value={counts ? String(counts.resolved) : "-"}
          sub={counts ? `${counts.confirmed_fraud} fraud, ${counts.confirmed_legitimate} legitimate` : "Loading"}
          icon={<CheckCircle size={17} weight="fill" />}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
        <Card padded={false} className={`xl:col-span-3 ${selected ? "hidden xl:block" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-d-border px-4 py-3">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "active", label: `Needs action${counts ? ` ${counts.active}` : ""}` },
                { value: "mine", label: "Mine" },
                { value: "escalated", label: "Escalated" },
                { value: "resolved", label: "Resolved" },
              ]}
            />
            <Segmented<ActionFilter>
              value={action}
              onChange={setAction}
              options={[
                { value: "ALL", label: "All" },
                { value: "BLOCK", label: "Blocked" },
                { value: "FLAG", label: "Flagged" },
              ]}
            />
          </div>

          {error ? (
            <EmptyState icon={<Warning size={22} />} title="Could not load the queue" body={error.message} />
          ) : isLoading && !data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : cases.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={22} />}
              title={tab === "resolved" ? "Nothing resolved yet" : "All clear"}
              body={tab === "mine" ? "No cases are assigned to you." : "Nothing in this view needs a decision."}
            />
          ) : (
            <ul className="divide-y divide-d-border">
              {cases.map((t) => (
                <CaseRow key={t.id} txn={t} active={selected === t.id} me={who?.email} onOpen={() => open(t.id)} />
              ))}
            </ul>
          )}
          {data && data.total > cases.length && (
            <p className="border-t border-d-border px-5 py-3 text-[12px] text-d-muted">
              Showing the {cases.length} most urgent of {data.total}.
            </p>
          )}
        </Card>

        <div className={`xl:col-span-2 xl:sticky xl:top-24 ${selected ? "" : "hidden xl:block"}`}>
          <Card padded={false} className="xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
            {selected ? (
              <CaseDetail key={selected} id={selected} onClose={() => open(null)} />
            ) : (
              <EmptyState icon={<Tray size={22} />} title="Pick a case" body="Its signals, the customer's history and the actions appear here." />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function CaseRow({ txn: t, active, me, onOpen }: { txn: Transaction; active: boolean; me?: string; onOpen: () => void }) {
  const isBlock = t.action === "BLOCK";
  const state = t.review?.state ?? "open";
  const assignee = t.review?.assignee;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors ${
          active ? "bg-brand/[0.07]" : "hover:bg-d-surface-2"
        }`}
      >
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
            isBlock ? "bg-red-500/12 text-red-600 dark:text-red-400" : "bg-amber-500/14 text-amber-600 dark:text-amber-400"
          }`}
        >
          {isBlock ? <Prohibit size={19} weight="bold" /> : <Warning size={19} weight="fill" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-d-text">{t.customerName}</span>
            <span className="shrink-0 text-[12px] text-d-faint">to</span>
            <span className="truncate text-[14px] text-d-text">{t.recipientName}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-d-muted">
            <span className="font-semibold tabular-nums text-d-text">{formatNaira(t.amount)}</span>
            <span>·</span>
            <span>{formatRelativeTime(t.timestamp)}</span>
            {assignee && (
              <>
                <span>·</span>
                <span className="truncate">{assignee === me ? "You" : assignee}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[14px] font-bold tabular-nums text-d-text">{formatRiskScore(t.riskScore)}</span>
          <Badge tone={state === "resolved" && t.review?.outcome === "fraud" ? "danger" : STATE_TONE[state]}>
            {state === "resolved" && t.review?.outcome
              ? t.review.outcome === "fraud"
                ? "Fraud"
                : "Legitimate"
              : STATE_LABEL[state]}
          </Badge>
        </span>
      </button>
    </li>
  );
}
