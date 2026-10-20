"use client";

import { useMemo, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { ConfirmDialog } from "@/components/dashboard/Dialog";
import { OwnerOnlyNotice } from "@/components/dashboard/settings/OwnerOnly";
import { Badge, Button, Card, CardHeader, Field, Notice, Skeleton, TextInput } from "@/components/dashboard/primitives";
import { updateRiskPolicy, type PolicyFields, type PolicyResponse } from "@/lib/fable/console";
import { useDashboardFeed } from "@/lib/fable/useBackend";
import { usePermissions, useRiskPolicy } from "@/lib/fable/useConsole";
import { useFableStore } from "@/lib/fable/store";

export default function RiskPolicyPage() {
  const { data, error, mutate } = useRiskPolicy();
  if (error) return <Notice tone="danger">{error.message}</Notice>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  // Keyed on when the policy was last saved, so the form resets to the stored
  // values after a save instead of syncing state in an effect.
  return <PolicyForm key={data.policy.updated_at ?? "default"} data={data} onSaved={(next) => mutate(next, { revalidate: false })} />;
}

const FIELDS: (keyof PolicyFields)[] = [
  "flag_threshold",
  "block_threshold",
  "hold_high_minutes",
  "hold_medium_minutes",
  "hold_low_minutes",
  "hold_on_flag",
  "analysts_can_release",
];

function PolicyForm({ data, onSaved }: { data: PolicyResponse; onSaved: (next: PolicyResponse) => void }) {
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? "";
  const { canManage } = usePermissions();
  const feed = useDashboardFeed();
  const [form, setForm] = useState<PolicyFields>(() => pick(data.policy));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const saved = pick(data.policy);
  const dirty = FIELDS.some((k) => form[k] !== saved[k]);
  const atDefaults = FIELDS.every((k) => form[k] === data.defaults[k]);
  const gapOk = form.block_threshold - form.flag_threshold >= 0.049;
  const holdsOk = form.hold_high_minutes >= form.hold_medium_minutes && form.hold_medium_minutes >= form.hold_low_minutes;
  const valid = gapOk && holdsOk;

  // What the bank's own recent transfers would have looked like under the
  // proposed cutoffs. Scores are kept, only the lines move, so this is an
  // honest preview rather than a model of a different engine.
  const preview = useMemo(() => {
    const scores = feed.transactions.map((t) => t.riskScore);
    const count = (flag: number, block: number) => ({
      flag: scores.filter((s) => s >= flag && s < block).length,
      block: scores.filter((s) => s >= block).length,
    });
    return {
      total: scores.length,
      now: count(saved.flag_threshold, saved.block_threshold),
      next: count(form.flag_threshold, form.block_threshold),
    };
  }, [feed.transactions, saved.flag_threshold, saved.block_threshold, form.flag_threshold, form.block_threshold]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const changes: Partial<PolicyFields> = {};
      const reset: string[] = [];
      for (const k of FIELDS) {
        if (form[k] === data.defaults[k]) reset.push(k);
        else changes[k] = form[k];
      }
      const next = await updateRiskPolicy(institutionId, changes, reset);
      onSaved(next);
      setConfirming(false);
      setMsg({ tone: "success", text: "Policy saved. New transfers are scored against it now." });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not save the policy." });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof PolicyFields, v: number) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <OwnerOnlyNotice />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Decision thresholds"
            subtitle="Where Shield draws the line. Per-channel adjustments still apply on top, so USSD keeps a little more room than internet banking."
          />
          <div className="flex flex-col gap-6">
            <Slider
              label="Flag for verification at"
              hint="At or above this score the customer is asked to verify before money moves."
              value={form.flag_threshold}
              def={data.defaults.flag_threshold}
              color="#f59e0b"
              disabled={!canManage}
              onChange={(v) => set("flag_threshold", v)}
            />
            <Slider
              label="Block at"
              hint="At or above this score the transfer is stopped outright."
              value={form.block_threshold}
              def={data.defaults.block_threshold}
              color="#ef4444"
              disabled={!canManage}
              onChange={(v) => set("block_threshold", v)}
            />
            {!gapOk && <Notice tone="danger">Keep the flag threshold at least 0.05 below the block threshold.</Notice>}
          </div>

          <div className="mt-8 border-t border-d-border pt-6">
            <CardHeader title="Ghost hold windows" subtitle="How long a held transfer waits for the customer. If they do not release it in time it expires and nothing is sent." />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Minutes label="Score 0.9 or more" value={form.hold_high_minutes} def={data.defaults.hold_high_minutes} disabled={!canManage} onChange={(v) => set("hold_high_minutes", v)} />
              <Minutes label="Score 0.7 to 0.9" value={form.hold_medium_minutes} def={data.defaults.hold_medium_minutes} disabled={!canManage} onChange={(v) => set("hold_medium_minutes", v)} />
              <Minutes label="Below 0.7" value={form.hold_low_minutes} def={data.defaults.hold_low_minutes} disabled={!canManage} onChange={(v) => set("hold_low_minutes", v)} />
            </div>
            {!holdsOk && <Notice tone="danger" className="mt-4">Riskier transfers must be held at least as long as less risky ones.</Notice>}
            <label className="mt-5 flex items-start gap-3 text-[13px] text-d-muted">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--brand-primary,#7c3aed)]"
                checked={form.hold_on_flag === 1}
                disabled={!canManage}
                onChange={(e) => set("hold_on_flag", e.target.checked ? 1 : 0)}
              />
              <span>
                <span className="font-semibold text-d-text">Offer a hold for flagged transfers too.</span> Off by default:
                a flagged transfer is verified and sent, and only a blocked one can be held.
              </span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-[13px] text-d-muted">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--brand-primary,#7c3aed)]"
                checked={form.analysts_can_release === 1}
                disabled={!canManage}
                onChange={(e) => set("analysts_can_release", e.target.checked ? 1 : 0)}
              />
              <span>
                <span className="font-semibold text-d-text">Let analysts release held transfers.</span> Off by default:
                only owners can. Every release needs a note of how the customer was verified and is recorded under the
                person&apos;s name.
              </span>
            </label>
          </div>

          {canManage && (
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-d-border pt-6">
              <Button disabled={!dirty || !valid} onClick={() => setConfirming(true)}>
                Save policy
              </Button>
              <Button variant="ghost" icon={<ArrowCounterClockwise size={15} />} disabled={atDefaults} onClick={() => setForm({ ...data.defaults })}>
                Reset to Fable defaults
              </Button>
              {data.policy.updated_by && (
                <span className="text-[12px] text-d-faint">Last changed by {data.policy.updated_by}</span>
              )}
            </div>
          )}
        </Card>

        <Card className="lg:sticky lg:top-24">
          <CardHeader title="What this would change" subtitle={`Your latest ${preview.total} transfers against these lines, before per-channel adjustments`} />
          {preview.total === 0 ? (
            <p className="text-[13px] text-d-muted">No transfers yet to preview against.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <PreviewRow label="Flagged" now={preview.now.flag} next={preview.next.flag} total={preview.total} color="#f59e0b" />
              <PreviewRow label="Blocked" now={preview.now.block} next={preview.next.block} total={preview.total} color="#ef4444" />
              <PreviewRow
                label="Passed with no friction"
                now={preview.total - preview.now.flag - preview.now.block}
                next={preview.total - preview.next.flag - preview.next.block}
                total={preview.total}
                color="#10b981"
              />
              <p className="mt-1 text-[12px] leading-relaxed text-d-faint">
                Lower lines catch more fraud and ask more genuine customers to verify. Higher lines do the opposite.
              </p>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        busy={busy}
        title="Apply this risk policy?"
        description="Every new transfer is scored against it immediately. Decisions already made are not changed. The change is recorded in the audit trail."
        confirmLabel="Apply policy"
      >
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {FIELDS.filter((k) => form[k] !== saved[k]).map((k) => (
            <li key={k} className="flex justify-between gap-3 rounded-lg bg-d-surface-2 px-3 py-2">
              <span className="text-d-muted">{LABELS[k]}</span>
              <span className="font-semibold tabular-nums text-d-text">
                {fmt(k, saved[k])} → {fmt(k, form[k])}
              </span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

const LABELS: Record<keyof PolicyFields, string> = {
  flag_threshold: "Flag at",
  block_threshold: "Block at",
  hold_high_minutes: "Hold, score 0.9+",
  hold_medium_minutes: "Hold, score 0.7 to 0.9",
  hold_low_minutes: "Hold, below 0.7",
  hold_on_flag: "Holds for flagged transfers",
  analysts_can_release: "Analysts can release holds",
};

function fmt(k: keyof PolicyFields, v: number) {
  if (k === "hold_on_flag" || k === "analysts_can_release") return v ? "On" : "Off";
  return k.endsWith("threshold") ? v.toFixed(2) : `${v} min`;
}

function pick(p: PolicyFields): PolicyFields {
  return {
    flag_threshold: p.flag_threshold,
    block_threshold: p.block_threshold,
    hold_high_minutes: p.hold_high_minutes,
    hold_medium_minutes: p.hold_medium_minutes,
    hold_low_minutes: p.hold_low_minutes,
    hold_on_flag: p.hold_on_flag ? 1 : 0,
    analysts_can_release: p.analysts_can_release ? 1 : 0,
  };
}

function Slider({
  label,
  hint,
  value,
  def,
  color,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  def: number;
  color: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-d-text">{label}</span>
        <span className="flex items-center gap-2">
          {value !== def && <Badge tone="brand">Custom</Badge>}
          <span className="rounded-lg px-2.5 py-1 text-[15px] font-bold tabular-nums text-white" style={{ backgroundColor: color }}>
            {value.toFixed(2)}
          </span>
        </span>
      </div>
      <input
        type="range"
        min={0.2}
        max={0.95}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        style={{ accentColor: color }}
      />
      <p className="mt-1 text-[12px] text-d-muted">
        {hint} Fable default {def.toFixed(2)}.
      </p>
    </div>
  );
}

function Minutes({
  label,
  value,
  def,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  def: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={`Default ${def} min`}>
      <div className="relative">
        <TextInput
          type="number"
          min={5}
          max={1440}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className="pr-14"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-d-faint">min</span>
      </div>
    </Field>
  );
}

function PreviewRow({ label, now, next, total, color }: { label: string; now: number; next: number; total: number; color: string }) {
  const diff = next - now;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-d-muted">{label}</span>
        <span className="font-semibold tabular-nums text-d-text">
          {next}
          {diff !== 0 && (
            <span className={`ml-1.5 text-[12px] ${diff > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              ({diff > 0 ? "+" : ""}
              {diff})
            </span>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${total ? (next / total) * 100 : 0}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
