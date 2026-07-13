"use client";

import { ShieldNetworkIcon } from "@/components/app-icons";
import { BarList } from "@/components/dashboard/BarList";
import { Card, PageHeader } from "@/components/dashboard/primitives";
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
  const riskRate = total ? (s!.blocked + s!.flagged) / total : 0;

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="What Fable is learning across your transaction feed: which scam scripts recur, which channels carry risk, and which signals fire most."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Scam-pattern library</h2>
          <BarList items={patterns} emptyLabel="No scam patterns detected yet" accent="#ff3b5c" />
        </Card>

        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Signals fired</h2>
          <BarList items={signals} emptyLabel="No signals fired yet" accent="#ffb547" />
        </Card>

        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Channel breakdown</h2>
          <BarList items={channels} accent="#00d4ff" />
        </Card>

        <Card className="flex flex-col justify-between gap-4 border-[#7C3AED]/10 dark:border-[#7C3AED]/20 shadow-sm dark:shadow-[0_0_20px_rgba(124,58,237,0.05)] bg-[#7C3AED]/[0.02] dark:bg-[#1a1a1a]">
          <div className="flex flex-col gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
              <ShieldNetworkIcon className="size-5" />
            </span>
            <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">The network effect</h2>
            <p className="text-[13px] text-gray-600 dark:text-white/60 leading-relaxed">
              A device fingerprint caught committing fraud at one connected institution is flagged across every other
              partner within minutes. Only hashed signals are shared, never raw personal data.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-gray-200 dark:border-white/[0.04] pt-4 text-center mt-2">
            <NetStat value={String(s?.blocked ?? 0)} label="Blocked" />
            <NetStat value={String(s?.flagged ?? 0)} label="Flagged" />
            <NetStat value={`${Math.round(riskRate * 100)}%`} label="Risk rate" />
          </div>
        </Card>
      </div>
    </>
  );
}

function NetStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[20px] font-bold tabular-nums text-gray-900 dark:text-white tracking-tight">{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-white/40">{label}</span>
    </div>
  );
}
