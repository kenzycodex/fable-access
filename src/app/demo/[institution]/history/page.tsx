"use client";

import { useState } from "react";
import { MagnifyingGlass, Faders } from "@phosphor-icons/react";
import { Avatar, Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { DEMO_USER } from "@/lib/fable/seed";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { riskTone } from "@/lib/fable/ui";

type FilterMode = "all" | "credit" | "debit";

export default function HistoryPage() {
  const store = useFableStore();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  const myTxns: Transaction[] = (store?.transactions ?? [])
    .filter((t) => t.customerName === DEMO_USER.name)
    .sort((a, b) => b.timestamp - a.timestamp);

  const filteredTxns = myTxns.filter((t) => {
    if (filter === "credit" && t.direction !== "credit") return false;
    if (filter === "debit" && t.direction !== "debit") return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!t.recipientName.toLowerCase().includes(q) && !t.narration?.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const groups = groupByDay(filteredTxns);

  return (
    <Screen>
      <ScreenHeader title="Activity" backHref="/demo" />

      <div className="mb-5 flex flex-col gap-3">
        {/* Search bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/35" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or narration"
              className="w-full rounded-xl bg-gray-50 dark:bg-[#1a1a1a] py-2.5 pl-9 pr-3 text-[13px] text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-white/25 focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
            />
          </div>
          <button type="button" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 dark:bg-[#1a1a1a] text-gray-500 dark:text-white/50 transition-colors hover:bg-gray-100 dark:hover:bg-[#222] border border-gray-200 dark:border-white/[0.04]">
            <Faders size={18} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>All</FilterTab>
          <FilterTab active={filter === "credit"} onClick={() => setFilter("credit")}>Credits</FilterTab>
          <FilterTab active={filter === "debit"} onClick={() => setFilter("debit")}>Debits</FilterTab>
        </div>
      </div>

      {store === null ? (
        <Card>
          <div className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.04]" />
        </Card>
      ) : filteredTxns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-white/20 mb-3">
            <MagnifyingGlass size={24} />
          </div>
          <p className="text-[13px] font-medium text-gray-500 dark:text-white/40">No transactions found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g, gi) => (
            <div key={g.label} className="flex flex-col gap-2 animate-fade-in-up" style={{ animationDelay: `${gi * 0.08}s` }}>
              <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/30">{g.label}</p>
              <Card className="!p-0 overflow-hidden border border-gray-200 dark:border-white/[0.04]">
                <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                  {g.items.map((t) => (
                    <HistoryRow key={t.id} txn={t} />
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
        active ? "bg-[#7C3AED] text-white" : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-600 dark:text-white/45 hover:bg-gray-200 dark:hover:bg-[#222] hover:text-gray-900 dark:hover:text-white/70"
      }`}
    >
      {children}
    </button>
  );
}

function HistoryRow({ txn }: { txn: Transaction }) {
  const credit = txn.direction === "credit";
  const tone = riskTone(txn.action);
  const flagged = txn.action !== "PASS";

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]">
      <Avatar name={txn.recipientName} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-gray-900 dark:text-white">{txn.recipientName}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500 dark:text-white/35">
          {formatRelativeTime(txn.timestamp)} · {txn.narration || txn.recipientBank}
          {flagged && (
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${tone.chip}`}>
              {txn.status}
            </span>
          )}
        </span>
      </div>
      <span className={`ml-auto text-[14px] font-bold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white/60"}`}>
        {credit ? "+" : "-"}
        {formatNaira(txn.amount)}
      </span>
    </div>
  );
}

function groupByDay(txns: Transaction[]): { label: string; items: Transaction[] }[] {
  const buckets = new Map<string, Transaction[]>();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const t of txns) {
    const age = now - t.timestamp;
    const label =
      age < dayMs && new Date(t.timestamp).getDate() === new Date(now).getDate()
        ? "Today"
        : age < 2 * dayMs
          ? "Yesterday"
          : age < 7 * dayMs
            ? "This week"
            : "Earlier";
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(t);
  }
  const order = ["Today", "Yesterday", "This week", "Earlier"];
  return order.filter((l) => buckets.has(l)).map((label) => ({ label, items: buckets.get(label)! }));
}
