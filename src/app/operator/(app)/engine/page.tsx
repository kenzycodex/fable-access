"use client";

import { useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ChartBar,
  Eye,
  FloppyDisk,
  HardDrives,
  Plus,
  Rocket,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Card, Field, Notice, PageHeader, Skeleton, TextInput, inputClass } from "@/components/dashboard/primitives";
import { StepUpDialog } from "@/components/operator/StepUpDialog";
import { ago, fullDate } from "@/components/operator/ui";
import {
  approveEngine,
  backtestEngine,
  createEngineDraft,
  promoteEngine,
  proposeEngine,
  rejectEngine,
  rollbackEngine,
  shadowEngine,
  stopShadowEngine,
  updateEngineDraft,
  useEngine,
  useEngineVersion,
  useShadowDiff,
  type BacktestGroup,
  type BacktestReport,
  type DecisionAction,
  type DecisionMatrix,
  type EngineOverview,
  type EngineParams,
  type EngineStatus,
  type EngineVersion,
} from "@/lib/fable/operator";

const ACTIONS: DecisionAction[] = ["PASS", "FLAG", "BLOCK"];

const STATUS: Record<EngineStatus, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  proposed: { label: "Waiting for approval", tone: "warning" },
  cooling: { label: "Cooling-off", tone: "warning" },
  approved: { label: "Approved", tone: "brand" },
  shadow: { label: "Shadow", tone: "brand" },
  active: { label: "Live", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

type Dialog =
  | { kind: "propose"; version: number; needsAck: boolean; drift: string[] }
  | { kind: "approve"; version: number; needsAck: boolean }
  | { kind: "shadow"; version: number }
  | { kind: "promote"; version: number; shadowed: boolean }
  | { kind: "rollback"; version: number; emergency: boolean };

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const scope = (s: string) => (s === "default" ? "Default" : s.replace(/_/g, " "));

/** Shield's weights and thresholds, changed with evidence and approval. */
export default function EnginePage() {
  const { data, error, mutate } = useEngine();
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ version: number | null; params: EngineParams; note: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  if (error) return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;
  if (!data) {
    return (
      <>
        <PageHeader title="Engine" description="Shield's signal weights and decision thresholds." />
        <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </>
    );
  }

  const pending = data.versions.filter((x) => ["draft", "proposed", "cooling", "approved", "shadow"].includes(x.status));
  const done = () => {
    setDialog(null);
    mutate();
  };

  return (
    <>
      <PageHeader
        title="Engine"
        description="Shield's signal weights and decision thresholds. Every change is backtested on real decisions, approved by a second owner, run in shadow, then promoted."
        actions={data.me.can_draft && !editing && (
          <Button icon={<Plus size={16} weight="bold" />}
            onClick={() => setEditing({ version: null, params: structuredClone(data.active.params), note: "" })}>
            New draft
          </Button>
        )}
      />

      <Header data={data} onPromote={(n) => setDialog({ kind: "promote", version: n, shadowed: true })} />

      {data.env_keys.length > 0 && (
        <Notice tone="warning">
          <span className="font-semibold">{data.env_keys.length} value{data.env_keys.length === 1 ? " is" : "s are"} set in the server environment</span>,
          which wins over any version here: {data.env_keys.map((k) => k.env).join(", ")}. Backtests, shadow and live scoring all use them.
          Move them with <span className="font-mono">scripts/import_env_engine.py</span>.
        </Notice>
      )}

      {editing && (
        <Editor data={data} editing={editing} onChange={setEditing} onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            setSelected(n);
            mutate();
          }} />
      )}

      {pending.length > 0 && (
        <Card padded={false}>
          <p className="border-b border-d-border px-5 py-3 text-[13px] font-semibold text-d-text">
            In progress <span className="ml-1 text-d-faint">{pending.length}</span>
          </p>
          <ul className="divide-y divide-d-border">
            {pending.map((ver) => (
              <PendingRow key={ver.version} ver={ver} data={data} selected={selected === ver.version}
                onSelect={() => setSelected(selected === ver.version ? null : ver.version)}
                onEdit={() => setEditing({ version: ver.version, params: structuredClone(ver.params), note: ver.note ?? "" })}
                onDialog={setDialog} onChanged={() => mutate()} />
            ))}
          </ul>
        </Card>
      )}

      {selected && <VersionPanel key={selected} version={selected} data={data} onChanged={() => mutate()} onDialog={setDialog} />}

      <History data={data} onSelect={setSelected} onRollback={(n) =>
        setDialog({ kind: "rollback", version: n, emergency: n === data.previous_live })} />

      {dialog && <Dialogs dialog={dialog} data={data} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ data, onPromote }: { data: EngineOverview; onPromote: (n: number) => void }) {
  const shadow = data.shadow;
  const { data: diff } = useShadowDiff(Boolean(shadow));
  const waiting = data.versions.filter((x) => x.status === "proposed" || x.status === "cooling").length;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <p className="text-[12px] font-semibold text-d-muted">Live</p>
        <p className="mt-1 text-[22px] font-bold text-d-text">v{data.active.version}</p>
        <p className="mt-0.5 text-[12px] text-d-muted" title={fullDate(data.active.activated_at)}>
          Since {ago(data.active.activated_at)}{data.active.activated_by ? ` · ${data.active.activated_by}` : ""}
        </p>
      </Card>
      <Card>
        <p className="text-[12px] font-semibold text-d-muted">Shadow</p>
        {shadow ? (
          <>
            <p className="mt-1 text-[22px] font-bold text-d-text">
              v{shadow.version} <span className="text-[14px] font-semibold text-d-muted">· {(diff ?? shadow.diff)?.disagreements ?? 0} disagreements</span>
            </p>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <p className="text-[12px] text-d-muted">
                {(diff ?? shadow.diff)?.scored ?? 0} scored · until {fullDate(shadow.shadow_until)}
              </p>
              {data.me.can_decide && <Button size="sm" icon={<Rocket size={14} />} onClick={() => onPromote(shadow.version)}>Promote</Button>}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-d-muted">Nothing running. An approved version runs here before it goes live.</p>
        )}
      </Card>
      <Card>
        <p className="text-[12px] font-semibold text-d-muted">Waiting</p>
        <p className="mt-1 text-[22px] font-bold text-d-text">{waiting}</p>
        <p className="mt-0.5 text-[12px] text-d-muted">
          {data.owners < 2 ? "One owner: proposals wait a 12-hour cooling-off." : `${data.owners} owners: a second owner approves.`}
        </p>
      </Card>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

function Editor({ data, editing, onChange, onClose, onSaved }: {
  data: EngineOverview;
  editing: { version: number | null; params: EngineParams; note: string };
  onChange: (e: { version: number | null; params: EngineParams; note: string }) => void;
  onClose: () => void;
  onSaved: (version: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const base = data.active.params;
  const env = useMemo(() => new Set(data.env_keys.map((k) => k.path)), [data.env_keys]);
  const b = data.bounds;
  const p = editing.params;

  const setWeight = (key: string, value: number) =>
    onChange({ ...editing, params: { ...p, weights: { ...p.weights, [key]: value } } });
  const setThreshold = (s: string, kind: "block" | "flag", value: number) =>
    onChange({ ...editing, params: { ...p, thresholds: { ...p.thresholds, [s]: { ...p.thresholds[s], [kind]: value } } } });

  const changed = Object.keys(p.weights).filter((k) => Math.abs(p.weights[k] - base.weights[k]) > 1e-9).length
    + Object.keys(p.thresholds).reduce((n, s) => n + (["block", "flag"] as const)
      .filter((k) => Math.abs(p.thresholds[s][k] - base.thresholds[s][k]) > 1e-9).length, 0);

  async function save() {
    setBusy(true);
    setErrors([]);
    try {
      const r = editing.version
        ? await updateEngineDraft(editing.version, p, editing.note)
        : await createEngineDraft(p, editing.note);
      toast.success(`Draft v${r.version} saved. Run a backtest next.`);
      onSaved(r.version);
    } catch (e) {
      const detail = (e as { detail?: { errors?: string[] } }).detail;
      setErrors(detail?.errors ?? [e instanceof Error ? e.message : "Could not save."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-2 border-b border-d-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14px] font-semibold text-d-text">{editing.version ? `Edit draft v${editing.version}` : "New draft"} from v{data.active.version}</p>
          <p className="text-[12px] text-d-muted">
            Weights {b.weight_max ? `0 to ${b.weight_max}` : ""}, flag at least {b.min_gap} below block, at most {b.max_step} per value per version.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" icon={<FloppyDisk size={14} />} loading={busy} disabled={changed === 0} onClick={save}>
            Save draft{changed ? ` (${changed} change${changed === 1 ? "" : "s"})` : ""}
          </Button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="px-5 pt-4">
          <Notice tone="danger">{errors.map((e) => <p key={e}>{e}</p>)}</Notice>
        </div>
      )}
      <div className="grid gap-x-8 gap-y-5 p-5 lg:grid-cols-2">
        {data.catalogue.groups.map((g) => (
          <div key={g.group}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{g.group}</p>
            <ul className="flex flex-col gap-1.5">
              {g.weights.map((w) => (
                <NumberRow key={w.key} label={w.label} name={w.env} value={p.weights[w.key]} before={base.weights[w.key]}
                  min={b.floors[w.key] ?? 0} max={b.weight_max} env={env.has(`weights.${w.key}`)}
                  onChange={(n) => setWeight(w.key, n)} />
              ))}
            </ul>
          </div>
        ))}
        <div className="lg:col-span-2">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">Thresholds by channel</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-d-faint">
                  <th className="py-1 font-semibold">Channel</th>
                  <th className="py-1 font-semibold">Flag at</th>
                  <th className="py-1 font-semibold">Block at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-d-border">
                {data.catalogue.channels.map((s) => (
                  <tr key={s}>
                    <td className="py-1.5 capitalize text-d-text">{scope(s)}</td>
                    {(["flag", "block"] as const).map((k) => (
                      <td key={k} className="py-1.5 pr-3">
                        <NumberCell value={p.thresholds[s][k]} before={base.thresholds[s][k]} min={b.threshold_min} max={b.threshold_max}
                          env={env.has(`thresholds.${s}.${k}`)} label={`${scope(s)} ${k}`} onChange={(n) => setThreshold(s, k, n)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lg:col-span-2">
          <Field label="What this change is for (recorded with the version)">
            <TextInput value={editing.note} maxLength={500} onChange={(e) => onChange({ ...editing, note: e.target.value })}
              placeholder="e.g. New-payee scams up 40% this quarter; raise the new-recipient weight" />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function NumberRow({ label, name, value, before, min, max, env, onChange }: {
  label: string; name: string; value: number; before: number; min: number; max: number; env: boolean; onChange: (n: number) => void;
}) {
  const moved = Math.abs(value - before) > 1e-9;
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] items-center gap-3 rounded-lg px-2 py-1 ${moved ? "bg-brand/8" : ""}`}>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-d-text">{label}</p>
        <p className="truncate font-mono text-[10px] text-d-faint">
          {name}{moved && <span className="text-brand"> · was {before}</span>}
          {env && <span className="text-amber-600 dark:text-amber-400"> · set in .env</span>}
        </p>
      </div>
      <input type="range" min={min} max={max} step={0.01} value={value} disabled={env} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--brand-primary)]" />
      <NumberCell value={value} before={before} min={min} max={max} env={env} label={label} onChange={onChange} />
    </li>
  );
}

function NumberCell({ value, before, min, max, env, label, onChange }: {
  value: number; before: number; min: number; max: number; env: boolean; label: string; onChange: (n: number) => void;
}) {
  // What the operator is typing, kept only while the field has focus, so the
  // slider and the field never disagree.
  const [text, setText] = useState<string | null>(null);
  const moved = Math.abs(value - before) > 1e-9;
  return (
    <input value={text ?? String(value)} inputMode="decimal" onBlur={() => setText(null)} disabled={env} aria-label={label} title={env ? "Set in the server environment" : `${min} to ${max}`}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(Math.round(n * 1000) / 1000);
      }}
      className={`${inputClass} !h-8 !px-2 text-right font-mono text-[12px] ${moved ? "!border-brand/60" : ""}`} />
  );
}

// ── In progress ──────────────────────────────────────────────────────────────

function PendingRow({ ver, data, selected, onSelect, onEdit, onDialog, onChanged }: {
  ver: EngineVersion; data: EngineOverview; selected: boolean; onSelect: () => void; onEdit: () => void;
  onDialog: (d: Dialog) => void; onChanged: () => void;
}) {
  const me = data.me;
  const mine = ver.proposed_by === me.email;
  const s = ver.backtest_summary;

  async function reject() {
    try {
      const r = await rejectEngine(ver.version);
      toast.success(STATUS[r.status].label);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not do that.");
    }
  }

  async function stopShadow() {
    try {
      await stopShadowEngine(ver.version);
      toast.success("Shadow stopped");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop shadow.");
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center">
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-d-text">
          <span className="font-semibold">v{ver.version}</span>
          <Badge tone={STATUS[ver.status].tone}>{STATUS[ver.status].label}</Badge>
          {ver.rollback_of && <Badge tone="warning">Rollback to v{ver.rollback_of}</Badge>}
          <span className="truncate text-d-muted">{ver.note}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-d-muted">
          {ver.status === "draft" && (s ? `Backtest: ${s.changed} of ${s.replayed} decisions change${s.fresh ? "" : " (out of date)"}` : "No backtest yet")}
          {ver.status === "proposed" && `${ver.proposed_by} · expires ${fullDate(ver.expires_at)}`}
          {ver.status === "cooling" && `${ver.proposed_by} · approved ${fullDate(ver.apply_after)} unless cancelled`}
          {ver.status === "approved" && `Approved by ${ver.approved_by} · ready for shadow`}
          {ver.status === "shadow" && `In shadow until ${fullDate(ver.shadow_until)}`}
          {" · "}<span className="text-brand">{selected ? "Hide details" : "Details"}</span>
        </p>
      </button>
      <div className="flex flex-wrap gap-2">
        {ver.status === "draft" && me.can_draft && <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>}
        {ver.status === "draft" && me.can_decide && (
          <Button size="sm" disabled={!s?.fresh} title={s?.fresh ? undefined : "Run a backtest first"}
            onClick={() => onDialog({ kind: "propose", version: ver.version, needsAck: (s?.warnings ?? 0) > 0, drift: [] })}>
            Propose
          </Button>
        )}
        {ver.status === "proposed" && me.can_decide && !mine && (
          <Button size="sm" onClick={() => onDialog({ kind: "approve", version: ver.version, needsAck: (s?.warnings ?? 0) > 0 })}>Approve</Button>
        )}
        {ver.status === "approved" && me.can_decide && (
          <>
            <Button size="sm" icon={<Eye size={14} />} onClick={() => onDialog({ kind: "shadow", version: ver.version })}>Run in shadow</Button>
            <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: "promote", version: ver.version, shadowed: false })}>
              Promote without shadow
            </Button>
          </>
        )}
        {ver.status === "shadow" && me.can_decide && (
          <>
            <Button size="sm" icon={<Rocket size={14} />} onClick={() => onDialog({ kind: "promote", version: ver.version, shadowed: true })}>Promote</Button>
            <Button size="sm" variant="secondary" onClick={stopShadow}>Stop shadow</Button>
          </>
        )}
        {(ver.status === "draft" ? me.can_draft : me.can_decide && ver.status !== "shadow") && (
          <Button size="sm" variant="ghost" onClick={reject}>
            {ver.status === "draft" ? "Discard" : mine ? "Cancel" : "Reject"}
          </Button>
        )}
      </div>
    </li>
  );
}

// ── One version: changes and backtest ───────────────────────────────────────

function VersionPanel({ version, data, onChanged, onDialog }: {
  version: number; data: EngineOverview; onChanged: () => void; onDialog: (d: Dialog) => void;
}) {
  const { data: detail, mutate } = useEngineVersion(version);
  const [days, setDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BacktestReport | null>(null);

  if (!detail) return <Skeleton className="h-64" />;
  const shown = report ?? detail.backtest ?? null;
  const canRun = data.me.can_draft && ["draft", "proposed", "cooling", "approved", "shadow"].includes(detail.status);

  async function run() {
    setRunning(true);
    try {
      const r = await backtestEngine(version, days);
      setReport(r);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The backtest failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-2 border-b border-d-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-d-text">v{detail.version} against live v{data.active.version}</p>
          <p className="truncate font-mono text-[11px] text-d-faint" title="SHA-256 of the parameters">{detail.params_hash}</p>
        </div>
        {canRun && (
          <div className="flex gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Backtest window"
              className={`${inputClass} !h-9 w-32 text-[12px]`}>
              {data.bounds.windows.map((w) => <option key={w} value={w}>Last {w} days</option>)}
            </select>
            <Button size="sm" icon={<ChartBar size={14} />} loading={running} onClick={run}>Run backtest</Button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-5 p-5">
        {detail.changes.length === 0 ? (
          <p className="text-[13px] text-d-muted">Same parameters as the live version.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.changes.map((c) => (
              <span key={c.path} className="rounded-lg border border-d-border px-2.5 py-1 text-[12px] text-d-text">
                {c.label}: <span className="text-d-muted line-through">{c.from}</span> <span className="font-semibold text-brand">{c.to}</span>
              </span>
            ))}
          </div>
        )}
        {detail.errors.length > 0 && <Notice tone="danger">{detail.errors.map((e) => <p key={e}>{e}</p>)}</Notice>}
        {detail.drift.length > 0 && detail.status === "draft" && (
          <Notice tone="warning">
            {detail.drift.join("; ")}. Proposing this needs a written reason.
            {data.me.can_decide && (
              <Button size="sm" variant="secondary" className="ml-2"
                onClick={() => onDialog({ kind: "propose", version, needsAck: Boolean(detail.backtest?.needs_ack), drift: detail.drift })}>
                Propose with a reason
              </Button>
            )}
          </Notice>
        )}
        {shown ? <BacktestView report={shown} stale={!report && !detail.backtest_summary?.fresh && detail.status === "draft"} /> : (
          <p className="text-[13px] text-d-muted">No backtest yet. A version can only be proposed with one less than {data.bounds.backtest_max_age_hours} hours old.</p>
        )}
      </div>
    </Card>
  );
}

function Matrix({ matrix }: { matrix: DecisionMatrix }) {
  const tone: Record<DecisionAction, string> = { PASS: "text-emerald-600 dark:text-emerald-400", FLAG: "text-amber-600 dark:text-amber-400", BLOCK: "text-red-600 dark:text-red-400" };
  return (
    <table className="text-[13px]">
      <thead>
        <tr className="text-[11px] text-d-faint">
          <th className="pb-1 pr-3 text-left font-semibold">Now ↓ / Draft →</th>
          {ACTIONS.map((a) => <th key={a} className={`pb-1 pr-3 text-right font-semibold ${tone[a]}`}>{a}</th>)}
        </tr>
      </thead>
      <tbody>
        {ACTIONS.map((b) => (
          <tr key={b}>
            <td className={`py-1 pr-3 text-[11px] font-semibold ${tone[b]}`}>{b}</td>
            {ACTIONS.map((a) => (
              <td key={a} className={`py-1 pr-3 text-right tabular-nums ${a === b ? "text-d-muted" : matrix[b][a] ? "font-semibold text-d-text" : "text-d-faint"}`}>
                {matrix[b][a].toLocaleString()}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, before, after, n, low, worseIfUp }: {
  label: string; before: number; after: number; n: number; low: boolean; worseIfUp: boolean;
}) {
  const worse = worseIfUp ? after > before : after < before;
  const better = worseIfUp ? after < before : after > before;
  return (
    <div className="rounded-xl border border-d-border p-3">
      <p className="text-[12px] text-d-muted">{label}</p>
      <p className="mt-1 text-[18px] font-bold tabular-nums text-d-text">
        {before} <span className="text-d-faint">→</span>{" "}
        <span className={worse ? "text-red-600 dark:text-red-400" : better ? "text-emerald-600 dark:text-emerald-400" : ""}>{after}</span>
      </p>
      <p className={`mt-0.5 text-[11px] ${low ? "text-amber-600 dark:text-amber-400" : "text-d-faint"}`}>
        {n} labelled row{n === 1 ? "" : "s"}{low ? ", too few to rely on" : ""}
      </p>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: (BacktestGroup & { name: string })[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] text-[12px]">
          <thead>
            <tr className="text-left text-d-faint">
              <th className="py-1 font-semibold">{title === "By channel" ? "Channel" : "Bank"}</th>
              <th className="py-1 text-right font-semibold">Decisions</th>
              <th className="py-1 text-right font-semibold">Changed</th>
              <th className="py-1 text-right font-semibold">Block rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-d-border">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="py-1 capitalize text-d-text">{r.name.replace(/_/g, " ")}</td>
                <td className="py-1 text-right tabular-nums text-d-muted">{r.n.toLocaleString()}</td>
                <td className={`py-1 text-right tabular-nums ${r.changed ? "font-semibold text-d-text" : "text-d-faint"}`}>{r.changed}</td>
                <td className="py-1 text-right tabular-nums text-d-muted">{pct(r.block_rate_before)} → {pct(r.block_rate_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BacktestView({ report, stale }: { report: BacktestReport; stale: boolean }) {
  const o = report.outcomes;
  const r = report.rows;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-d-muted">
        Last {report.days} days, run {ago(report.run_at)} · {r.replayed.toLocaleString()} decisions replayed ({r.exact.toLocaleString()} exact,{" "}
        {r.approximate.toLocaleString()} approximate{r.skipped ? `, ${r.skipped} skipped` : ""}) · {report.overall.changed.toLocaleString()} change
        {r.truncated && " · window truncated to the newest rows"}
      </p>
      {stale && <Notice tone="warning">This backtest is out of date. Run it again before proposing.</Notice>}
      {report.warnings.length > 0 && (
        <Notice tone="warning">
          <p className="mb-1 flex items-center gap-1.5 font-semibold"><Warning size={14} weight="fill" /> Impact warnings: the approver must confirm they reviewed these</p>
          <ul className="list-disc pl-5">{report.warnings.map((w) => <li key={w.message}>{w.message}</li>)}</ul>
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Matrix matrix={report.matrix} />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Confirmed fraud caught" before={o.fraud.caught_before ?? 0} after={o.fraud.caught_after ?? 0}
            n={o.fraud.n} low={o.fraud.low_sample} worseIfUp={false} />
          <Stat label="Confirmed fraud missed" before={o.fraud.missed_before ?? 0} after={o.fraud.missed_after ?? 0}
            n={o.fraud.n} low={o.fraud.low_sample} worseIfUp />
          <Stat label="Legitimate, blocked" before={o.legitimate.blocked_before ?? 0} after={o.legitimate.blocked_after ?? 0}
            n={o.legitimate.n} low={o.legitimate.low_sample} worseIfUp />
          <Stat label="Ghost holds the customer cancelled, caught" before={o.ghost_cancelled.caught_before ?? 0}
            after={o.ghost_cancelled.caught_after ?? 0} n={o.ghost_cancelled.n} low={o.ghost_cancelled.low_sample} worseIfUp={false} />
        </div>
      </div>
      <p className="text-[12px] text-d-muted">
        On analyst labels: recall {pct(o.metrics_before.recall)} → {pct(o.metrics_after.recall)}, precision {pct(o.metrics_before.precision)} →{" "}
        {pct(o.metrics_after.precision)}, false-positive rate {pct(o.metrics_before.false_positive_rate)} → {pct(o.metrics_after.false_positive_rate)}{" "}
        ({o.metrics_after.n} labelled{o.metrics_after.low_sample ? `, below ${report.min_sample}: treat as indicative` : ""}).{" "}
        {o.no_outcome_blocked.toLocaleString()} blocked transfers had no outcome and are not counted as caught fraud.
        Customer cancellations are a weaker signal: people cancel for other reasons too.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <GroupTable title="By channel" rows={report.by_channel.map((g) => ({ ...g, name: g.channel }))} />
        <GroupTable title="By bank" rows={report.by_bank.map((g) => ({ ...g, name: g.institution_id }))} />
      </div>
      <p className="text-[11px] text-d-faint">
        {report.policy_note}
        {report.env_keys.length > 0 && ` From the server environment: ${report.env_keys.map((k) => k.env).join(", ")}.`}
      </p>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function History({ data, onSelect, onRollback }: { data: EngineOverview; onSelect: (n: number) => void; onRollback: (n: number) => void }) {
  const live = new Set(data.activations.map((a) => a.version));
  const rows = data.versions.filter((x) => !["draft", "proposed", "cooling", "approved", "shadow"].includes(x.status));
  return (
    <Card padded={false}>
      <p className="border-b border-d-border px-5 py-3 text-[13px] font-semibold text-d-text">History</p>
      <ul className="divide-y divide-d-border">
        {rows.map((ver) => (
          <li key={ver.version} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => onSelect(ver.version)} className="min-w-0 flex-1 text-left">
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-d-text">
                <span className="font-semibold">v{ver.version}</span>
                <Badge tone={STATUS[ver.status].tone}>{STATUS[ver.status].label}</Badge>
                <span className="truncate text-d-muted">{ver.note}</span>
              </p>
              <p className="mt-0.5 text-[12px] text-d-muted">
                {ver.proposed_by ? `Proposed by ${ver.proposed_by}` : `Created by ${ver.created_by}`}
                {ver.approved_by && ` · approved by ${ver.approved_by}`}
                {ver.activated_at && ` · live ${fullDate(ver.activated_at)}`}
                {ver.retired_at && ` to ${fullDate(ver.retired_at)}`}
              </p>
            </button>
            {data.me.can_decide && ver.status === "retired" && live.has(ver.version) && (
              <Button size="sm" variant="secondary" icon={<ArrowCounterClockwise size={14} />} onClick={() => onRollback(ver.version)}>
                {ver.version === data.previous_live ? "Roll back now" : "Restore"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Step-up dialogs ──────────────────────────────────────────────────────────

function Dialogs({ dialog, data, onClose, onDone }: { dialog: Dialog; data: EngineOverview; onClose: () => void; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(data.bounds.shadow_days_default);
  const single = data.owners < 2;

  const AckBox = (
    <label className="flex items-start gap-2 text-[13px] text-d-text">
      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
      <span>I&apos;ve reviewed the impact <span className="block text-[12px] text-d-muted">The backtest raised warnings. Recorded with the approval.</span></span>
    </label>
  );

  if (dialog.kind === "propose") {
    return (
      <StepUpDialog open onClose={onClose} size="md" confirmLabel="Propose" title={`Propose v${dialog.version}`}
        ready={(!dialog.needsAck || !single || ack) && (dialog.drift.length === 0 || note.trim().length >= 10)}
        description={single ? "With one owner, it is approved after a 12-hour cooling-off period. It still needs shadow and promotion to go live."
          : "Another owner approves it. It still needs shadow and promotion to go live."}
        onConfirm={async (stepUp) => {
          await proposeEngine(dialog.version, { drift_note: note.trim() || undefined, acknowledge_impact: ack, step_up: stepUp });
          toast.success(`v${dialog.version} proposed`);
          onDone();
        }}>
        <p className="text-[13px] text-d-muted">Its parameters are frozen from now on. Any change means a new draft, backtest and approval.</p>
        {dialog.drift.length > 0 && (
          <Field label={`Why move this far in ${data.bounds.drift_days} days (required)`}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed fraud wave on this pattern" />
          </Field>
        )}
        {dialog.needsAck && single && AckBox}
      </StepUpDialog>
    );
  }
  if (dialog.kind === "approve") {
    return (
      <StepUpDialog open onClose={onClose} size="md" confirmLabel="Approve" title={`Approve v${dialog.version}`} ready={!dialog.needsAck || ack}
        description="Approving records the SHA-256 of these parameters. It does not go live until it is promoted."
        onConfirm={async (stepUp) => {
          await approveEngine(dialog.version, { acknowledge_impact: ack, step_up: stepUp });
          toast.success(`v${dialog.version} approved`);
          onDone();
        }}>
        {dialog.needsAck && AckBox}
      </StepUpDialog>
    );
  }
  if (dialog.kind === "shadow") {
    return (
      <StepUpDialog open onClose={onClose} confirmLabel="Start shadow" title={`Run v${dialog.version} in shadow`}
        description="Every new transfer is also scored by this version. Live decisions do not change."
        onConfirm={async (stepUp) => {
          await shadowEngine(dialog.version, days, stepUp);
          toast.success(`v${dialog.version} is running in shadow`);
          onDone();
        }}>
        <Field label="Days">
          <TextInput type="number" min={1} max={data.bounds.shadow_days_max} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
        </Field>
      </StepUpDialog>
    );
  }
  if (dialog.kind === "promote") {
    return (
      <StepUpDialog open onClose={onClose} confirmLabel="Promote" danger={!dialog.shadowed} title={`Promote v${dialog.version}`}
        description="Every new decision is scored by it within 30 seconds, with no restart. Every owner is emailed."
        onConfirm={async (stepUp) => {
          await promoteEngine(dialog.version, stepUp);
          toast.success(`v${dialog.version} is live`);
          onDone();
        }}>
        {!dialog.shadowed && <Notice tone="warning">This version has not run in shadow.</Notice>}
      </StepUpDialog>
    );
  }
  return (
    <StepUpDialog open onClose={onClose} confirmLabel={dialog.emergency ? "Roll back now" : "Propose restore"} danger
      title={dialog.emergency ? `Roll back to v${dialog.version}` : `Restore v${dialog.version}`} ready={reason.trim().length >= 5}
      description={dialog.emergency
        ? "v" + dialog.version + " was live just before the current version. It applies at once and every owner is alerted."
        : "Restoring an older version is a new version with the same parameters, approved by a second owner. It goes live on approval."}
      onConfirm={async (stepUp) => {
        const r = await rollbackEngine(dialog.version, reason.trim(), stepUp);
        toast.success(r.status === "active" ? `v${r.version} is live` : `Restore proposed as v${r.version}`);
        onDone();
      }}>
      <Field label="Reason (recorded and sent to every owner)">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Flag rate doubled after promotion" />
      </Field>
      <p className="flex items-center gap-1.5 text-[12px] text-d-faint"><HardDrives size={13} /> Values set in the server environment still win.</p>
    </StepUpDialog>
  );
}
