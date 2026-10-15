"use client";

import { CheckCircle, ShieldCheck, Warning, XCircle } from "@phosphor-icons/react";
import { Card, CardHeader, Notice, StatCard, table } from "@/components/dashboard/primitives";
import { ago } from "@/components/operator/ui";
import type { BacktestGroup, BacktestReport, DecisionAction, DecisionMatrix } from "@/lib/fable/operator";

const ACTIONS: DecisionAction[] = ["PASS", "FLAG", "BLOCK"];
const ACTION_TONE: Record<DecisionAction, string> = {
  PASS: "text-emerald-600 dark:text-emerald-400",
  FLAG: "text-amber-600 dark:text-amber-400",
  BLOCK: "text-red-600 dark:text-red-400",
};
const ACTION_LABEL: Record<DecisionAction, string> = { PASS: "Pass", FLAG: "Flag", BLOCK: "Block" };

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** "12 → 15" with the second number coloured by whether the move is good. */
function Move({ before, after, worseIfUp, digits = 0 }: { before: number; after: number; worseIfUp: boolean; digits?: number }) {
  const show = (n: number) => n.toLocaleString("en-NG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const worse = worseIfUp ? after > before : after < before;
  const better = worseIfUp ? after < before : after > before;
  return (
    <>
      {show(before)} <span className="text-d-faint">→</span>{" "}
      <span className={worse ? "text-red-600 dark:text-red-400" : better ? "text-emerald-600 dark:text-emerald-400" : ""}>
        {show(after)}
      </span>
    </>
  );
}

function Matrix({ matrix }: { matrix: DecisionMatrix }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] text-[13px]">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">
            <th className="pb-2 text-left font-semibold">Now</th>
            {ACTIONS.map((a) => <th key={a} className={`pb-2 text-right font-semibold ${ACTION_TONE[a]}`}>{ACTION_LABEL[a]}</th>)}
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map((b) => (
            <tr key={b} className="border-t border-d-border">
              <td className={`py-2.5 text-[12px] font-semibold ${ACTION_TONE[b]}`}>{ACTION_LABEL[b]}</td>
              {ACTIONS.map((a) => {
                const n = matrix[b][a];
                const moved = a !== b && n > 0;
                return (
                  <td key={a} className="py-2.5 text-right tabular-nums">
                    <span className={moved ? "rounded-md bg-brand/10 px-1.5 py-0.5 font-semibold text-brand" : a === b ? "text-d-text" : "text-d-faint"}>
                      {n.toLocaleString("en-NG")}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-d-faint">Rows: today&apos;s decision. Columns: the draft&apos;s. Highlighted cells changed.</p>
    </div>
  );
}

function GroupTable({ title, label, rows }: { title: string; label: string; rows: (BacktestGroup & { name: string })[] }) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-5"><CardHeader title={title} /></div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-d-muted">No decisions in this window.</p>
      ) : (
        <div className={table.wrap}>
          <table className="w-full min-w-[440px] text-left text-[13px]">
            <thead className={table.head}>
              <tr>
                <th className={table.th}>{label}</th>
                <th className={`${table.th} text-right`}>Decisions</th>
                <th className={`${table.th} text-right`}>Changed</th>
                <th className={`${table.th} text-right`}>Block rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={table.row}>
                  <td className={`${table.td} capitalize text-d-text`}>{r.name.replace(/_/g, " ")}</td>
                  <td className={`${table.td} text-right tabular-nums text-d-muted`}>{r.n.toLocaleString("en-NG")}</td>
                  <td className={`${table.td} text-right tabular-nums ${r.changed ? "font-semibold text-d-text" : "text-d-faint"}`}>{r.changed}</td>
                  <td className={`${table.td} whitespace-nowrap text-right tabular-nums text-d-muted`}>
                    {pct(r.block_rate_before)} → {pct(r.block_rate_after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** What a draft would have decided on real past transfers. */
export function BacktestView({ report, stale }: { report: BacktestReport; stale: boolean }) {
  const o = report.outcomes;
  const r = report.rows;
  const sample = (n: number, low: boolean) => `${n} labelled${low ? ", too few to rely on" : ""}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-d-muted">
        Last {report.days} days, run {ago(report.run_at)}. {r.replayed.toLocaleString("en-NG")} decisions replayed:{" "}
        {r.exact.toLocaleString("en-NG")} exact, {r.approximate.toLocaleString("en-NG")} approximate
        {r.skipped ? `, ${r.skipped} skipped` : ""}.{r.truncated && " The window was cut to the newest rows."}
      </p>
      {stale && <Notice tone="warning">This backtest is out of date. Run it again before proposing.</Notice>}
      {report.warnings.length > 0 ? (
        <Notice tone="warning">
          <p className="mb-1 flex items-center gap-1.5 font-semibold"><Warning size={14} weight="fill" /> Impact warnings. The approver must confirm they reviewed these.</p>
          <ul className="list-disc pl-5">{report.warnings.map((w) => <li key={w.message}>{w.message}</li>)}</ul>
        </Notice>
      ) : (
        <Notice tone="success">No impact warnings: block rates and confirmed-fraud misses stay within limits.</Notice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Decisions that change" value={report.overall.changed.toLocaleString("en-NG")}
          sub={`of ${r.replayed.toLocaleString("en-NG")} replayed`} icon={<ShieldCheck size={17} weight="fill" />} featured />
        <StatCard label="Confirmed fraud caught" value={`${o.fraud.caught_before ?? 0} → ${o.fraud.caught_after ?? 0}`}
          sub={sample(o.fraud.n, o.fraud.low_sample)} tone="success" icon={<CheckCircle size={17} weight="fill" />} />
        <StatCard label="Confirmed fraud missed" value={`${o.fraud.missed_before ?? 0} → ${o.fraud.missed_after ?? 0}`}
          sub={sample(o.fraud.n, o.fraud.low_sample)} tone="danger" icon={<XCircle size={17} weight="fill" />} />
        <StatCard label="Genuine, blocked" value={`${o.legitimate.blocked_before ?? 0} → ${o.legitimate.blocked_after ?? 0}`}
          sub={sample(o.legitimate.n, o.legitimate.low_sample)} tone="warning" icon={<Warning size={17} weight="fill" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Decisions before and after" subtitle="How each past decision would land under the draft" />
          <Matrix matrix={report.matrix} />
        </Card>
        <Card>
          <CardHeader title="Against known outcomes" subtitle="Analyst labels, kept apart from weaker signals" />
          <dl className="flex flex-col divide-y divide-d-border text-[13px]">
            {[
              ["Recall (fraud caught)", <Move key="r" before={o.metrics_before.recall * 100} after={o.metrics_after.recall * 100} worseIfUp={false} digits={1} />, "%"],
              ["Precision", <Move key="p" before={o.metrics_before.precision * 100} after={o.metrics_after.precision * 100} worseIfUp={false} digits={1} />, "%"],
              ["False-positive rate", <Move key="f" before={o.metrics_before.false_positive_rate * 100} after={o.metrics_after.false_positive_rate * 100} worseIfUp digits={1} />, "%"],
              ["Ghost holds cancelled, caught", <Move key="g" before={o.ghost_cancelled.caught_before ?? 0} after={o.ghost_cancelled.caught_after ?? 0} worseIfUp={false} />, ""],
            ].map(([label, value, unit]) => (
              <div key={String(label)} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-d-muted">{label}</dt>
                <dd className="font-semibold tabular-nums text-d-text">{value}{unit}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-d-faint">
            {o.metrics_after.n} analyst-labelled transfers{o.metrics_after.low_sample ? `, below ${report.min_sample}: treat as indicative` : ""}.{" "}
            {o.no_outcome_blocked.toLocaleString("en-NG")} blocked transfers had no outcome and never count as caught fraud.
            Customer cancellations are a weaker signal: people cancel for other reasons too.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <GroupTable title="By channel" label="Channel" rows={report.by_channel.map((g) => ({ ...g, name: g.channel }))} />
        <GroupTable title="By bank" label="Bank" rows={report.by_bank.map((g) => ({ ...g, name: g.institution_id }))} />
      </div>

      <p className="text-[11px] text-d-faint">
        {report.policy_note}
        {report.env_keys.length > 0 && ` From the server environment: ${report.env_keys.map((k) => k.env).join(", ")}.`}
      </p>
    </div>
  );
}
