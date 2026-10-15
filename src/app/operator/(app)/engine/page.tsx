"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ChartBar,
  ClockCounterClockwise,
  Eye,
  FloppyDisk,
  HardDrives,
  Hourglass,
  Lightning,
  PencilSimple,
  Plus,
  Rocket,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  StatCard,
  StatGrid,
  TextInput,
  inputClass,
} from "@/components/dashboard/primitives";
import { BacktestView } from "@/components/operator/EngineReport";
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
  type BacktestReport,
  type EngineOverview,
  type EngineParams,
  type EngineStatus,
  type EngineVersion,
} from "@/lib/fable/operator";

const STATUS: Record<EngineStatus, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  proposed: { label: "Waiting for approval", tone: "warning" },
  cooling: { label: "Cooling-off", tone: "warning" },
  approved: { label: "Approved", tone: "brand" },
  shadow: { label: "In shadow", tone: "brand" },
  active: { label: "Live", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};
const IN_PROGRESS: EngineStatus[] = ["draft", "proposed", "cooling", "approved", "shadow"];

type Tab = "live" | "changes" | "history";
type Editing = { version: number | null; params: EngineParams; note: string };
type Dialog =
  | { kind: "propose"; version: number; needsAck: boolean; drift: string[] }
  | { kind: "approve"; version: number; needsAck: boolean }
  | { kind: "shadow"; version: number }
  | { kind: "promote"; version: number; shadowed: boolean }
  | { kind: "rollback"; version: number; emergency: boolean };

