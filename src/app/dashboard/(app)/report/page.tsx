"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Printer } from "@phosphor-icons/react";
import { Button, Card, Field, Notice, Segmented, Skeleton, TextInput } from "@/components/dashboard/primitives";
import { daysAgo, type BoardReport } from "@/lib/fable/console";
import { LATENCY_BUDGET_MS } from "@/lib/fable/constants";
import { formatNaira } from "@/lib/fable/format";
import { useBoardReport } from "@/lib/fable/useConsole";

type Range = "7" | "30" | "90" | "custom";

/**
 * A one-page summary of a period for the board or a regulator.
 *
 * Every figure is aggregated on the server over the whole range. "Download PDF"
 * uses the browser's own print-to-PDF, with a print stylesheet that drops the
 * console chrome, so the file is exactly what is on screen.
 */
export default function BoardReportPage() {
  const [range, setRange] = useState<Range>("30");
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => daysAgo(0));
  const period = range === "custom" ? { from, to } : { from: daysAgo(Number(range)), to: daysAgo(0) };
  const { data, error, isLoading } = useBoardReport(period);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <Link href="/dashboard/compliance" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-d-muted hover:text-d-text">
            <ArrowLeft size={14} weight="bold" /> Compliance
          </Link>
          <h1 className="text-[26px] font-bold tracking-tight text-d-text lg:text-[30px]">Board report</h1>
          <p className="mt-1 text-[14px] text-d-muted">A one-page summary of any period.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "custom", label: "Custom" },
            ]}
          />
          <Button icon={<Printer size={16} />} onClick={() => window.print()} disabled={!data}>
            Download PDF
          </Button>
        </div>
      </div>

      {range === "custom" && (
        <div className="grid max-w-md grid-cols-2 gap-3 print:hidden">
          <Field label="From">
            <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}

      {error ? (
        <Notice tone="danger">{error.message}</Notice>
      ) : isLoading && !data ? (
        <Skeleton className="h-[600px] w-full" />
      ) : data ? (
        <Report data={data} />
      ) : null}
    </>
  );
}

