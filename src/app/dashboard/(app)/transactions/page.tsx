"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "@/components/app-icons";
import { Card, PageHeader, RiskBadge } from "@/components/dashboard/primitives";
import { formatNaira, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import { useDashboardFeed } from "@/lib/fable/useBackend";
import type { RiskAction } from "@/lib/fable/types";

const FILTERS: { key: RiskAction | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PASS", label: "Passed" },
  { key: "FLAG", label: "Flagged" },
  { key: "BLOCK", label: "Blocked" },
];

export default function TransactionsPage() {
  const feed = useDashboardFeed();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RiskAction | "ALL">("ALL");

  const rows = useMemo(() => {
    const all = [...feed.transactions].sort((a, b) => b.timestamp - a.timestamp);
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (filter !== "ALL" && t.action !== filter) return false;
      if (!q) return true;
      return (
        t.customerName.toLowerCase().includes(q) ||
        t.recipientName.toLowerCase().includes(q) ||
        t.narration.toLowerCase().includes(q)
      );
    });
  }, [feed.transactions, query, filter]);

  return (
    <>
      <PageHeader
        title="Transaction Explorer"
        description="Every transfer scored by Fable, across all your customers. Live transfers from the demo bank land here in real time."
      />

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white dark:border-white/[0.04] dark:bg-black px-4 py-2.5 sm:w-80 shadow-sm focus-within:border-[#7C3AED]/50 focus-within:ring-1 focus-within:ring-[#7C3AED]/50 transition-all">
          <SearchIcon className="size-4 text-gray-400 dark:text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, recipient, narration"
            className="w-full bg-transparent text-[13px] text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-white/30"
          />
        </div>
        <div className="flex gap-1.5 p-1 bg-white dark:bg-black border border-gray-200 dark:border-white/[0.04] rounded-xl shadow-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                filter === f.key ? "bg-[#7C3AED] text-white shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/[0.04]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/[0.04] text-left text-[11px] uppercase tracking-wider text-gray-500 dark:text-white/40 bg-gray-50 dark:bg-white/[0.01]">
                <th className="px-5 py-4 font-semibold">Customer</th>
                <th className="px-5 py-4 font-semibold">Recipient</th>
                <th className="px-5 py-4 font-semibold">Amount</th>
                <th className="px-5 py-4 font-semibold">Channel</th>
                <th className="px-5 py-4 font-semibold">Score</th>
                <th className="px-5 py-4 font-semibold text-right">Decision</th>
                <th className="px-5 py-4 font-semibold text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {!feed.ready ? (
                <SkeletonTable />
              ) : (
                rows.map((t) => {
                  const colors = ["bg-emerald-500/10 text-emerald-500", "bg-blue-500/10 text-blue-500", "bg-purple-500/10 text-purple-500", "bg-rose-500/10 text-rose-500", "bg-amber-500/10 text-amber-500"];
                  const initial = t.customerName.charAt(0).toUpperCase();
                  const colorClass = colors[initial.charCodeAt(0) % colors.length];

                  return (
                    <tr key={t.id} className={`border-b border-gray-100 dark:border-white/[0.02] last:border-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${t.live ? "bg-[#7C3AED]/[0.02]" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-bold border border-gray-200/50 dark:border-white/[0.02] ${colorClass}`}>
                            {initial}
                          </div>
                          <span className="flex flex-col">
                            <span className="font-bold text-[13px] text-gray-900 dark:text-white flex items-center gap-2">
                              {t.customerName}
                              {t.live && (
                                <span className="rounded-md bg-[#7C3AED]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#7C3AED]">
                                  Live
                                </span>
                              )}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[13px] font-medium text-gray-700 dark:text-white/80 block">{t.recipientName}</span>
                        <span className="text-[11px] text-gray-500 dark:text-white/40 block mt-0.5">{t.recipientBank}</span>
                      </td>
                      <td className="px-5 py-3 font-bold tabular-nums text-[13px] text-gray-900 dark:text-white">{formatNaira(t.amount)}</td>
                      <td className="px-5 py-3 text-[12px] font-medium text-gray-500 dark:text-white/60">{CHANNEL_LABELS[t.channel]}</td>
                      <td className="px-5 py-3 font-bold tabular-nums text-[13px] text-gray-700 dark:text-white/80">{formatRiskScore(t.riskScore)}</td>
                      <td className="px-5 py-3 text-right"><RiskBadge action={t.action} /></td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-[12px] font-medium text-gray-500 dark:text-white/40">{formatRelativeTime(t.timestamp)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04] md:hidden">
          {feed.ready &&
            rows.map((t) => (
              <div key={t.id} className={`flex flex-col gap-2 p-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${t.live ? "bg-[#7C3AED]/[0.02]" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[14px] text-gray-900 dark:text-white">{t.customerName}</span>
                  <RiskBadge action={t.action} />
                </div>
                <div className="flex items-center justify-between text-[13px] text-gray-600 dark:text-white/60 font-medium">
                  <span>→ {t.recipientName}</span>
                  <span className="font-bold tabular-nums text-gray-900 dark:text-white">{formatNaira(t.amount)}</span>
                </div>
                <span className="text-[11px] text-gray-500 dark:text-white/40 font-medium">
                  {CHANNEL_LABELS[t.channel]} · score {formatRiskScore(t.riskScore)} · {formatRelativeTime(t.timestamp)}
                </span>
              </div>
            ))}
        </div>

        {feed.ready && rows.length === 0 && (
          <div className="py-16 text-center flex flex-col items-center justify-center">
            <div className="size-12 rounded-full bg-gray-50 dark:bg-white/[0.02] flex items-center justify-center mb-3">
              <SearchIcon className="size-5 text-gray-400 dark:text-white/20" />
            </div>
            <p className="text-[14px] font-medium text-gray-600 dark:text-white/60">No transactions found</p>
            <p className="text-[12px] text-gray-400 dark:text-white/40 mt-1">Try adjusting your search or filters.</p>
          </div>
        )}
      </Card>
    </>
  );
}

function SkeletonTable() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <tr key={i} className="border-b border-gray-100 dark:border-white/[0.02]">
          {[0, 1, 2, 3, 4, 5, 6].map((j) => (
            <td key={j} className="px-5 py-4">
              <div className={`h-3.5 w-full ${j === 0 ? "max-w-32" : "max-w-24"} animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
