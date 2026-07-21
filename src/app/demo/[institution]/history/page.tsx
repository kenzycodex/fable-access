"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { MagnifyingGlass, Faders } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { Avatar, Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { customerTransactions } from "@/lib/fable/api";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { riskTone } from "@/lib/fable/ui";

type FilterMode = "all" | "credit" | "debit";
type Period = "all" | "week" | "month";
type SortMode = "newest" | "oldest" | "largest";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function HistoryPage() {
  const store = useFableStore();
  const { customer, institutionId, href } = useInstitution();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  // Advanced filters, behind the Faders button.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [riskOnly, setRiskOnly] = useState(false);

  // This customer's real history, keyed on user_id rather than name. Two
  // institutions can have similarly-named customers; only the id is unique.
  const { data: serverTxns } = useSWR(
    customer ? ["demo:history", customer.user_id, institutionId] : null,
    () => customerTransactions(customer!.user_id, institutionId, 200),
    { refreshInterval: 8_000, keepPreviousData: true },
  );

  // Transfers made this session appear immediately, ahead of the next poll.
  const localLive = (store?.transactions ?? []).filter((t) => t.live);
  const myTxns: Transaction[] = [
    ...localLive,
    ...(serverTxns ?? []).filter((t) => !localLive.some((l) => l.id === t.id)),
  ];

  const filteredTxns = myTxns
    .filter((t) => {
      if (filter === "credit" && t.direction !== "credit") return false;
      if (filter === "debit" && t.direction !== "debit") return false;
      if (riskOnly && t.action === "PASS") return false;
      if (period !== "all") {
        const cutoff = Date.now() - (period === "week" ? 7 : 30) * DAY_MS;
        if (t.timestamp < cutoff) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.recipientName.toLowerCase().includes(q) && !t.narration?.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "largest") return b.amount - a.amount;
      if (sort === "oldest") return a.timestamp - b.timestamp;
      return b.timestamp - a.timestamp;
    });

  // Day grouping only reads correctly in date order.
  const groups = groupByDay(sort === "largest" ? [...filteredTxns].sort((a, b) => b.timestamp - a.timestamp) : filteredTxns);
  const activeCount = (period !== "all" ? 1 : 0) + (sort !== "newest" ? 1 : 0) + (riskOnly ? 1 : 0);

  function resetFilters() {
    setPeriod("all");
    setSort("newest");
    setRiskOnly(false);
  }

  return (
    <Screen>
      <ScreenHeader title="Activity" />

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
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={activeCount ? `Filters (${activeCount} active)` : "Filters"}
            className={`relative flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
              activeCount
                ? "border-[#7C3AED]/30 bg-[#7C3AED]/10 text-[#7C3AED]"
                : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-white/[0.04] dark:bg-[#1a1a1a] dark:text-white/50 dark:hover:bg-[#222]"
            }`}
          >
            <Faders size={18} />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-bold text-white">
                {activeCount}
              </span>
            )}
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
                    <HistoryRow key={t.id} txn={t} onOpen={() => router.push(href(`/tx/${t.id}`))} />
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <DemoSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        subtitle={`${filteredTxns.length} of ${myTxns.length} transactions`}
      >
        <div className="flex flex-col gap-5">
          <FilterGroup label="Period">
            <FilterChip active={period === "all"} onClick={() => setPeriod("all")}>All time</FilterChip>
            <FilterChip active={period === "week"} onClick={() => setPeriod("week")}>Last 7 days</FilterChip>
            <FilterChip active={period === "month"} onClick={() => setPeriod("month")}>Last 30 days</FilterChip>
          </FilterGroup>

          <FilterGroup label="Sort by">
            <FilterChip active={sort === "newest"} onClick={() => setSort("newest")}>Newest</FilterChip>
            <FilterChip active={sort === "oldest"} onClick={() => setSort("oldest")}>Oldest</FilterChip>
            <FilterChip active={sort === "largest"} onClick={() => setSort("largest")}>Largest</FilterChip>
          </FilterGroup>

          <FilterGroup label="Risk">
            <FilterChip active={!riskOnly} onClick={() => setRiskOnly(false)}>All transfers</FilterChip>
            <FilterChip active={riskOnly} onClick={() => setRiskOnly(true)}>Flagged &amp; blocked</FilterChip>
          </FilterGroup>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={resetFilters}
              disabled={activeCount === 0}
              className="rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-white/[0.08] dark:text-white/50 dark:hover:bg-white/[0.04]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="flex-1 rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Show {filteredTxns.length} result{filteredTxns.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </DemoSheet>
    </Screen>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3.5 py-2 text-[12px] font-semibold transition-colors ${
        active
          ? "border-[#7C3AED] bg-[#7C3AED] text-white"
          : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-white/[0.06] dark:bg-[#141414] dark:text-white/50 dark:hover:bg-[#1c1c1c]"
      }`}
    >
      {children}
    </button>
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

function HistoryRow({ txn, onOpen }: { txn: Transaction; onOpen: () => void }) {
  const credit = txn.direction === "credit";
  const tone = riskTone(txn.action);
  const flagged = txn.action !== "PASS";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]"
    >
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
    </button>
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
