"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { CaretDown, DownloadSimple, MagnifyingGlass, Prohibit, Receipt, ShieldCheck, Warning } from "@phosphor-icons/react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  OutcomeBadge,
  PageHeader,
  RiskBadge,
  Segmented,
  Skeleton,
  StatCard,
  StatGrid,
  inputClass,
  table,
} from "@/components/dashboard/primitives";
import { formatNaira, formatNairaCompact, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/constants";
import type { RiskAction, Transaction } from "@/lib/fable/types";
import { daysAgo, downloadCsv } from "@/lib/fable/console";
import { useDashboardFeed } from "@/lib/fable/useBackend";
import { useTransactionRange } from "@/lib/fable/useConsole";

type Filter = RiskAction | "ALL";
type Range = "latest" | "7" | "30" | "90";

const PAGE = 40;

/** A score as a small bar, tinted by how risky it is. */
function ScoreMeter({ score }: { score: number }) {
  const color = score >= 0.8 ? "#ef4444" : score >= 0.5 ? "#f59e0b" : "#10b981";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-d-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round(score * 100)}%`, backgroundColor: color }} />
      </div>
      <span className="font-semibold tabular-nums text-d-text">{formatRiskScore(score)}</span>
    </div>
  );
}

export default function TransactionsPage() {
  const feed = useDashboardFeed();
  const [range, setRange] = useState<Range>("latest");
  const [from] = useState(() => ({ "7": daysAgo(7), "30": daysAgo(30), "90": daysAgo(90) }));
  const ranged = useTransactionRange({ from: range === "latest" ? undefined : from[range], limit: 200 });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  // "Latest" is the live feed; a range is read from the server for that period.
  const rangedTxns = ranged.data?.transactions;
  const all = useMemo(
    () => [...(range === "latest" ? feed.transactions : (rangedTxns ?? []))].sort((a, b) => b.timestamp - a.timestamp),
    [range, feed.transactions, rangedTxns],
  );
  const ready = range === "latest" ? feed.ready : Boolean(ranged.data);
  const totalInRange = range === "latest" ? null : (ranged.data?.total ?? null);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadCsv("transactions", {
        from: range === "latest" ? daysAgo(30) : from[range],
        to: daysAgo(0),
        action: filter === "ALL" ? undefined : filter,
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const rows = useMemo(() => {
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
  }, [all, query, filter]);

  const counts = useMemo(
    () => ({
      PASS: all.filter((t) => t.action === "PASS").length,
      FLAG: all.filter((t) => t.action === "FLAG").length,
      BLOCK: all.filter((t) => t.action === "BLOCK").length,
    }),
    [all],
  );

  const visible = rows.slice(0, shown);
  const value = (a: RiskAction) => all.filter((t) => t.action === a).reduce((n, t) => n + t.amount, 0);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every transfer Fable scored. Open a row to see why."
        actions={
          <Button variant="secondary" icon={<DownloadSimple size={16} />} loading={exporting} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      {exportError && <p className="-mt-3 text-[13px] text-red-500">{exportError}</p>}

      <StatGrid>
        <StatCard label="Transactions" value={ready ? all.length.toLocaleString("en-NG") : "-"} sub={range === "latest" ? "The latest scored" : `Last ${range} days`} icon={<Receipt size={17} weight="fill" />} featured />
        <StatCard label="Passed" value={ready ? counts.PASS.toLocaleString("en-NG") : "-"} sub={ready ? `${formatNairaCompact(value("PASS"))} moved freely` : "Loading"} tone="success" icon={<ShieldCheck size={17} weight="fill" />} />
        <StatCard label="Flagged" value={ready ? counts.FLAG.toLocaleString("en-NG") : "-"} sub={ready ? `${formatNairaCompact(value("FLAG"))} asked to verify` : "Loading"} tone="warning" icon={<Warning size={17} weight="fill" />} />
        <StatCard label="Blocked" value={ready ? counts.BLOCK.toLocaleString("en-NG") : "-"} sub={ready ? `${formatNairaCompact(value("BLOCK"))} stopped` : "Loading"} tone="danger" icon={<Prohibit size={17} weight="bold" />} />
      </StatGrid>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-d-border p-4">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-[240px]">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Search customer, recipient or narration"
              aria-label="Search customer, recipient or narration"
              className={`${inputClass} !h-10 pl-10 text-[13px]`}
            />
          </div>
          <Segmented<Range>
            value={range}
            onChange={(v) => {
              setRange(v);
              setShown(PAGE);
            }}
            options={[
              { value: "latest", label: "Latest" },
              { value: "7", label: "7d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
            ]}
          />
          <Segmented<Filter>
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setShown(PAGE);
            }}
            options={[
              { value: "ALL", label: `All ${all.length}` },
              { value: "PASS", label: `Passed ${counts.PASS}` },
              { value: "FLAG", label: `Flagged ${counts.FLAG}` },
              { value: "BLOCK", label: `Blocked ${counts.BLOCK}` },
            ]}
          />
        </div>

        {!ready ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title={all.length === 0 ? "No transactions yet" : "Nothing matches"}
            body={all.length === 0 ? "Scored transfers will appear here." : "Try a different search or filter."}
          />
        ) : (
          <>
            <ul className="divide-y divide-d-border md:hidden">
              {visible.map((t) => (
                <MobileCard key={t.id} txn={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
              ))}
            </ul>
            <div className={`${table.wrap} hidden md:block`}>
              <table className={`${table.base} min-w-[860px]`}>
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Customer</th>
                    <th className={table.th}>Recipient</th>
                    <th className={table.th}>Amount</th>
                    <th className={table.th}>Channel</th>
                    <th className={table.th}>Risk score</th>
                    <th className={table.th}>Decision</th>
                    <th className={`${table.th} text-right`}>When</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <Row key={t.id} txn={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-d-border px-4 py-3 text-[12px] text-d-muted sm:px-5">
              <span>
                Showing {visible.length} of {rows.length}
                {totalInRange != null && totalInRange > all.length && ` (the latest ${all.length} of ${totalInRange.toLocaleString("en-NG")} in this period; export for all)`}
              </span>
              {visible.length < rows.length && (
                <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Show more
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function Row({ txn: t, open, onToggle }: { txn: Transaction; open: boolean; onToggle: () => void }) {
  return (
    <Fragment>
      <tr className={`${table.row} cursor-pointer ${open ? "bg-d-surface-2" : ""}`} onClick={onToggle}>
        <td className={table.td}>
          <div className="flex items-center gap-3">
            <Avatar name={t.customerName} size="sm" />
            <span className="font-semibold text-d-text">{t.customerName}</span>
            {t.live && <Badge tone="brand">Live</Badge>}
          </div>
        </td>
        <td className={table.td}>
          <p className="font-medium text-d-text">{t.recipientName}</p>
          <p className="text-[12px] text-d-muted">{t.recipientBank}</p>
        </td>
        <td className={`${table.td} whitespace-nowrap font-semibold tabular-nums`}>{formatNaira(t.amount)}</td>
        <td className={`${table.td} text-d-muted`}>{CHANNEL_LABELS[t.channel]}</td>
        <td className={table.td}>
          <ScoreMeter score={t.riskScore} />
        </td>
        <td className={table.td}>
          <div className="flex flex-wrap items-center gap-1.5">
            <RiskBadge action={t.action} />
            {t.action !== "PASS" && <OutcomeBadge status={t.status} />}
          </div>
        </td>
        <td className={`${table.td} whitespace-nowrap text-right text-d-muted`}>{formatRelativeTime(t.timestamp)}</td>
        <td className="pr-4">
          <CaretDown size={14} className={`text-d-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>

      {open && (
        <tr className="bg-d-surface-2">
          <td colSpan={8} className="px-5 pb-5 pt-1">
            <Detail txn={t} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Why Shield decided what it did, plus links to the customer and the case. */
function Detail({ txn: t }: { txn: Transaction }) {
  return (
      <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">Why Shield decided this</p>
            <p className="text-[13px] leading-relaxed text-d-muted">
              {t.explanation || (t.action === "PASS" ? "Matched this customer's normal behaviour, so it passed with no extra steps." : "No explanation was recorded.")}
            </p>
            {t.narration && (
              <p className="mt-3 text-[13px] text-d-muted">
                Narration: <span className="font-medium text-d-text">&ldquo;{t.narration}&rdquo;</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-[13px] font-semibold">
              {t.userId && (
                <Link href={`/dashboard/customers/${encodeURIComponent(t.userId)}`} className="text-brand hover:underline">
                  Customer profile
                </Link>
              )}
              {t.review && (
                <Link href={`/dashboard/review?case=${encodeURIComponent(t.id)}`} className="text-brand hover:underline">
                  Open the case
                </Link>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">Signals</p>
            {t.signals.length === 0 ? (
              <p className="text-[13px] text-d-muted">No signals fired.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {t.signals.map((s, i) => (
                  <li key={s.code + i} className="flex items-start justify-between gap-3 rounded-xl bg-d-surface px-3.5 py-2.5 text-[13px]">
                    <span>
                      <span className="font-semibold text-d-text">{s.label}</span>
                      <span className="text-d-muted"> {s.detail}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">+{s.weight}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
  );
}

/** One transfer as a phone-friendly card that expands to its detail. */
function MobileCard({ txn: t, open, onToggle }: { txn: Transaction; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-d-surface-2">
        <Avatar name={t.customerName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-d-text">{t.customerName}</span>
            {t.live && <Badge tone="brand">Live</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-d-muted">
            {formatNaira(t.amount)} to {t.recipientName}
          </span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-d-faint">
            {CHANNEL_LABELS[t.channel]} · {formatRelativeTime(t.timestamp)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <RiskBadge action={t.action} />
          <span className="text-[12px] font-bold tabular-nums text-d-text">{formatRiskScore(t.riskScore)}</span>
        </span>
        <CaretDown size={14} className={`shrink-0 text-d-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="bg-d-surface-2 px-4 pb-5 pt-3">
          <Detail txn={t} />
        </div>
      )}
    </li>
  );
}

