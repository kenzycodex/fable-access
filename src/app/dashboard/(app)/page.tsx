"use client";

import Link from "next/link";
import {
  Brain,
  Eye,
  Ghost,
  ShieldCheck,
  Lightning,
} from "@phosphor-icons/react";
import { Card, PageHeader, RiskBadge, StatCard } from "@/components/dashboard/primitives";
import { formatNaira, formatNairaCompact, formatRelativeTime } from "@/lib/fable/format";
import { INSTITUTION } from "@/lib/fable/seed";
import { useDashboardFeed } from "@/lib/fable/useBackend";
import type { Transaction } from "@/lib/fable/types";

const AGENTS = [
  { name: "Copilot", role: "Baseline engine", icon: Brain },
  { name: "Shield", role: "Threat defense", icon: ShieldCheck },
  { name: "Ghost", role: "Containment", icon: Ghost },
  { name: "Watch", role: "Passive monitor", icon: Eye },
];

export default function OverviewPage() {
  const feed = useDashboardFeed();
  const s = feed.stats;
  const recent = feed.transactions.slice(0, 8);

  return (
    <>
      <div className="relative mb-3 rounded-3xl overflow-hidden border border-gray-200 dark:border-white/[0.04] bg-white dark:bg-black p-8 lg:p-10 shadow-sm dark:shadow-none">
        {/* Abstract SVG Background Illustration */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-40">
          <svg className="absolute left-[10%] top-0 h-[200%] w-auto -translate-y-1/4 animate-[spin_60s_linear_infinite]" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g filter="url(#blur-glow)">
              <circle cx="400" cy="400" r="300" fill="url(#purple-grad)" fillOpacity="0.4" />
              <path d="M400 150C538 150 650 262 650 400C650 538 538 650 400 650C262 650 150 538 150 400C150 262 262 150 400 150Z" stroke="url(#purple-grad)" strokeWidth="2" strokeDasharray="10 10" />
            </g>
            <defs>
              <filter id="blur-glow" x="-100" y="-100" width="1000" height="1000" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation="60" result="effect1_foregroundBlur" />
              </filter>
              <radialGradient id="purple-grad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(400 400) rotate(90) scale(300)">
                <stop stopColor="#7C3AED" />
                <stop offset="1" stopColor="#4c1d95" stopOpacity="0" />
              </radialGradient>
            </defs>
          </svg>
        </div>

        <div className="relative z-10">
          <PageHeader
            title={`Good morning, ${INSTITUTION.name}`}
            description="Live view of every decision Fable made across your customers today."
            actions={<EngineChip source={feed.source} />}
          />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mt-0">
        <StatCard label="Transactions" value={String(s.total)} sub="Scored by Fable" />
        <StatCard
          label="Threats blocked"
          value={String(s.blockCount)}
          sub={`${s.flagCount} flagged for review`}
          icon={<ShieldCheck size={20} weight="fill" />}
          accent="text-red-400"
        />
        <StatCard
          label="Amount protected"
          value={formatNairaCompact(s.amountProtected)}
          sub="Kept out of fraud"
          accent="text-emerald-400"
        />
        <StatCard
          label="Avg decision"
          value={`${s.avgLatencyMs}ms`}
          sub="Well under 200ms budget"
          icon={<Lightning size={20} weight="fill" />}
          accent="text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mt-4">
        {/* Recent activity */}
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b border-gray-100 dark:border-white/[0.04] pb-4">
            <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">Live Activity Stream</h2>
            <Link href="/dashboard/transactions" className="text-[12px] font-bold text-[#7C3AED] hover:text-[#7C3AED]/80 transition-colors">
              View all
            </Link>
          </div>
          <div className="flex flex-col">
            {!feed.ready ? (
              <SkeletonRows />
            ) : (
              recent.map((t) => <ActivityRow key={t.id} txn={t} />)
            )}
          </div>
        </Card>

        {/* Right column: risk split + agents */}
        <div className="flex flex-col gap-6">
          <Card className="!p-0 flex flex-col">
            <div className="p-6 pb-4">
              <h2 className="mb-5 text-[15px] font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded bg-gray-100 dark:bg-white/[0.05] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/60">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                </span>
                Risk distribution
              </h2>
              <RiskBar pass={s.passCount} flag={s.flagCount} block={s.blockCount} />
              <div className="mt-5 flex flex-col gap-3 text-[13px]">
                <Legend color="#34d399" label="Passed" value={s.passCount} />
                <Legend color="#fbbf24" label="Flagged" value={s.flagCount} />
                <Legend color="#f87171" label="Blocked" value={s.blockCount} />
              </div>
            </div>
          </Card>

          <Card className="relative group">
            {/* SVG Illustration Background */}
            <div className="absolute inset-0 pointer-events-none opacity-10">
              <svg width="100%" height="100%" className="absolute inset-0">
                <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" className="text-[#7C3AED]"/>
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
              <div className="absolute inset-0 bg-gradient-to-t from-white via-white/80 dark:from-black dark:via-black/80 to-transparent" />
            </div>

            <h2 className="mb-5 text-[15px] font-bold text-gray-900 dark:text-white relative z-10 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded bg-[#7C3AED]/20 border border-[#7C3AED]/30 text-[#7C3AED]">
                <Brain size={12} weight="bold" />
              </span>
              Active Agents
            </h2>
            <div className="flex flex-col gap-4 relative z-10">
              {AGENTS.map((a) => {
                const Icon = a.icon;
                return (
                  <div key={a.name} className="flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer group/agent">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20 transition-transform group-hover/agent:scale-110">
                      <Icon size={20} weight="fill" />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-bold text-gray-900 dark:text-white transition-colors group-hover/agent:text-[#a78bfa]">{a.name}</span>
                      <span className="text-[11px] text-gray-500 dark:text-white/40">{a.role}</span>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                      Active
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function EngineChip({ source }: { source: "api" | "local" }) {
  const live = source === "api";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
        live 
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
      }`}
      title={
        live
          ? "Connected to the Fable API — real Shield scoring and persistence"
          : "Fable API offline — running on the built-in client engine"
      }
    >
      <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-amber-400"}`} />
      {live ? "Fable API · live" : "Local engine"}
    </span>
  );
}

function ActivityRow({ txn }: { txn: Transaction }) {
  // A simple hash function to assign a color based on the first letter
  const colors = ["bg-emerald-500/10 text-emerald-500", "bg-blue-500/10 text-blue-500", "bg-purple-500/10 text-purple-500", "bg-rose-500/10 text-rose-500", "bg-amber-500/10 text-amber-500"];
  const initial = txn.customerName.charAt(0).toUpperCase();
  const colorClass = colors[initial.charCodeAt(0) % colors.length];

  return (
    <div className="flex items-center gap-4 border-b border-gray-100 dark:border-white/[0.04] py-3.5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] px-2 -mx-2 rounded-xl transition-colors cursor-pointer">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl font-bold border border-gray-200/50 dark:border-white/[0.02] ${colorClass}`}>
        {initial}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[14px] font-bold text-gray-900 dark:text-white">
          {txn.customerName} → {txn.recipientName}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/40 font-medium">
          {formatRelativeTime(txn.timestamp)} · {txn.recipientBank}
          {txn.live && <span className="rounded-md bg-[#7C3AED]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#7C3AED]">Live</span>}
        </span>
      </div>
      <div className="ml-auto flex flex-col items-end gap-1.5">
        <span className="text-[14px] font-bold tabular-nums text-gray-900 dark:text-white">{formatNaira(txn.amount)}</span>
        <RiskBadge action={txn.action} />
      </div>
    </div>
  );
}

function RiskBar({ pass, flag, block }: { pass: number; flag: number; block: number }) {
  const total = pass + flag + block || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
      <div style={{ width: `${(pass / total) * 100}%`, backgroundColor: "#34d399" }} className="transition-all duration-500" />
      <div style={{ width: `${(flag / total) * 100}%`, backgroundColor: "#fbbf24" }} className="transition-all duration-500" />
      <div style={{ width: `${(block / total) * 100}%`, backgroundColor: "#f87171" }} className="transition-all duration-500" />
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-3 rounded-full shadow-sm" style={{ backgroundColor: color }} />
      <span className="text-gray-500 dark:text-white/60 font-medium">{label}</span>
      <span className="ml-auto font-bold tabular-nums text-gray-900 dark:text-white">{value.toLocaleString()}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 px-2 -mx-2">
          <div className="size-10 animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.04]" />
          <div className="flex flex-col gap-2">
            <div className="h-3.5 w-48 animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]" />
            <div className="h-2.5 w-32 animate-pulse rounded bg-gray-50 dark:bg-white/[0.03]" />
          </div>
          <div className="ml-auto h-3.5 w-20 animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]" />
        </div>
      ))}
    </>
  );
}