function pct(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n * 100)}%`;
}

function Report({ data }: { data: BoardReport }) {
  const v = data.volume;
  const r = data.review;
  const c = data.controls;
  const lat = data.latency_ms;
  const fmtDate = (d: string | null) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <Card className="report-sheet mx-auto w-full max-w-[900px] !rounded-[24px] p-5 print:max-w-none print:!border-0 print:p-0 print:shadow-none sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-d-border pb-6">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand">Fraud prevention report</p>
          <h2 className="mt-1 text-[28px] font-bold tracking-tight text-d-text">{data.institution.name}</h2>
          <p className="mt-1 text-[14px] text-d-muted">
            {fmtDate(data.period.from)} to {fmtDate(data.period.to)}
          </p>
        </div>
        <div className="text-right text-[12px] text-d-muted">
          <p>Prepared by Fable</p>
          <p>Generated {new Date(data.generated_at).toLocaleString("en-NG")}</p>
        </div>
      </header>

      {/* Headline */}
      <section className="grid grid-cols-2 gap-4 py-6 md:grid-cols-4">
        <Headline label="Kept from fraud" value={formatNaira(data.protection.kept_from_fraud_ngn)} sub={`${data.protection.transfers_stopped} transfers stopped`} accent />
        <Headline label="Transfers scored" value={v.transactions.toLocaleString("en-NG")} sub={`${formatNaira(v.value_ngn)} in value`} />
        <Headline label="Frictionless" value={pct(v.frictionless_rate)} sub="Passed with no extra step" />
        <Headline
          label="Decision time (p50)"
          value={lat ? `${Math.round(lat.p50)}ms` : "-"}
          sub={lat ? `p95 ${Math.round(lat.p95)}ms, budget ${LATENCY_BUDGET_MS}ms` : "Not measured in this period"}
        />
      </section>

      <div className="grid gap-6 border-t border-d-border py-6 md:grid-cols-2">
        <section>
          <SectionTitle>Decisions</SectionTitle>
          <Row label="Passed" value={v.passed} total={v.transactions} color="#10b981" />
          <Row label="Flagged for verification" value={v.flagged} total={v.transactions} color="#f59e0b" />
          <Row label="Blocked" value={v.blocked} total={v.transactions} color="#ef4444" />
        </section>

        <section>
          <SectionTitle>Analyst review</SectionTitle>
          <Line label="Cases reviewed" value={r.reviewed.toLocaleString("en-NG")} />
          <Line label="Confirmed fraud" value={r.fraud.toLocaleString("en-NG")} />
          <Line label="Confirmed legitimate" value={r.legitimate.toLocaleString("en-NG")} />
          <Line label="Still open or escalated" value={(r.open + r.in_review + r.escalated).toLocaleString("en-NG")} />
          <Line
            label="Precision of reviewed alerts"
            value={pct(r.precision)}
            hint={r.precision == null ? "Shown once cases have been reviewed" : "Share of reviewed alerts that were real fraud"}
          />
        </section>
      </div>

      <div className="grid gap-6 border-t border-d-border py-6 md:grid-cols-2">
        <section>
          <SectionTitle>Most common risk signals</SectionTitle>
          {data.top_signals.length === 0 ? (
            <p className="text-[13px] text-d-muted">No flagged or blocked transfers in this period.</p>
          ) : (
            data.top_signals.map((s) => <Line key={s.code} label={s.label} value={s.count.toLocaleString("en-NG")} />)
          )}
        </section>
        <section>
          <SectionTitle>Channels</SectionTitle>
          {data.channels.length === 0 ? (
            <p className="text-[13px] text-d-muted">No transfers in this period.</p>
          ) : (
            data.channels.map((ch) => (
              <Line key={ch.label} label={ch.label} value={`${ch.total.toLocaleString("en-NG")}`} hint={`${ch.risky} flagged or blocked`} />
            ))
          )}
        </section>
      </div>

      <div className="grid gap-6 border-t border-d-border py-6 md:grid-cols-2">
        <section>
          <SectionTitle>Controls in operation</SectionTitle>
          <Line label="Identity checks passed" value={c.identity_checks_passed} />
          <Line label="Identity checks failed" value={c.identity_checks_failed} />
          <Line label="Transfers held by Ghost" value={c.holds_created} />
          <Line label="Holds that returned the money" value={c.holds_cancelled} />
        </section>
        <section>
          <SectionTitle>Governance</SectionTitle>
          <Line label="Flag threshold" value={data.policy.flag_threshold.toFixed(2)} hint={data.policy.custom.includes("flag_threshold") ? "Set by your institution" : "Fable default"} />
          <Line label="Block threshold" value={data.policy.block_threshold.toFixed(2)} hint={data.policy.custom.includes("block_threshold") ? "Set by your institution" : "Fable default"} />
          <Line label="Risk policy changes" value={c.policy_changes} />
          <Line label="Team access changes" value={c.team_changes} />
          <Line label="API key rotations" value={c.key_rotations} />
        </section>
      </div>

      <footer className="border-t border-d-border pt-5 text-[11px] leading-relaxed text-d-faint">
        Figures are computed from {data.institution.name}&apos;s own records in Fable for the period shown. &ldquo;Kept from
        fraud&rdquo; counts transfers Shield did not pass that ended blocked, cancelled or still held. Frameworks referenced
        in the console describe what Fable is built against; they are not certifications.
      </footer>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-d-faint">{children}</h3>;
}

function Headline({ label, value, sub, accent = false }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? "bg-brand text-white print:bg-transparent print:text-d-text" : "bg-d-surface-2"}`}>
      <p className={`text-[12px] font-medium ${accent ? "text-white/80 print:text-d-muted" : "text-d-muted"}`}>{label}</p>
      <p className="mt-1 break-words text-[19px] font-bold leading-tight tracking-tight sm:text-[22px]">{value}</p>
      <p className={`mt-1 text-[11px] ${accent ? "text-white/75 print:text-d-faint" : "text-d-faint"}`}>{sub}</p>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-d-border/60 py-2 last:border-0">
      <span className="text-[13px] text-d-muted">
        {label}
        {hint && <span className="block text-[11px] text-d-faint">{hint}</span>}
      </span>
      <span className="text-[14px] font-semibold tabular-nums text-d-text">{value}</span>
    </div>
  );
}

function Row({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const share = total ? value / total : 0;
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-d-muted">{label}</span>
        <span className="font-semibold tabular-nums text-d-text">
          {value.toLocaleString("en-NG")} <span className="font-normal text-d-faint">({Math.round(share * 100)}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
