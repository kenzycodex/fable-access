"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CaretDown, ShieldCheck } from "@phosphor-icons/react";
import { Card, PageHeader, RiskBadge, StatCard } from "@/components/dashboard/primitives";
import { apiChannelLabel, parseApiSignals } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { useShieldDecisions } from "@/lib/fable/useBackend";
import type { RiskAction } from "@/lib/fable/types";

export default function ShieldAgentPage() {
  const { data } = useShieldDecisions();
  const [openId, setOpenId] = useState<string | null>(null);

  const acc = data?.accuracy;

  return (
    <>
      <PageHeader
        title="Fable Shield"
        description="The real-time scoring engine. Twelve signal layers, personal baselines, and hard thresholds — every decision below is real and fully explainable."
        actions={
          <Link href="/dashboard/agents" className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white">
            <ArrowLeft size={14} weight="bold" /> All agents
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Transactions scored" value={(acc?.transactions_scored ?? 0).toLocaleString("en-NG")} icon={<ShieldCheck size={16} weight="fill" />} />
        <StatCard label="Pass rate" value={acc ? `${Math.round(acc.pass_rate * 100)}%` : "—"} accent="text-emerald-400" sub="frictionless transfers" />
        <StatCard label="Friction events" value={String(acc?.friction_events ?? "—")} accent="text-amber-400" sub="flagged + blocked" />
        <StatCard label="False-positive proxy" value={String(acc?.false_positive_proxy ?? "—")} accent="text-red-400" sub="friction later confirmed safe" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Pipeline */}
        <Card className="lg:col-span-2">
          <h2 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Scoring pipeline</h2>
          <p className="mb-4 text-[12px] text-gray-500 dark:text-white/40">
            Signals are additive; the sum decides. FLAG at ≥ {data?.thresholds.flag ?? 0.5}, BLOCK at ≥ {data?.thresholds.block ?? 0.8}.
          </p>
          <div className="flex flex-col gap-2">
            {(data?.pipeline ?? []).map((step) => (
              <div key={step.code} className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-white/[0.04] dark:bg-[#0d0d0d]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#7C3AED]/10 text-[11px] font-bold text-[#7C3AED]">
                      {step.step}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{step.label}</span>
                  </div>
                  <span className="shrink-0 rounded bg-[#7C3AED]/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#7C3AED]">
                    +{step.max_weight}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/[0.05]">
                  <div className="h-full rounded-full bg-[#7C3AED]/70" style={{ width: `${Math.min(step.max_weight, 0.5) * 200}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-white/35">{step.description}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent decisions */}
        <Card className="lg:col-span-3">
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Recent decisions</h2>
          {(data?.decisions ?? []).length === 0 ? (
            <p className="py-8 text-center text-[13px] text-gray-400 dark:text-white/30">Waiting for the Fable API…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(data?.decisions ?? []).map((d) => {
                const open = openId === d.id;
                const signals = parseApiSignals(d.signals ?? []);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setOpenId(open ? null : d.id)}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:border-[#7C3AED]/30 dark:border-white/[0.04] dark:bg-[#0d0d0d]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
                          {formatNaira(d.amount)} → {prettyId(d.recipient_id)}{d.recipient_bank ? ` · ${d.recipient_bank}` : ""}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-white/35">
                          {d.user_id} · {d.channel ? apiChannelLabel(d.channel) : "—"} · risk {d.risk_score?.toFixed(3) ?? "—"}
                          {d.is_seed ? " · seed" : " · live"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <RiskBadge action={(d.action_taken ?? "PASS") as RiskAction} />
                        <CaretDown size={13} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
                      </div>
                    </div>

                    {open && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-white/[0.05]">
                        {signals.length === 0 ? (
                          <p className="text-[12px] text-gray-400 dark:text-white/30">No signals fired — clean pass.</p>
                        ) : (
                          signals.map((s, i) => (
                            <div key={`${s.code}-${i}`} className="flex items-center justify-between gap-3 text-[12px]">
                              <span className="text-gray-700 dark:text-white/70">
                                <span className="font-semibold">{s.label}</span>
                                <span className="text-gray-500 dark:text-white/40"> — {s.detail}</span>
                              </span>
                              <span className="shrink-0 rounded bg-[#7C3AED]/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#7C3AED]">
                                +{s.weight}
                              </span>
                            </div>
                          ))
                        )}
                        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-gray-500 dark:text-white/35 sm:grid-cols-4">
                          <ContextFact label="Location" value={d.city ? `${d.city}${d.country ? `, ${d.country}` : ""} (${d.location_source ?? "?"})` : "not collected"} />
                          <ContextFact label="Auth" value={d.auth_method ?? "unknown"} />
                          <ContextFact label="Session" value={d.session_duration_seconds != null ? `${d.session_duration_seconds}s` : "—"} />
                          <ContextFact label="Typing" value={d.typing_speed_ms != null ? `${Math.round(d.typing_speed_ms)}ms/key${d.paste_detected ? " · pasted" : ""}` : d.paste_detected ? "pasted" : "—"} />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function prettyId(id: string | null): string {
  if (!id || id === "unknown") return "Unknown";
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ContextFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">{label}</span>{" "}
      {value}
    </span>
  );
}