const scope = (s: string) => (s === "default" ? "Default" : s === "mobile_app" ? "Mobile app" : s === "pos" || s === "atm" || s === "qr" || s === "ussd" ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
const moved = (a: number, b: number) => Math.abs(a - b) > 1e-9;

type Group = EngineOverview["catalogue"]["groups"][number];

/** The signal groups in two columns of near-equal height. Each card is placed,
 * largest first, in the shorter column; each column then keeps the catalogue's
 * order, and its last card stretches so both columns end on the same line. */
function balance(groups: Group[]): Group[][] {
  const size = (g: Group) => g.weights.length + 1.5; // a header is about one and a half rows
  const cols: Group[][] = [[], []];
  const height = [0, 0];
  for (const g of [...groups].sort((a, b) => size(b) - size(a))) {
    const i = height[0] <= height[1] ? 0 : 1;
    cols[i].push(g);
    height[i] += size(g);
  }
  // The column holding the catalogue's first group (Amount) comes first.
  return cols.map((c) => groups.filter((g) => c.includes(g))).sort((a, b) => groups.indexOf(a[0]) - groups.indexOf(b[0]));
}

/** Shield's weights and thresholds: what is live, what is changing, and what changed. */
export default function EnginePage() {
  const { data, error, mutate } = useEngine();
  const [tab, setTab] = useState<Tab>("live");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  if (error) return <Notice tone="danger">{error.message}</Notice>;
  if (!data) {
    return (
      <>
        <PageHeader title="Engine" description="Shield's scoring weights and decision lines." />
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-[20px]" />)}</StatGrid>
        <Skeleton className="h-[480px] w-full rounded-[20px]" />
      </>
    );
  }

  const inProgress = data.versions.filter((x) => IN_PROGRESS.includes(x.status));
  const history = data.versions.filter((x) => !IN_PROGRESS.includes(x.status));
  const open = (n: number) => {
    setSelected(n);
    setTab("changes");
  };
  const done = () => {
    setDialog(null);
    mutate();
  };
  const startDraft = () => {
    setEditing({ version: null, params: structuredClone(data.active.params), note: "" });
    setTab("live");
  };

  return (
    <>
      <PageHeader
        title="Engine"
        description="Shield's scoring weights and decision lines."
        actions={data.me.can_draft && !editing && (
          <Button icon={<Plus size={16} weight="bold" />} onClick={startDraft}>New draft</Button>
        )}
      />

      <Overview data={data} onOpen={open} />

      {data.env_keys.length > 0 && (
        <Notice tone="warning">
          <span className="font-semibold">{data.env_keys.length} value{data.env_keys.length === 1 ? " is" : "s are"} set in the server environment</span> and
          win over any version here: {data.env_keys.map((k) => k.env).join(", ")}. Move them with <span className="font-mono">scripts/import_env_engine.py</span>.
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "live", label: editing ? "Editing draft" : "Live values" },
            { value: "changes", label: `In progress${inProgress.length ? ` (${inProgress.length})` : ""}` },
            { value: "history", label: "History" },
          ]}
        />
        {tab === "live" && !editing && (
          <p className="text-[12px] text-d-muted">
            v{data.active.version}, live since {fullDate(data.active.activated_at)}
          </p>
        )}
      </div>

      {tab === "live" && (editing ? (
        <DraftEditor data={data} editing={editing} onChange={setEditing} onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            mutate();
            open(n);
          }} />
      ) : (
        <LiveValues data={data} />
      ))}

      {tab === "changes" && (
        <Changes data={data} versions={inProgress} selected={selected ?? inProgress[0]?.version ?? null} onSelect={setSelected}
          onEdit={(ver) => {
            setEditing({ version: ver.version, params: structuredClone(ver.params), note: ver.note ?? "" });
            setTab("live");
          }}
          onDialog={setDialog} onChanged={() => mutate()} onNewDraft={data.me.can_draft ? startDraft : undefined} />
      )}

      {tab === "history" && (
        <History data={data} versions={history} onOpen={open}
          onRollback={(n) => setDialog({ kind: "rollback", version: n, emergency: n === data.previous_live })} />
      )}

      {dialog && <Dialogs dialog={dialog} data={data} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

// ── The four tiles ───────────────────────────────────────────────────────────

function Overview({ data, onOpen }: { data: EngineOverview; onOpen: (n: number) => void }) {
  const shadow = data.shadow;
  const { data: diff } = useShadowDiff(Boolean(shadow));
  const live = diff ?? shadow?.diff ?? null;
  const waiting = data.versions.filter((x) => x.status === "proposed" || x.status === "cooling");
  const env = data.env_keys.length;
  return (
    <StatGrid>
      <StatCard label="Live version" value={`v${data.active.version}`} featured icon={<Lightning size={17} weight="fill" />}
        sub={`Since ${ago(data.active.activated_at)}${data.active.activated_by ? ` · ${data.active.activated_by}` : ""}`} />
      <button type="button" disabled={!shadow} onClick={() => shadow && onOpen(shadow.version)} className="grid text-left disabled:cursor-default">
        <StatCard label="In shadow" value={shadow ? `v${shadow.version}` : "None"} tone="brand" icon={<Eye size={17} weight="fill" />}
          sub={shadow ? `${live?.disagreements ?? 0} of ${live?.scored ?? 0} disagree · until ${fullDate(shadow.shadow_until)}` : "Approved versions run here first"} />
      </button>
      <button type="button" disabled={!waiting.length} onClick={() => waiting[0] && onOpen(waiting[0].version)} className="grid text-left disabled:cursor-default">
        <StatCard label="Waiting for approval" value={String(waiting.length)} tone="warning" icon={<Hourglass size={17} weight="fill" />}
          sub={data.owners < 2 ? "One owner: a 12-hour cooling-off applies" : `${data.owners} owners: a second one approves`} />
      </button>
      <StatCard label="Set in the server .env" value={String(env)} tone={env ? "danger" : "success"} icon={<HardDrives size={17} weight="fill" />}
        sub={env ? "These win over the console" : "Every value is managed here"} />
    </StatGrid>
  );
}

// ── Live values (read-only) ──────────────────────────────────────────────────

function LiveValues({ data }: { data: EngineOverview }) {
  const p = data.effective.params;
  const env = useMemo(() => new Set(data.env_keys.map((k) => k.path)), [data.env_keys]);
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
        {balance(data.catalogue.groups).map((col, c) => (
          <div key={c} className="flex flex-col gap-4">
            {col.map((g, i) => (
              <Card key={g.group} className={i === col.length - 1 ? "flex-1" : ""}>
                <CardHeader title={g.group} subtitle={`${g.weights.length} signal${g.weights.length === 1 ? "" : "s"}, points added when it fires`} />
                <ul className="flex flex-col gap-3.5">
                  {g.weights.map((w) => (
                    <WeightRow key={w.key} label={w.label} name={w.env} value={p.weights[w.key]} max={data.bounds.weight_max}
                      env={env.has(`weights.${w.key}`)} floor={data.bounds.floors[w.key]} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 lg:sticky lg:top-24">
        <Thresholds data={data} params={p} env={env} />
        <DetectionCard data={data} />
        <Card>
          <CardHeader title="How a score becomes a decision" />
          <ol className="flex flex-col gap-2.5 text-[13px] text-d-muted">
            {[
              "Each signal that fires adds its points.",
              "Long, clean customer history takes a little off.",
              "The total is capped at 1. A NIBSS fraud code forces a block.",
              "The channel's lines decide: pass, flag for verification, or block.",
            ].map((s, i) => (
              <li key={s} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand/10 text-[11px] font-bold text-brand">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] text-d-faint">Each bank&apos;s own risk policy can move its lines on top of these.</p>
        </Card>
      </div>
    </div>
  );
}

/** Velocity, tenure and recipient memory: they decide whether a signal fires,
 * so they cannot be backtested and are approved on the Environment page. */
function DetectionCard({ data }: { data: EngineOverview }) {
  return (
    <Card>
      <CardHeader title="Detection rules" subtitle="When a signal fires at all. Approved on the Environment page, without a backtest"
        action={<Link href="/operator/secrets" className="text-[12px] font-semibold text-brand hover:underline">Change</Link>} />
      <dl className="flex flex-col divide-y divide-d-border text-[13px]">
        {data.detection.map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-3 py-2">
            <dt className="min-w-0">
              <span className="block truncate text-d-text">{d.label}</span>
              <span className="block truncate font-mono text-[10px] text-d-faint">
                {d.name}{d.source === "environment" && <span className="text-amber-600 dark:text-amber-400"> · set in .env</span>}
              </span>
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums text-d-text">
              {d.display} <span className="text-[11px] font-normal text-d-faint">{d.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function WeightRow({ label, name, value, max, env, floor }: {
  label: string; name: string; value: number; max: number; env: boolean; floor?: number;
}) {
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-d-text">{label}</p>
          <p className="truncate font-mono text-[10px] text-d-faint" title={name}>
            {name}{floor ? ` · min ${floor}` : ""}{env && <span className="text-amber-600 dark:text-amber-400"> · set in .env</span>}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-brand">+{fmt(value)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-d-surface-2">
        <div className="h-full rounded-full bg-brand/70 transition-all" style={{ width: `${Math.min(value / max, 1) * 100}%` }} />
      </div>
    </li>
  );
}

/** One channel's lines on a 0 to 1 strip: pass, flag, block. */
function Zones({ flag, block }: { flag: number; block: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div style={{ width: `${flag * 100}%` }} className="bg-emerald-500/70" />
      <div style={{ width: `${(block - flag) * 100}%` }} className="bg-amber-500/80" />
      <div style={{ width: `${(1 - block) * 100}%` }} className="bg-red-500/80" />
    </div>
  );
}

function Thresholds({ data, params, env, base, onChange }: {
  data: EngineOverview; params: EngineParams; env: Set<string>; base?: EngineParams;
  onChange?: (scope: string, kind: "flag" | "block", value: number) => void;
}) {
  const b = data.bounds;
  return (
    <Card>
      <CardHeader title="Decision lines by channel" subtitle="Flag for verification at the first, block at the second" />
      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-d-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />Pass</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />Flag</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />Block</span>
      </div>
      <ul className="flex flex-col divide-y divide-d-border">
        {data.catalogue.channels.map((s) => {
          const th = params.thresholds[s];
          const was = base?.thresholds[s];
          const changed = was && (moved(was.flag, th.flag) || moved(was.block, th.block));
          return (
            <li key={s} className={`py-2.5 ${changed ? "-mx-2 rounded-lg bg-brand/[0.06] px-2" : ""}`}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-d-text">{scope(s)}</span>
                {onChange ? (
                  <span className="flex items-center gap-1.5">
                    {(["flag", "block"] as const).map((k) => (
                      <NumberCell key={k} value={th[k]} before={was?.[k] ?? th[k]} min={b.threshold_min} max={b.threshold_max}
                        env={env.has(`thresholds.${s}.${k}`)} label={`${scope(s)} ${k}`} onChange={(n) => onChange(s, k, n)} className="!w-16" />
                    ))}
                  </span>
                ) : (
                  <span className="text-[12px] tabular-nums text-d-muted">
                    <span className="text-amber-600 dark:text-amber-400">{fmt(th.flag)}</span> · <span className="text-red-600 dark:text-red-400">{fmt(th.block)}</span>
                  </span>
                )}
              </div>
              <Zones flag={th.flag} block={th.block} />
              {changed && <p className="mt-1 text-[11px] text-brand">was {fmt(was!.flag)} · {fmt(was!.block)}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Draft editor ─────────────────────────────────────────────────────────────

function DraftEditor({ data, editing, onChange, onClose, onSaved }: {
  data: EngineOverview; editing: Editing; onChange: (e: Editing) => void; onClose: () => void; onSaved: (version: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const base = data.active.params;
  const env = useMemo(() => new Set(data.env_keys.map((k) => k.path)), [data.env_keys]);
  const b = data.bounds;
  const p = editing.params;

  const setWeight = (key: string, value: number) => onChange({ ...editing, params: { ...p, weights: { ...p.weights, [key]: value } } });
  const setThreshold = (s: string, kind: "block" | "flag", value: number) =>
    onChange({ ...editing, params: { ...p, thresholds: { ...p.thresholds, [s]: { ...p.thresholds[s], [kind]: value } } } });

  const labels = new Map(data.catalogue.groups.flatMap((g) => g.weights.map((w) => [w.key, w.label] as const)));
  const changes = [
    ...Object.keys(p.weights).filter((k) => moved(p.weights[k], base.weights[k]))
      .map((k) => ({ key: k, label: labels.get(k) ?? k, from: base.weights[k], to: p.weights[k] })),
    ...Object.keys(p.thresholds).flatMap((s) => (["flag", "block"] as const)
      .filter((k) => moved(p.thresholds[s][k], base.thresholds[s][k]))
      .map((k) => ({ key: `${s}.${k}`, label: `${scope(s)} ${k} line`, from: base.thresholds[s][k], to: p.thresholds[s][k] }))),
  ];

  async function save() {
    setBusy(true);
    setErrors([]);
    try {
      const r = editing.version ? await updateEngineDraft(editing.version, p, editing.note) : await createEngineDraft(p, editing.note);
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
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {balance(data.catalogue.groups).map((col, c) => (
            <div key={c} className="flex flex-col gap-4">
              {col.map((g, i) => (
                <Card key={g.group} className={i === col.length - 1 ? "flex-1" : ""}>
                  <CardHeader title={g.group} />
                  <ul className="flex flex-col gap-3">
                    {g.weights.map((w) => (
                      <EditRow key={w.key} label={w.label} name={w.env} value={p.weights[w.key]} before={base.weights[w.key]}
                        min={b.floors[w.key] ?? 0} max={b.weight_max} env={env.has(`weights.${w.key}`)} onChange={(n) => setWeight(w.key, n)} />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ))}
        </div>
        <Thresholds data={data} params={p} env={env} base={base} onChange={setThreshold} />
      </div>

      <Card className="lg:sticky lg:top-24">
        <CardHeader
          title={editing.version ? `Draft v${editing.version}` : "New draft"}
          subtitle={`From live v${data.active.version}`}
          action={<button type="button" onClick={onClose} aria-label="Close the editor" className="flex size-8 items-center justify-center rounded-lg text-d-muted hover:bg-d-surface-2 hover:text-d-text"><X size={16} /></button>}
        />
        {changes.length === 0 ? (
          <p className="rounded-xl bg-d-surface-2 px-3.5 py-3 text-[13px] text-d-muted">
            No changes yet. Saving as is gives a no-change draft, whose backtest should report 0 changed decisions.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {changes.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-3 rounded-lg bg-d-surface-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 truncate text-d-muted">{c.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-d-text">{fmt(c.from)} → <span className="text-brand">{fmt(c.to)}</span></span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Field label="What this change is for">
            <TextInput value={editing.note} maxLength={500} onChange={(e) => onChange({ ...editing, note: e.target.value })}
              placeholder="e.g. New-payee scams up 40% this quarter" />
          </Field>
        </div>
        {errors.length > 0 && <Notice tone="danger" className="mt-4">{errors.map((e) => <p key={e}>{e}</p>)}</Notice>}
        <div className="mt-4 flex flex-col gap-2">
          <Button full icon={<FloppyDisk size={16} />} loading={busy} onClick={save}>
            {changes.length ? `Save draft · ${changes.length} change${changes.length === 1 ? "" : "s"}` : "Save no-change draft"}
          </Button>
          <Button full variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        <ul className="mt-4 flex flex-col gap-1 border-t border-d-border pt-4 text-[12px] text-d-faint">
          <li>Weights from 0 to {b.weight_max}, with floors on the signals that must never be switched off.</li>
          <li>Flag at least {b.min_gap} below block on every channel.</li>
          <li>At most {b.max_step} per value in one version.</li>
          <li>Next: backtest, then propose. Nothing goes live until it is approved and promoted.</li>
        </ul>
      </Card>
    </div>
  );
}

function EditRow({ label, name, value, before, min, max, env, onChange }: {
  label: string; name: string; value: number; before: number; min: number; max: number; env: boolean; onChange: (n: number) => void;
}) {
  const changed = moved(value, before);
  return (
    <li className={`rounded-lg ${changed ? "-mx-2 bg-brand/[0.06] px-2 py-1.5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-d-text">{label}</p>
          <p className="truncate font-mono text-[10px] text-d-faint" title={name}>
            {name}{changed && <span className="text-brand"> · was {fmt(before)}</span>}
            {env && <span className="text-amber-600 dark:text-amber-400"> · set in .env</span>}
          </p>
        </div>
        <NumberCell value={value} before={before} min={min} max={max} env={env} label={label} onChange={onChange} className="!w-[4.5rem]" />
      </div>
      <input type="range" min={min} max={max} step={0.01} value={value} disabled={env} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-[var(--brand-primary)] disabled:opacity-50" />
    </li>
  );
}

function NumberCell({ value, before, min, max, env, label, onChange, className = "" }: {
  value: number; before: number; min: number; max: number; env: boolean; label: string; onChange: (n: number) => void; className?: string;
}) {
  // What the operator is typing, kept only while the field has focus, so the
  // slider and the field never disagree.
  const [text, setText] = useState<string | null>(null);
  return (
    <input value={text ?? fmt(value)} inputMode="decimal" disabled={env} aria-label={label} onBlur={() => setText(null)}
      title={env ? "Set in the server environment" : `${min} to ${max}`}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(Math.round(n * 1000) / 1000);
      }}
      className={`${inputClass} !h-8 shrink-0 !px-2 text-right font-mono text-[12px] ${moved(value, before) ? "!border-brand/60" : ""} ${className}`} />
  );
}

// ── In progress ──────────────────────────────────────────────────────────────

function Changes({ data, versions, selected, onSelect, onEdit, onDialog, onChanged, onNewDraft }: {
  data: EngineOverview; versions: EngineVersion[]; selected: number | null; onSelect: (n: number) => void;
  onEdit: (v: EngineVersion) => void; onDialog: (d: Dialog) => void; onChanged: () => void; onNewDraft?: () => void;
}) {
  if (versions.length === 0) {
    return (
      <Card>
        <EmptyState icon={<SlidersHorizontal size={22} />} title="Nothing in progress"
          body={`v${data.active.version} is live. A new draft starts from its values and is backtested before anyone can propose it.`}
          action={onNewDraft && <Button icon={<Plus size={16} weight="bold" />} onClick={onNewDraft}>New draft</Button>} />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-3">
        {versions.map((ver) => (
          <VersionCard key={ver.version} ver={ver} data={data} active={selected === ver.version}
            onSelect={() => onSelect(ver.version)} onEdit={() => onEdit(ver)} onDialog={onDialog} onChanged={onChanged} />
        ))}
      </div>
      <div className="lg:col-span-2">
        {selected ? <VersionPanel key={selected} version={selected} data={data} onChanged={onChanged} onDialog={onDialog} /> : null}
      </div>
    </div>
  );
}

function VersionCard({ ver, data, active, onSelect, onEdit, onDialog, onChanged }: {
  ver: EngineVersion; data: EngineOverview; active: boolean; onSelect: () => void; onEdit: () => void;
  onDialog: (d: Dialog) => void; onChanged: () => void;
}) {
  const me = data.me;
  const mine = ver.proposed_by === me.email;
  const s = ver.backtest_summary;

  async function act(fn: () => Promise<{ status: EngineStatus }>, ok: (status: EngineStatus) => string) {
    try {
      const r = await fn();
      toast.success(ok(r.status));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not do that.");
    }
  }

  const steps: EngineStatus[] = ["draft", "proposed", "approved", "shadow", "active"];
  const at = steps.indexOf(ver.status === "cooling" ? "proposed" : ver.status);

  return (
    <Card className={active ? "ring-2 ring-brand/40" : ""}>
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold text-d-text">v{ver.version}</span>
          <Badge tone={STATUS[ver.status].tone}>{STATUS[ver.status].label}</Badge>
        </div>
        {ver.rollback_of && <p className="mt-1 text-[12px] font-semibold text-amber-600 dark:text-amber-400">Restores v{ver.rollback_of}</p>}
        <p className="mt-1 line-clamp-2 text-[13px] text-d-muted">{ver.note || "No note"}</p>
        <div className="mt-3 flex gap-1" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((step, i) => <span key={step} className={`h-1 flex-1 rounded-full ${i <= at ? "bg-brand" : "bg-d-surface-2"}`} />)}
        </div>
        <p className="mt-2 text-[12px] text-d-faint">
          {ver.status === "draft" && (s ? `Backtest: ${s.changed} of ${s.replayed} change${s.fresh ? "" : ", out of date"}` : "No backtest yet")}
          {ver.status === "proposed" && `By ${ver.proposed_by} · expires ${fullDate(ver.expires_at)}`}
          {ver.status === "cooling" && `Approved ${fullDate(ver.apply_after)} unless cancelled`}
          {ver.status === "approved" && `Approved by ${ver.approved_by}`}
          {ver.status === "shadow" && `In shadow until ${fullDate(ver.shadow_until)}`}
        </p>
      </button>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-d-border pt-3">
        {ver.status === "draft" && me.can_draft && <Button size="sm" variant="secondary" icon={<PencilSimple size={14} />} onClick={onEdit}>Edit</Button>}
        {ver.status === "draft" && me.can_decide && (
          <Button size="sm" disabled={!s?.fresh} title={s?.fresh ? undefined : "Run a backtest first"}
            onClick={() => onDialog({ kind: "propose", version: ver.version, needsAck: (s?.warnings ?? 0) > 0, drift: [] })}>Propose</Button>
        )}
        {ver.status === "proposed" && me.can_decide && !mine && (
          <Button size="sm" onClick={() => onDialog({ kind: "approve", version: ver.version, needsAck: (s?.warnings ?? 0) > 0 })}>Approve</Button>
        )}
        {ver.status === "approved" && me.can_decide && (
          <>
            <Button size="sm" icon={<Eye size={14} />} onClick={() => onDialog({ kind: "shadow", version: ver.version })}>Run in shadow</Button>
            <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: "promote", version: ver.version, shadowed: false })}>Promote now</Button>
          </>
        )}
        {ver.status === "shadow" && me.can_decide && (
          <>
            <Button size="sm" icon={<Rocket size={14} />} onClick={() => onDialog({ kind: "promote", version: ver.version, shadowed: true })}>Promote</Button>
            <Button size="sm" variant="secondary" onClick={() => act(() => stopShadowEngine(ver.version), () => "Shadow stopped")}>Stop shadow</Button>
          </>
        )}
        {(ver.status === "draft" ? me.can_draft : me.can_decide && ver.status !== "shadow") && (
          <Button size="sm" variant="ghost" onClick={() => act(() => rejectEngine(ver.version), (st) => STATUS[st].label)}>
            {ver.status === "draft" ? "Discard" : mine ? "Cancel" : "Reject"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function VersionPanel({ version, data, onChanged, onDialog }: {
  version: number; data: EngineOverview; onChanged: () => void; onDialog: (d: Dialog) => void;
}) {
  const { data: detail, mutate } = useEngineVersion(version);
  const [days, setDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BacktestReport | null>(null);

  if (!detail) return <Skeleton className="h-96 w-full rounded-[20px]" />;
  const shown = report ?? detail.backtest ?? null;
  const canRun = data.me.can_draft && IN_PROGRESS.includes(detail.status);

  async function run() {
    setRunning(true);
    try {
      setReport(await backtestEngine(version, days));
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The backtest failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={`What v${detail.version} changes`}
          subtitle={`Against live v${data.active.version}`}
          action={canRun && (
            <div className="flex flex-wrap items-center gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Backtest window" className={`${inputClass} !h-9 !w-auto text-[12px]`}>
                {data.bounds.windows.map((w) => <option key={w} value={w}>Last {w} days</option>)}
              </select>
              <Button size="sm" icon={<ChartBar size={14} />} loading={running} onClick={run}>Run backtest</Button>
            </div>
          )}
        />
        {detail.changes.length === 0 ? (
          <p className="text-[13px] text-d-muted">The same values as the live version.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.changes.map((c) => (
              <span key={c.path} className="rounded-lg bg-d-surface-2 px-2.5 py-1.5 text-[12px] text-d-text">
                {c.label}: <span className="text-d-faint line-through">{fmt(c.from)}</span> <span className="font-semibold text-brand">{fmt(c.to)}</span>
              </span>
            ))}
          </div>
        )}
        {detail.errors.length > 0 && <Notice tone="danger" className="mt-3">{detail.errors.map((e) => <p key={e}>{e}</p>)}</Notice>}
        {detail.drift.length > 0 && detail.status === "draft" && (
          <Notice tone="warning" className="mt-3">
            {detail.drift.join("; ")}. Proposing this needs a written reason.
            {data.me.can_decide && (
              <Button size="sm" variant="secondary" className="ml-2"
                onClick={() => onDialog({ kind: "propose", version, needsAck: Boolean(detail.backtest?.needs_ack), drift: detail.drift })}>
                Propose with a reason
              </Button>
            )}
          </Notice>
        )}
        <p className="mt-3 truncate font-mono text-[11px] text-d-faint" title="SHA-256 of the parameters">{detail.params_hash}</p>
      </Card>

      {shown ? (
        <BacktestView report={shown} stale={!report && !detail.backtest_summary?.fresh && detail.status === "draft"} />
      ) : (
        <Card>
          <EmptyState icon={<ChartBar size={22} />} title="No backtest yet"
            body={`Replay real past decisions under these values. A version can only be proposed with a backtest less than ${data.bounds.backtest_max_age_hours} hours old.`} />
        </Card>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function History({ data, versions, onOpen, onRollback }: {
  data: EngineOverview; versions: EngineVersion[]; onOpen: (n: number) => void; onRollback: (n: number) => void;
}) {
  const wasLive = new Set(data.activations.map((a) => a.version));
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Versions" subtitle="Every version, who approved it and when it was live" />
      </div>
      <ul className="divide-y divide-d-border">
        {versions.map((ver) => (
          <li key={ver.version} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold ${ver.status === "active" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-d-surface-2 text-d-muted"}`}>
              v{ver.version}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-d-text">
                <Badge tone={STATUS[ver.status].tone}>{STATUS[ver.status].label}</Badge>
                <span className="min-w-0 truncate">{ver.note || "No note"}</span>
              </p>
              <p className="mt-1 text-[12px] text-d-muted">
                {ver.proposed_by ? `Proposed by ${ver.proposed_by}` : `Created by ${ver.created_by}`}
                {ver.approved_by && ` · approved by ${ver.approved_by}`}
                {ver.activated_at && ` · live from ${fullDate(ver.activated_at)}`}
                {ver.retired_at && ` to ${fullDate(ver.retired_at)}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {ver.status !== "active" && <Button size="sm" variant="ghost" onClick={() => onOpen(ver.version)}>Details</Button>}
              {data.me.can_decide && ver.status === "retired" && wasLive.has(ver.version) && (
                <Button size="sm" variant="secondary" icon={ver.version === data.previous_live ? <ArrowCounterClockwise size={14} /> : <ClockCounterClockwise size={14} />}
                  onClick={() => onRollback(ver.version)}>
                  {ver.version === data.previous_live ? "Roll back now" : "Restore"}
                </Button>
              )}
            </div>
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
        <p className="text-[13px] text-d-muted">Its values are frozen from now on. Any change means a new draft, backtest and approval.</p>
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
        description="Approving records the SHA-256 of these values. It does not go live until it is promoted."
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
        ? `v${dialog.version} was live just before the current version. It applies at once and every owner is alerted.`
        : "Restoring an older version is a new version with the same values, approved by a second owner. It goes live on approval."}
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
