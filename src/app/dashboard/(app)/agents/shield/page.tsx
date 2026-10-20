"use client";

import { useState } from "react";
import { ArrowLeft, CaretDown, CheckCircle, Flag, ShieldCheck, Warning } from "@phosphor-icons/react";
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  RiskBadge,
  StatCard,
  StatGrid,
} from "@/components/dashboard/primitives";
import { apiChannelLabel, parseApiSignals } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { useCustomerNames } from "@/lib/fable/useInstitution";
import { useShieldDecisions } from "@/lib/fable/useBackend";
import type { RiskAction } from "@/lib/fable/types";

export default function ShieldAgentPage() {
  const nameFor = useCustomerNames();
  const { data } = useShieldDecisions();
  const [openId, setOpenId] = useState<string | null>(null);

  const acc = data?.accuracy;

  return (
    <>
      <PageHeader
        title="Fable Shield"
        description="The real-time scoring engine and every decision it made."
        actions={
          <ButtonLink href="/dashboard/agents" variant="secondary" icon={<ArrowLeft size={14} weight="bold" />}>
            All agents
          </ButtonLink>
        }
      />

      <StatGrid>
        <StatCard label="Transactions scored" value={(acc?.transactions_scored ?? 0).toLocaleString("en-NG")} sub="Every decision, explained" icon={<ShieldCheck size={17} weight="fill" />} featured />
        <StatCard label="Pass rate" value={acc ? `${Math.round(acc.pass_rate * 100)}%` : "-"} tone="success" sub="Frictionless transfers" icon={<CheckCircle size={17} weight="fill" />} />
        <StatCard label="Friction events" value={String(acc?.friction_events ?? "-")} tone="warning" sub="Flagged plus blocked" icon={<Warning size={17} weight="fill" />} />
        <StatCard label="Cleared as safe" value={String(acc?.false_positive_proxy ?? "-")} tone="danger" sub="Flagged, later confirmed legitimate" icon={<Flag size={17} weight="fill" />} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Scoring pipeline"
            subtitle={`Signals are additive and the sum decides. Flag at ${data?.thresholds.flag ?? 0.5} or more, block at ${data?.thresholds.block ?? 0.8}.`}
          />
          <div className="flex flex-col gap-2">
            {(data?.pipeline ?? []).map((step) => (
              <div key={step.code} className="rounded-xl bg-d-surface-2 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/10 text-[11px] font-bold text-brand">
                      {step.step}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-d-text">{step.label}</span>
                  </div>
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                    +{step.max_weight}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-d-border">
                  <div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.min(step.max_weight, 0.5) * 200}%` }} />
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-d-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Recent decisions" subtitle="Open one to see the signals behind it" />
          {(data?.decisions ?? []).length === 0 ? (
            <EmptyState icon={<ShieldCheck size={22} />} title="No decisions yet" body="Waiting for the Fable API." />
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
                    className="rounded-xl bg-d-surface-2 px-4 py-3 text-left transition-colors hover:bg-d-border"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-d-text">
                          {formatNaira(d.amount)} to {prettyId(d.recipient_id)}
                          {d.recipient_bank ? ` · ${d.recipient_bank}` : ""}
                        </p>
                        <p className="text-[12px] text-d-muted">
                          {nameFor(d.user_id)} · {d.channel ? apiChannelLabel(d.channel) : "-"} · risk {d.risk_score?.toFixed(3) ?? "-"}
                          {d.is_seed ? " · seed" : " · live"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <RiskBadge action={(d.action_taken ?? "PASS") as RiskAction} />
                        <CaretDown size={13} className={`text-d-faint transition-transform ${open ? "rotate-180" : ""}`} />
                      </div>
                    </div>

                    {open && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-d-border pt-3">
                        {signals.length === 0 ? (
                          <p className="text-[12px] text-d-muted">No signals fired, a clean pass.</p>
                        ) : (
                          signals.map((s, i) => (
                            <div key={`${s.code}-${i}`} className="flex items-center justify-between gap-3 text-[12px]">
                              <span className="text-d-muted">
                                <span className="font-semibold text-d-text">{s.label}</span> {s.detail}
                              </span>
                              <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                                +{s.weight}
                              </span>
                            </div>
                          ))
                        )}
                        <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] text-d-muted sm:grid-cols-4">
                          <ContextFact label="Location" value={d.city ? `${d.city}${d.country ? `, ${d.country}` : ""} (${d.location_source ?? "?"})` : "not collected"} />
                          <ContextFact label="Auth" value={d.auth_method ?? "unknown"} />
                          <ContextFact label="Session" value={d.session_duration_seconds != null ? `${d.session_duration_seconds}s` : "-"} />
                          <ContextFact label="Typing (not scored)" value={d.typing_speed_ms != null ? `${Math.round(d.typing_speed_ms)}ms/key${d.paste_detected ? " · pasted" : ""}` : d.paste_detected ? "pasted" : "-"} />
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
      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">{label}</span>
      {value}
    </span>
  );
}
