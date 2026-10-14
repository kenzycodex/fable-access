"use client";

import type { ReactNode } from "react";
import {
  Bank,
  ClockCounterClockwise,
  EnvelopeSimple,
  Export,
  Pause,
  Play,
  Rocket,
  ShieldCheck,
  SignIn,
  Sparkle,
  Trash,
  UserGear,
  UserPlus,
  Warning,
} from "@phosphor-icons/react";
import { Badge } from "@/components/dashboard/primitives";
import { formatRelativeTime } from "@/lib/fable/format";
import type { InstitutionRow } from "@/lib/fable/operator";

/** A UTC timestamp from the API ("2026-10-14 09:30:00" or ISO) as milliseconds. */
export function utcMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function ago(iso: string | null | undefined): string {
  const ms = utcMs(iso);
  return ms === null ? "-" : formatRelativeTime(ms);
}

export function fullDate(iso: string | null | undefined): string {
  const ms = utcMs(iso);
  return ms === null
    ? ""
    : new Date(ms).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-NG");

/** Where an institution is: the four stages the platform tracks. */
export type Stage = "setting_up" | "ready" | "live" | "suspended";

export function stageOf(i: Pick<InstitutionRow, "status" | "mode" | "ready_to_go_live">): Stage {
  if (i.status === "suspended") return "suspended";
  if (i.mode === "live") return "live";
  return i.ready_to_go_live ? "ready" : "setting_up";
}

export const STAGE: Record<Stage, { label: string; tone: "neutral" | "brand" | "success" | "danger"; color: string }> = {
  setting_up: { label: "Setting up", tone: "neutral", color: "#a78bfa" },
  ready: { label: "Ready to go live", tone: "brand", color: "#7c3aed" },
  live: { label: "Live", tone: "success", color: "#10b981" },
  suspended: { label: "Suspended", tone: "danger", color: "#ef4444" },
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE[stage].tone}>{STAGE[stage].label}</Badge>;
}

/** The institution's initials in a tile, tinted by its stage. */
export function InstitutionMark({ name, stage, size = "md" }: { name: string; stage: Stage; size?: "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const box = size === "lg" ? "size-14 text-[18px] rounded-2xl" : "size-10 text-[13px] rounded-xl";
  return (
    <span className={`relative flex shrink-0 items-center justify-center bg-brand/10 font-bold text-brand ${box}`}>
      {initials || <Bank size={18} />}
      <span
        className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-d-surface"
        style={{ background: STAGE[stage].color }}
        aria-hidden
      />
    </span>
  );
}

/** Setup progress as a thin bar with "4/8". */
export function SetupBar({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className={`flex items-center gap-2 ${className}`} title={`${done} of ${total} setup steps done`}>
      <span className="h-1.5 min-w-[64px] flex-1 overflow-hidden rounded-full bg-d-surface-2">
        <span className={`block h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-d-muted">
        {done}/{total}
      </span>
    </span>
  );
}

const EVENTS: Record<string, { label: string; icon: ReactNode; tone?: string }> = {
  "operator.login": { label: "Signed in", icon: <SignIn size={15} /> },
  "operator.invited": { label: "Invited an operator", icon: <UserPlus size={15} /> },
  "operator.changed": { label: "Changed an operator", icon: <UserGear size={15} /> },
  "institution.provisioned": { label: "Created an institution", icon: <Bank size={15} />, tone: "text-brand" },
  "institution.suspended": { label: "Suspended an institution", icon: <Pause size={15} />, tone: "text-red-500" },
  "institution.reactivated": { label: "Reactivated an institution", icon: <Play size={15} />, tone: "text-emerald-500" },
  "institution.owner_invited": { label: "Invited an owner", icon: <EnvelopeSimple size={15} /> },
  "institution.exported": { label: "Exported data", icon: <Export size={15} /> },
  "institution.data_cleared": { label: "Cleared customer data", icon: <Warning size={15} />, tone: "text-red-500" },
  "institution.deleted": { label: "Deleted an institution", icon: <Trash size={15} />, tone: "text-red-500" },
  "institution.mode_changed": { label: "Changed mode", icon: <Rocket size={15} /> },
  "institution.agreements_confirmed": { label: "Confirmed the agreements", icon: <ShieldCheck size={15} /> },
  "institution.assistant_changed": { label: "Changed Ask Fable for an institution", icon: <Sparkle size={15} /> },
  "platform.assistant_changed": { label: "Changed Ask Fable limits", icon: <Sparkle size={15} />, tone: "text-brand" },
  "team.invited": { label: "Member invited", icon: <UserPlus size={15} /> },
  "import.applied": { label: "Data imported", icon: <Export size={15} /> },
  "apikey.rotated": { label: "API key created", icon: <ShieldCheck size={15} /> },
  "policy.changed": { label: "Risk policy saved", icon: <ShieldCheck size={15} /> },
  "sandbox.reset": { label: "Sandbox reset", icon: <ClockCounterClockwise size={15} /> },
};

export function eventLabel(type: string): string {
  return EVENTS[type]?.label ?? type.replace(/[._]/g, " ");
}

export function EventIcon({ type }: { type: string }) {
  const e = EVENTS[type];
  return (
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg bg-d-surface-2 ${e?.tone ?? "text-d-muted"}`}>
      {e?.icon ?? <ClockCounterClockwise size={15} />}
    </span>
  );
}

/** The one line of detail worth showing for an audit event. */
export function eventDetail(payload: Record<string, unknown>): string {
  const p = payload as Record<string, unknown>;
  if (p.changes && typeof p.changes === "object") {
    return Object.entries(p.changes as Record<string, { from: unknown; to: unknown }>)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v.from)} → ${String(v.to)}`)
      .join(", ");
  }
  if (p.enabled !== undefined || p.daily_answers !== undefined) {
    const on = p.enabled === null || p.enabled === undefined ? "platform setting" : p.enabled ? "on" : "off";
    const budget = p.daily_answers === null || p.daily_answers === undefined ? "platform budget" : `${p.daily_answers} a day`;
    return `AI ${on}, ${budget}`;
  }
  const pick = p.reason ?? p.owner ?? p.operator_email ?? p.name ?? p.mode ?? "";
  return typeof pick === "string" ? pick : "";
}
