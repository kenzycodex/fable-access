"use client";

import { ChartLineUp, Prohibit, ShieldCheck, Warning } from "@phosphor-icons/react";
import { DonutChart } from "@/components/dashboard/charts";
import { BarList, Card, CardHeader, PageHeader, StatCard, StatGrid } from "@/components/dashboard/primitives";
import { useIntelligence } from "@/lib/fable/useBackend";

export default function IntelligencePage() {
  // Live from the FastAPI intelligence endpoint (real DB rollups).
  const { data } = useIntelligence();
  const s = data?.summary;

  const patterns = (data?.scam_patterns ?? []).map((p) => ({ label: p.label, count: p.count }));
  const channels = (data?.channels ?? []).map((c) => ({
    label: c.label,
    count: c.total,
    hint: c.risky > 0 ? `${c.risky} risky` : undefined,
  }));
  const signals = (data?.signals ?? []).map((sig) => ({ label: sig.label, count: sig.count }));

  const total = s ? s.blocked + s.flagged + s.passed : 0;
  const riskRate = total && s ? Math.round(((s.blocked + s.flagged) / total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Insights"
        description="Which scams, channels and signals show up most."
      />

      <StatGrid>
        <StatCard label="Risk rate" value={s ? `${riskRate}%` : "-"} sub="Flagged or blocked" icon={<ChartLineUp size={17} weight="bold" />} featured />
        <StatCard label="Transfers scored" value={s ? total.toLocaleString("en-NG") : "-"} sub="Across all channels" tone="success" icon={<ShieldCheck size={17} weight="fill" />} />
        <StatCard label="Flagged" value={s ? String(s.flagged) : "-"} sub="Asked to verify" tone="warning" icon={<Warning size={17} weight="fill" />} />
        <StatCard label="Blocked" value={s ? String(s.blocked) : "-"} sub="Stopped outright" tone="danger" icon={<Prohibit size={17} weight="bold" />} />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Scam-pattern library" subtitle="Scripts that recur in blocked and flagged transfers" />
            <BarList items={patterns} emptyLabel="No scam patterns detected yet" color="#ef4444" />
          </Card>
          <Card>
            <CardHeader title="Signals fired" subtitle="Which signals fire most" />
            <BarList items={signals} emptyLabel="No signals fired yet" color="#f59e0b" />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Outcome mix" subtitle="All scored transfers" />
            <DonutChart
              segments={[
                { label: "Passed", value: s?.passed ?? 0, color: "#10b981" },
                { label: "Flagged", value: s?.flagged ?? 0, color: "#f59e0b" },
                { label: "Blocked", value: s?.blocked ?? 0, color: "#ef4444" },
              ]}
              centerValue={s ? total.toLocaleString("en-NG") : "-"}
              centerLabel="transfers"
            />
          </Card>
          <Card>
            <CardHeader title="Channel breakdown" subtitle="Volume by channel" />
            <BarList items={channels} emptyLabel="No channel data yet" />
          </Card>
        </div>
      </div>
    </>
  );
}
