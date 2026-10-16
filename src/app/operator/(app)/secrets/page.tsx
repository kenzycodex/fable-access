"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Cube,
  DotsThree,
  FileArrowUp,
  HardDrives,
  Key,
  LockKey,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  Trash,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Dialog } from "@/components/dashboard/Dialog";
import { Badge, Button, Card, Field, Notice, PageHeader, Skeleton, TextInput, inputClass } from "@/components/dashboard/primitives";
import { StepUpDialog } from "@/components/operator/StepUpDialog";
import { ago, fullDate, isPast, withinDays } from "@/components/operator/ui";
import {
  approveSecretChange,
  can,
  proposeSecrets,
  rejectSecretChange,
  removeSecret,
  rollbackSecret,
  sendTestMessage,
  testSecret,
  useOperatorSession,
  useSecrets,
  type SecretChange,
  type SecretItem,
} from "@/lib/fable/operator";

type TypeFilter = "all" | "secret" | "config";
type Source = "all" | SecretItem["source"];

type Action =
  | { kind: "edit"; rows: Row[]; rotation: boolean }
  | { kind: "rollback"; item: SecretItem; version: number }
  | { kind: "remove"; item: SecretItem }
  | { kind: "approve"; change: SecretChange }
  | { kind: "history"; item: SecretItem };

interface Row {
  name: string;
  value: string;
  note: string;
}

const typeOf = (i: SecretItem): "secret" | "config" => (i.kind === "secret" ? "secret" : "config");

