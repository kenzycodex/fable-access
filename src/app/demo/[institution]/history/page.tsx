"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { CaretDown, MagnifyingGlass, Receipt } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import { Avatar, ButtonLink, Card, EmptyState, Screen, Segmented, Skeleton, inputClass } from "@/components/demo/kit";
import { customerTransactions } from "@/lib/fable/api";
import { formatDateTime, formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { statusTone } from "@/lib/fable/ui";

type Direction = "all" | "credit" | "debit";
type Period = "all" | "week" | "month";
type SortMode = "newest" | "oldest" | "largest";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function HistoryPage() {
  const store = useFableStore();
  const { customer, institutionId, href } = useInstitution();
  const router = useRouter();

  const [direction, setDirection] = useState<Direction>("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [riskOnly, setRiskOnly] = useState(false);
  // One reference time per visit, so the period filter is stable between renders.
  const [now] = useState(() => Date.now());

  // This customer's real history, keyed on user_id rather than name. Two
  // institutions can have similarly named customers; only the id is unique.
  const { data: serverTxns } = useSWR(
    customer ? ["demo:history", customer.user_id, institutionId] : null,
    () => customerTransactions(customer!.user_id, institutionId, 200),
    { refreshInterval: 8_000, keepPreviousData: true },
  );

  // Transfers made this session appear immediately, ahead of the next poll.
  // Scoped to the selected customer: the store is shared per institution, so an
  // unscoped filter leaked one customer's transfers into another's feed.
  const localLive = (store?.transactions ?? []).filter((t) => t.live && t.userId === customer?.user_id);
  const all: Transaction[] = [
    ...localLive,
    ...(serverTxns ?? []).filter((t) => !localLive.some((l) => l.id === t.id)),
  ];

  const rows = all
    .filter((t) => {
      if (direction !== "all" && t.direction !== direction) return false;
      if (riskOnly && t.action === "PASS") return false;
      if (period !== "all") {
        const cutoff = now - (period === "week" ? 7 : 30) * DAY_MS;
        if (t.timestamp < cutoff) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.recipientName.toLowerCase().includes(q) && !t.narration?.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "largest") return b.amount - a.amount;
      if (sort === "oldest") return a.timestamp - b.timestamp;
      return b.timestamp - a.timestamp;
    });

  const loading = store === null || (!serverTxns && !!customer);
  const filtered = direction !== "all" || riskOnly || period !== "all" || search.trim() !== "";

  return (
    <Screen>
      <PageHeader title="Activity" subtitle="Everything that has moved in or out of your account" back />

      <Card padded={false}>
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-d-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative lg:w-[320px]">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or narration"
              aria-label="Search by name or narration"
              className={`${inputClass} !h-10 pl-10 text-[13px]`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[
                { value: "all", label: "All" },
                { value: "credit", label: "Money in" },
                { value: "debit", label: "Money out" },
              ]}
            />
            <Select value={period} onChange={(v) => setPeriod(v as Period)} label="Period">
              <option value="all">All time</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </Select>
            <Select value={sort} onChange={(v) => setSort(v as SortMode)} label="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="largest">Largest</option>
            </Select>
            <button
              type="button"
              onClick={() => setRiskOnly((r) => !r)}
              aria-pressed={riskOnly}
              className={`h-10 rounded-xl px-3.5 text-[12px] font-semibold transition-colors ${
                riskOnly ? "bg-amber-500/16 text-amber-700 dark:text-amber-300" : "bg-d-surface-2 text-d-muted hover:text-d-text"
              }`}
            >
              Flagged &amp; blocked
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-4 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title={filtered ? "Nothing matches those filters" : "No activity yet"}
            body={filtered ? "Try a different search or clear a filter." : "Transfers you send and receive will appear here."}
            action={
              !filtered ? (
                <ButtonLink href={href("/transfer")} size="sm">
                  Send money
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop: a table, which is what a statement is. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">
                    <th className="px-5 py-3 font-semibold">Recipient</th>
                    <th className="px-3 py-3 font-semibold">Narration</th>
                    <th className="px-3 py-3 font-semibold">Date &amp; time</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const credit = t.direction === "credit";
                    const tone = statusTone(t.status);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => router.push(href(`/tx/${t.id}`))}
                        className="cursor-pointer border-t border-d-border transition-colors hover:bg-d-surface-2"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={t.recipientName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-d-text">{t.recipientName}</p>
                              <p className="truncate text-[12px] text-d-muted">{t.recipientBank}</p>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-3 text-d-muted">{t.narration || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-d-muted">{formatDateTime(t.timestamp)}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.chip}`}>
                            {tone.label}
                          </span>
                        </td>
                        <td
                          className={`whitespace-nowrap px-5 py-3 text-right font-bold tabular-nums ${
                            credit ? "text-emerald-600 dark:text-emerald-400" : "text-d-text"
                          }`}
                        >
                          {credit ? "+" : "-"}
                          {formatNaira(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone: stacked rows. */}
            <ul className="divide-y divide-d-border md:hidden">
              {rows.map((t) => {
                const credit = t.direction === "credit";
                const flagged = t.action !== "PASS";
                const tone = statusTone(t.status);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => router.push(href(`/tx/${t.id}`))}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-d-surface-2"
                    >
                      <Avatar name={t.recipientName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-d-text">{t.recipientName}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-d-muted">
                          {formatRelativeTime(t.timestamp)}
                          {flagged && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${tone.chip}`}>
                              {tone.label}
                            </span>
                          )}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 whitespace-nowrap text-[14px] font-bold tabular-nums ${
                          credit ? "text-emerald-600 dark:text-emerald-400" : "text-d-text"
                        }`}
                      >
                        {credit ? "+" : "-"}
                        {formatNaira(t.amount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-d-border px-5 py-3 text-[12px] text-d-muted">
              Showing {rows.length} of {all.length} transactions
            </p>
          </>
        )}
      </Card>
    </Screen>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-10 appearance-none rounded-xl bg-d-surface-2 pl-3.5 pr-9 text-[12px] font-semibold text-d-text outline-none focus:ring-4 focus:ring-brand/10"
      >
        {children}
      </select>
      <CaretDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-d-faint" />
    </div>
  );
}