/** Environment variables: the secrets and settings the API reads, changed with approval. */
export default function EnvironmentPage() {
  const session = useOperatorSession();
  const { data, error, mutate } = useSecrets();
  const owner = can(session?.role, "platform_owner");
  const admin = can(session?.role, "platform_admin");
  const [action, setAction] = useState<Action | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [source, setSource] = useState<Source>("all");

  const items = useMemo(() => data?.items ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (type === "all" || typeOf(i) === type) && (source === "all" || i.source === source)
      && (!needle || i.name.toLowerCase().includes(needle) || i.label.toLowerCase().includes(needle)));
  }, [items, q, type, source]);
  const writable = Boolean(data?.write_enabled && data?.master_key);
  const editable = items.filter((i) => i.source !== "environment");

  if (error) return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;

  return (
    <>
      <PageHeader
        title="Environment variables"
        description="Secrets and settings the API reads. Secrets are write-only; every change is approved and recorded."
        actions={owner && (
          <Button icon={<Plus size={16} weight="bold" />} disabled={!writable || editable.length === 0}
            onClick={() => setAction({ kind: "edit", rows: [{ name: "", value: "", note: "" }], rotation: false })}>
            Add variable
          </Button>
        )}
      />

      {data && !data.master_key && (
        <Notice tone="warning">FABLE_SECRETS_KEY is not set on the server, so variables can only come from its environment.</Notice>
      )}
      {data?.me.locked_until && (
        <Notice tone="danger">Your changes are locked after repeated failed verifications, until {fullDate(data.me.locked_until)}.</Notice>
      )}

      {!!data?.pending.length && (
        <Card padded={false}>
          <p className="border-b border-d-border px-5 py-3 text-[13px] font-semibold text-d-text">
            Waiting for approval <span className="ml-1 text-d-faint">{data.pending.length}</span>
          </p>
          <ul className="divide-y divide-d-border">
            {data.pending.map((c) => (
              <PendingRow key={c.id} c={c} me={session?.email} owner={owner}
                onApprove={() => setAction({ kind: "approve", change: c })}
                onReject={async () => {
                  try {
                    const r = await rejectSecretChange(c.id);
                    toast.success(r.status === "cancelled" ? "Cancelled" : "Rejected");
                    mutate();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not reject.");
                  }
                }} />
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-d-border p-3 md:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variables..." aria-label="Search variables"
              className={`${inputClass} !h-10 pl-10 text-[13px]`} />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)} aria-label="Type" className={`${inputClass} !h-10 text-[13px] md:w-40`}>
            <option value="all">All types</option>
            <option value="secret">Secrets</option>
            <option value="config">Config</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Source" className={`${inputClass} !h-10 text-[13px] md:w-48`}>
            <option value="all">All sources</option>
            <option value="console">Managed here</option>
            <option value="environment">Server environment</option>
            <option value="unset">Not set</option>
          </select>
        </div>
        {!data ? (
          <div className="flex flex-col gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-d-muted">No variable matches.</p>
        ) : (
          <ul className="divide-y divide-d-border">
            {rows.map((item) => (
              <VariableRow key={item.name} item={item} owner={owner} admin={admin} writable={writable} onAction={setAction} />
            ))}
          </ul>
        )}
      </Card>

      {admin && <DeliveryCheck />}

      <ActionDialog action={action} items={items} single={(data?.owners ?? 0) < 2}
        onClose={() => setAction(null)} onDone={() => mutate()} onAction={setAction} owner={owner} writable={writable} />
    </>
  );
}

function shown(item: SecretItem): React.ReactNode {
  if (item.kind === "secret") {
    return item.display ? <><span className="tracking-widest">••••••••</span> {item.display}</> : <span className="text-d-faint">—</span>;
  }
  const v = item.display ?? item.default;
  if (!v) return <span className="text-d-faint">—</span>;
  if (item.unit === "₦") return <>₦{v}</>;
  return <>{v}{item.unit && item.value_type !== "bool" ? <span className="text-d-faint"> {item.unit}</span> : null}</>;
}

function SourceText({ item }: { item: SecretItem }) {
  if (item.source === "environment") return <span className="inline-flex items-center gap-1.5"><HardDrives size={13} />Server environment</span>;
  if (item.source === "console") return <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><LockKey size={13} weight="fill" />Managed here</span>;
  if (item.kind !== "secret") return <span className="inline-flex items-center gap-1.5"><Cube size={13} />Default</span>;
  return <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400"><Warning size={13} />Not set</span>;
}

function VariableRow({ item, owner, admin, writable, onAction }: {
  item: SecretItem; owner: boolean; admin: boolean; writable: boolean; onAction: (a: Action) => void;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const env = item.source === "environment";

  async function test() {
    setResult(null);
    try {
      setResult(await testSecret(item.name));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Could not test." });
    }
  }

  const menu = [
    { label: item.kind === "secret" ? (item.source === "unset" ? "Add value" : "Rotate") : "Edit", icon: <ArrowCounterClockwise size={15} />,
      onClick: () => onAction({ kind: "edit", rows: [{ name: item.name, value: "", note: item.note ?? "" }], rotation: item.kind === "secret" && item.source !== "unset" }),
      show: owner && !env && writable },
    { label: "Test connection", icon: <CheckCircle size={15} />, onClick: test, show: admin && item.kind === "secret" && item.source !== "unset" },
    { label: "History", icon: <ClockCounterClockwise size={15} />, onClick: () => onAction({ kind: "history", item }), show: item.versions.length > 0 },
    { label: "Remove", icon: <Trash size={15} />, onClick: () => onAction({ kind: "remove", item }), danger: true,
      show: owner && item.source === "console" && writable },
  ].filter((m) => m.show);

  const Icon = item.kind === "secret" ? Key : item.kind === "model" ? Cube : SlidersHorizontal;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg border border-d-border ${item.kind === "secret" ? "text-brand" : "text-d-muted"}`}>
          <Icon size={16} />
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-6 gap-y-0.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_8rem]">
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-d-text">{item.name}</p>
            <p className="truncate text-[12px] text-d-muted" title={item.help ?? undefined}>{item.note || item.label}</p>
          </div>
          <p className="truncate font-mono text-[12px] text-d-muted">{shown(item)}</p>
          <p className="text-[12px] text-d-muted"><SourceText item={item} /></p>
          <p className="hidden whitespace-nowrap text-right text-[12px] text-d-faint md:block" title={fullDate(item.active?.created_at)}>
            {isPast(item.rotation_due) ? <Badge tone="danger">Rotate due</Badge> : item.active ? `Updated ${ago(item.active.created_at)}` : ""}
          </p>
        </div>
        <RowMenu items={menu} />
      </div>
      {result && (
        <p className={`mt-2 flex items-center gap-1.5 pl-12 text-[12px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {result.ok ? <CheckCircle size={13} weight="fill" /> : <XCircle size={13} weight="fill" />} {result.message}
        </p>
      )}
    </li>
  );
}

function RowMenu({ items }: { items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (items.length === 0) return <span className="size-9 shrink-0" />;
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Actions"
        className="flex size-9 items-center justify-center rounded-lg text-d-muted transition-colors hover:bg-d-surface-2 hover:text-d-text">
        <DotsThree size={20} weight="bold" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-d-border bg-d-surface py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)]">
          {items.map((m) => (
            <button key={m.label} type="button" role="menuitem" onClick={() => { setOpen(false); m.onClick(); }}
              className={`flex h-10 w-full items-center gap-2.5 px-3.5 text-left text-[13px] font-medium transition-colors hover:bg-d-surface-2 ${
                m.danger ? "text-red-600 dark:text-red-400" : "text-d-text"
              }`}>
              <span className={m.danger ? "" : "text-d-muted"}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingRow({ c, me, owner, onApprove, onReject }: {
  c: SecretChange; me?: string; owner: boolean; onApprove: () => void; onReject: () => void;
}) {
  const mine = c.proposed_by === me;
  const when = c.status === "cooling" ? c.apply_after : c.expires_at;
  const verb = c.action === "set" ? "set" : c.action === "rollback" ? `restore v${c.target_version} of` : "remove";
  return (
    <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-d-text">
          <span className="font-semibold">{c.proposed_by}</span> wants to {verb} <span className="font-mono">{c.name}</span>
          {c.last4 && <span className="font-mono text-d-muted"> {c.last4}</span>}
          {c.rotation_reason === "compromised" && <> <Badge tone="danger">Compromised</Badge></>}
        </p>
        <p className="mt-0.5 text-[12px] text-d-muted">
          {c.reason} · {c.status === "cooling" ? `Applies ${fullDate(when)} unless cancelled` : `Expires ${fullDate(when)}`}
        </p>
      </div>
      {owner && (
        <div className="flex gap-2">
          {c.status === "pending" && !mine && <Button size="sm" onClick={onApprove}>Approve</Button>}
          <Button size="sm" variant="secondary" onClick={onReject}>{mine ? "Cancel" : "Reject"}</Button>
        </div>
      )}
    </li>
  );
}

/** Parse pasted .env text into rows for the variables managed here. */
function parseEnv(text: string, names: Set<string>): { rows: Row[]; skipped: string[] } {
  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (names.has(m[1])) rows.push({ name: m[1], value, note: "" });
    else skipped.push(m[1]);
  }
  return { rows, skipped };
}

function ValueInput({ item, value, onChange }: { item: SecretItem | undefined; value: string; onChange: (v: string) => void }) {
  if (!item) return <input disabled className={inputClass} placeholder="Choose a key first" />;
  if (item.kind === "model") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="" disabled>Choose a model</option>
        {(item.allowed_models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    );
  }
  if (item.value_type === "bool") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="" disabled>Choose</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  }
  if (item.choices?.length) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="" disabled>Choose</option>
        {item.choices.map((c) => <option key={c} value={String(c)}>{c} {item.unit}</option>)}
      </select>
    );
  }
  if (item.kind === "config") {
    return (
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} font-mono`}
        min={item.minimum ?? undefined} max={item.maximum ?? undefined}
        placeholder={`${item.display ?? item.default ?? ""}${item.unit ? ` ${item.unit}` : ""}`} />
    );
  }
  return (
    <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false}
      className={`${inputClass} font-mono`} placeholder="Paste the value" />
  );
}

function EditorDialog({ initial, rotation, items, single, onClose, onDone }: {
  initial: Row[]; rotation: boolean; items: SecretItem[]; single: boolean; onClose: () => void; onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [reason, setReason] = useState("");
  const [compromised, setCompromised] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const editable = items.filter((i) => i.source !== "environment");
  const byName = new Map(items.map((i) => [i.name, i]));
  const ready = rows.length > 0 && rows.every((r) => r.name && r.value.trim()) && reason.trim().length >= 5;

  const set = (n: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, i) => (i === n ? { ...r, ...patch } : r)));

  function importEnv() {
    const { rows: found, skipped } = parseEnv(pasted, new Set(editable.map((i) => i.name)));
    if (!found.length) {
      toast.error("None of those variables are managed here.");
      return;
    }
    setRows((rs) => [...rs.filter((r) => r.name || r.value), ...found.filter((f) => !rs.some((r) => r.name === f.name))]);
    setPasting(false);
    setPasted("");
    toast.success(`${found.length} variable${found.length === 1 ? "" : "s"} added${skipped.length ? `, ${skipped.length} skipped (managed in .env only)` : ""}`);
  }

  return (
    <StepUpDialog open onClose={onClose} size="md" confirmLabel="Propose" ready={ready}
      title={rotation ? `Rotate ${rows[0]?.name}` : initial[0]?.name ? `Edit ${initial[0].name}` : "Add environment variables"}
      description={single ? "With one owner, changes apply after a 12-hour cooling-off period." : "Another owner approves before anything changes."}
      onConfirm={async (stepUp) => {
        const r = await proposeSecrets({
          items: rows.map((row) => ({ name: row.name, value: row.value.trim(), note: row.note.trim() || undefined,
            rotation: compromised ? "compromised" : "routine" })),
          reason: reason.trim(),
          step_up: stepUp,
        });
        toast.success(`${r.changes.length} change${r.changes.length === 1 ? "" : "s"} proposed`);
        onDone();
      }}>
      <div className="flex max-h-[46vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.map((row, n) => {
          const item = byName.get(row.name);
          return (
            <div key={n} className="flex flex-col gap-2 rounded-xl border border-d-border p-3">
              <div className="flex items-center gap-2">
                <select value={row.name} disabled={!!initial[0]?.name} onChange={(e) => set(n, { name: e.target.value, value: "" })}
                  aria-label="Key" className={`${inputClass} font-mono`}>
                  <option value="" disabled>Choose a key</option>
                  {(["secret", "config"] as const).map((t) => (
                    <optgroup key={t} label={t === "secret" ? "Secrets" : "Config"}>
                      {editable.filter((i) => typeOf(i) === t && (i.name === row.name || !rows.some((r) => r.name === i.name)))
                        .map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, i) => i !== n))} aria-label="Remove row"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg text-d-muted hover:bg-red-500/10 hover:text-red-500">
                    <Trash size={16} />
                  </button>
                )}
              </div>
              <ValueInput item={item} value={row.value} onChange={(v) => set(n, { value: v })} />
              {item?.help && <p className="text-[11px] text-d-faint">{item.help}</p>}
              <TextInput value={row.note} onChange={(e) => set(n, { note: e.target.value })} placeholder="Note (optional): where to rotate, or who owns it" />
            </div>
          );
        })}
      </div>
      {!initial[0]?.name && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setRows((rs) => [...rs, { name: "", value: "", note: "" }])}>
            Add another
          </Button>
          <Button size="sm" variant="ghost" icon={<FileArrowUp size={14} />} onClick={() => setPasting((p) => !p)}>Paste .env</Button>
        </div>
      )}
      {pasting && (
        <div className="flex flex-col gap-2">
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} spellCheck={false}
            placeholder={"OPENAI_API_KEY=...\nTOPUP_DAILY_COUNT=5"} className={`${inputClass} !h-auto py-2 font-mono text-[12px]`} />
          <Button size="sm" onClick={importEnv} disabled={!pasted.trim()}>Add from paste</Button>
        </div>
      )}
      {rotation && (
        <label className="flex items-start gap-2 text-[13px] text-d-text">
          <input type="checkbox" checked={compromised} onChange={(e) => setCompromised(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
          <span>The current value was compromised <span className="block text-[12px] text-d-muted">It is wiped at once and can never be restored.</span></span>
        </label>
      )}
      <Field label="Reason (recorded and sent to every owner)">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Quarterly rotation" />
      </Field>
    </StepUpDialog>
  );
}

function ActionDialog({ action, items, single, onClose, onDone, onAction, owner, writable }: {
  action: Action | null; items: SecretItem[]; single: boolean; onClose: () => void; onDone: () => void;
  onAction: (a: Action) => void; owner: boolean; writable: boolean;
}) {
  const [reason, setReason] = useState("");
  function close() {
    setReason("");
    onClose();
  }
  if (!action) return null;

  if (action.kind === "edit") {
    return <EditorDialog initial={action.rows} rotation={action.rotation} items={items} single={single} onClose={close} onDone={onDone} />;
  }

  if (action.kind === "history") {
    const item = action.item;
    return (
      <Dialog open onClose={close} size="sm" title={`${item.name} history`} description="Routine versions can be restored for 7 days. Compromised ones never.">
        <ul className="flex flex-col divide-y divide-d-border rounded-xl border border-d-border">
          {item.active && (
            <li className="flex items-center gap-3 px-3.5 py-2.5 text-[12px]">
              <span className="font-mono text-d-text">v{item.active.version}</span>
              <span className="font-mono text-d-muted">{item.active.last4}</span>
              <Badge tone="success">In use</Badge>
              <span className="ml-auto text-d-faint">{ago(item.active.created_at)}</span>
            </li>
          )}
          {item.versions.map((v) => {
            const canRestore = owner && writable && v.status === "retired" && withinDays(v.retired_at, 7);
            return (
              <li key={v.version} className="flex items-center gap-3 px-3.5 py-2.5 text-[12px]">
                <span className="font-mono text-d-text">v{v.version}</span>
                <span className="font-mono text-d-muted">{v.last4}</span>
                <Badge tone={v.status === "revoked" ? "danger" : "neutral"}>{v.status === "revoked" ? "Revoked" : "Retired"}</Badge>
                {canRestore ? (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onAction({ kind: "rollback", item, version: v.version })}>Restore</Button>
                ) : (
                  <span className="ml-auto text-d-faint">{ago(v.retired_at)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
    );
  }

  if (action.kind === "approve") {
    const c = action.change;
    return (
      <StepUpDialog open onClose={close} title={`Approve ${c.name}?`} confirmLabel="Approve"
        description={`${c.proposed_by}: ${c.reason}.`}
        onConfirm={async (stepUp) => {
          await approveSecretChange(c.id, stepUp);
          toast.success(`${c.name} updated`);
          onDone();
        }}>
        {c.rotation_reason === "compromised" && <Notice tone="danger">Approving revokes the current value at once. It can never be restored.</Notice>}
      </StepUpDialog>
    );
  }

  const item = action.item;
  const reasonField = (
    <Field label="Reason (recorded and sent to every owner)">
      <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No longer used" />
    </Field>
  );

  if (action.kind === "remove") {
    return (
      <StepUpDialog open onClose={close} title={`Remove ${item.name}?`} confirmLabel="Propose removal" danger ready={reason.trim().length >= 5}
        description="Every stored version is wiped once approved. The server environment or the default then applies."
        onConfirm={async (stepUp) => {
          await removeSecret(item.name, { reason: reason.trim(), step_up: stepUp });
          toast.success("Removal proposed");
          onDone();
        }}>
        {reasonField}
      </StepUpDialog>
    );
  }

  return (
    <StepUpDialog open onClose={close} title={`Restore v${action.version} of ${item.name}?`} confirmLabel="Propose restore"
      ready={reason.trim().length >= 5} description="It is tested again first, then needs approval like any change."
      onConfirm={async (stepUp) => {
        await rollbackSecret(item.name, { version: action.version, reason: reason.trim(), step_up: stepUp });
        toast.success("Restore proposed");
        onDone();
      }}>
      {reasonField}
    </StepUpDialog>
  );
}

/** Send a real test email or SMS with the settings in force, to check them end
 * to end. The settings themselves are edited in the list above. */
function DeliveryCheck() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"email" | "sms" | null>(null);

  async function send(kind: "email" | "sms", to: string) {
    setBusy(kind);
    try {
      const r = await sendTestMessage(kind, to.trim());
      if (r.sent) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the test.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <p className="text-[14px] font-semibold text-d-text">Check email and SMS</p>
      <p className="mt-1 text-[12px] text-d-muted">
        Sends a real message with the mail and SMS settings in force. Sandbox banks never need this: their customers&apos;
        codes appear in the demo app&apos;s sandbox inbox.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Email address">
          <div className="flex gap-2">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.ng" />
            <Button variant="secondary" loading={busy === "email"} disabled={!email.includes("@") || busy !== null}
              onClick={() => void send("email", email)}>
              Send test email
            </Button>
          </div>
        </Field>
        <Field label="Phone number">
          <div className="flex gap-2">
            <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803..." />
            <Button variant="secondary" loading={busy === "sms"} disabled={phone.trim().length < 10 || busy !== null}
              onClick={() => void send("sms", phone)}>
              Send test SMS
            </Button>
          </div>
        </Field>
      </div>
    </Card>
  );
}
