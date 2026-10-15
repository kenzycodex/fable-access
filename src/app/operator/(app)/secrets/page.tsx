"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Cube,
  DotsThree,
  HardDrives,
  Info,
  Key,
  LockKey,
  MagnifyingGlass,
  Plus,
  ShieldWarning,
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
  proposeSecret,
  rejectSecretChange,
  removeSecret,
  rollbackSecret,
  testSecret,
  useOperatorSession,
  useSecrets,
  type SecretChange,
  type SecretItem,
  type SecretsOverview,
} from "@/lib/fable/operator";

type Action =
  | { kind: "set"; item: SecretItem }
  | { kind: "rollback"; item: SecretItem; version: number }
  | { kind: "remove"; item: SecretItem }
  | { kind: "approve"; change: SecretChange }
  | { kind: "history"; item: SecretItem };

type Source = "all" | SecretItem["source"];

/** Secrets: the provider keys the API uses, write-only, changed with approval. */
export default function SecretsPage() {
  const session = useOperatorSession();
  const { data, error, mutate } = useSecrets();
  const owner = can(session?.role, "platform_owner");
  const admin = can(session?.role, "platform_admin");
  const [action, setAction] = useState<Action | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [adding, setAdding] = useState(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (source === "all" || i.source === source)
      && (!needle || i.name.toLowerCase().includes(needle) || i.label.toLowerCase().includes(needle)));
  }, [items, q, source]);
  const writable = Boolean(data?.write_enabled && data?.master_key);
  const unset = items.filter((i) => i.source === "unset" && i.kind === "secret");

  if (error) return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;

  return (
    <>
      <PageHeader
        title="Secrets"
        description="Encrypted provider keys the API uses. Write-only, and every change is approved by a second owner."
        actions={owner && (
          <Button icon={<Plus size={16} weight="bold" />} disabled={!writable || unset.length === 0} onClick={() => setAdding(true)}>
            Add secret
          </Button>
        )}
      />

      {data && <StatusStrip data={data} />}

      {!!data?.pending.length && (
        <Card padded={false}>
          <p className="border-b border-d-border px-5 py-3 text-[13px] font-semibold text-d-text">
            Waiting for a decision <span className="ml-1 text-d-faint">{data.pending.length}</span>
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
        <div className="flex flex-col gap-2 border-b border-d-border p-3 sm:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search secrets..." aria-label="Search secrets"
              className={`${inputClass} !h-10 pl-10 text-[13px]`} />
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Source"
            className={`${inputClass} !h-10 text-[13px] sm:w-56`}>
            <option value="all">All sources</option>
            <option value="console">Managed here</option>
            <option value="environment">Server environment</option>
            <option value="unset">Not set</option>
          </select>
        </div>
        {!data ? (
          <div className="flex flex-col gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-d-muted">No secret matches.</p>
        ) : (
          <ul className="divide-y divide-d-border">
            {rows.map((item) => (
              <SecretRow key={item.name} item={item} owner={owner} admin={admin} writable={writable}
                onAction={(a) => setAction(a)} />
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-d-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        The session secret, the master key, the PIN pepper, email (SMTP), URLs, CORS and WebAuthn settings always stay in the
        server&apos;s environment: they start the app or protect sign-in and security emails. A value set there takes precedence over one stored here.
      </p>

      <AddPicker open={adding} items={unset} onClose={() => setAdding(false)} onPick={(item) => { setAdding(false); setAction({ kind: "set", item }); }} />
      <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => mutate()} onAction={setAction} owner={owner} writable={writable} />
    </>
  );
}

function StatusStrip({ data }: { data: SecretsOverview }) {
  const chips = [
    {
      ok: data.master_key,
      label: data.master_key ? `Encrypted · master key ${data.key_id}` : "No master key: read-only",
      icon: <LockKey size={13} weight="fill" />,
    },
    {
      ok: data.owners >= 2,
      label: data.owners >= 2 ? `Two-owner approval · ${data.owners} owners` : "One owner: 12-hour cooling-off",
      icon: <ShieldWarning size={13} weight="fill" />,
    },
    { ok: data.write_enabled, label: data.write_enabled ? "Changes allowed" : "Changes switched off", icon: <Key size={13} weight="fill" /> },
    { ok: true, label: "Hash-chained audit", icon: <ClockCounterClockwise size={13} weight="bold" /> },
  ];
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium ${
            c.ok ? "border-d-border text-d-muted" : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}>
            <span className={c.ok ? "text-emerald-500" : ""}>{c.icon}</span>
            {c.label}
          </span>
        ))}
        {data.owners < 2 && (
          <Link href="/operator/team" className="inline-flex items-center rounded-full px-2 py-1 text-[12px] font-semibold text-brand hover:underline">
            Invite a second owner
          </Link>
        )}
      </div>
      {data.me.locked_until && (
        <Notice tone="danger">Your secret actions are locked after repeated failed verifications, until {fullDate(data.me.locked_until)}.</Notice>
      )}
    </>
  );
}

function SourceText({ item }: { item: SecretItem }) {
  if (item.source === "environment") return <span className="inline-flex items-center gap-1.5"><HardDrives size={13} />Server environment</span>;
  if (item.source === "console") return <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><LockKey size={13} weight="fill" />Managed here</span>;
  if (item.default) return <span className="inline-flex items-center gap-1.5"><Cube size={13} />Fable default</span>;
  return <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400"><Warning size={13} />Not set</span>;
}

function SecretRow({ item, owner, admin, writable, onAction }: {
  item: SecretItem; owner: boolean; admin: boolean; writable: boolean; onAction: (a: Action) => void;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const env = item.source === "environment";
  const value = item.kind === "model" ? item.display ?? item.default : item.display;
  const restorable = item.versions.some((v) => v.status === "retired" && withinDays(v.retired_at, 7));

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testSecret(item.name));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Could not test." });
    } finally {
      setTesting(false);
    }
  }

  const menu: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; hide?: boolean }[] = [
    { label: testing ? "Testing..." : "Test connection", icon: <CheckCircle size={15} />, onClick: test,
      hide: !admin || item.kind !== "secret" || item.source === "unset" },
    { label: item.kind === "model" ? "Change model" : item.source === "unset" ? "Add value" : "Rotate",
      icon: <ArrowCounterClockwise size={15} />, onClick: () => onAction({ kind: "set", item }), hide: !owner || env || !writable },
    { label: "History", icon: <ClockCounterClockwise size={15} />, onClick: () => onAction({ kind: "history", item }),
      hide: item.versions.length === 0 },
    { label: "Remove", icon: <Trash size={15} />, onClick: () => onAction({ kind: "remove", item }), danger: true,
      hide: !owner || item.source !== "console" || !writable },
  ];

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg border border-d-border ${item.kind === "model" ? "text-d-muted" : "text-brand"}`}>
          {item.kind === "model" ? <Cube size={16} /> : <Key size={16} />}
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-6 gap-y-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-d-text">{item.name}</p>
            <p className="truncate text-[12px] text-d-muted">{item.label}</p>
          </div>
          <p className="truncate font-mono text-[12px] text-d-muted">
            {value ? (item.kind === "model" ? value : <><span className="tracking-widest">••••••••</span> {value}</>) : <span className="text-d-faint">—</span>}
          </p>
          <p className="text-[12px] text-d-muted"><SourceText item={item} /></p>
          <p className="hidden whitespace-nowrap text-[12px] text-d-faint md:block" title={fullDate(item.active?.created_at)}>
            {item.active ? `Updated ${ago(item.active.created_at)}` : env ? "In .env" : ""}
            {isPast(item.rotation_due) && <Badge tone="danger">Rotate</Badge>}
            {restorable && <span className="sr-only">Restorable</span>}
          </p>
        </div>
        <RowMenu items={menu.filter((m) => !m.hide)} />
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
          {c.rotation_reason === "compromised" && <Badge tone="danger">Compromised</Badge>}
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

function AddPicker({ open, items, onClose, onPick }: {
  open: boolean; items: SecretItem[]; onClose: () => void; onPick: (item: SecretItem) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Add a secret" description="Choose which provider key to add. Only these keys are managed here.">
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.name}>
            <button type="button" onClick={() => onPick(i)}
              className="flex w-full items-center gap-3 rounded-xl border border-d-border px-3.5 py-3 text-left transition-colors hover:border-brand/40 hover:bg-d-surface-2">
              <Key size={16} className="text-brand" />
              <span className="min-w-0">
                <span className="block font-mono text-[13px] font-semibold text-d-text">{i.name}</span>
                <span className="block text-[12px] text-d-muted">{i.label} · {i.group}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ActionDialog({ action, onClose, onDone, onAction, owner, writable }: {
  action: Action | null; onClose: () => void; onDone: () => void; onAction: (a: Action) => void; owner: boolean; writable: boolean;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [rotation, setRotation] = useState<"routine" | "compromised">("routine");

  function close() {
    setValue("");
    setReason("");
    setRotation("routine");
    onClose();
  }

  if (!action) return null;

  if (action.kind === "history") {
    const item = action.item;
    return (
      <Dialog open onClose={close} size="sm" title={`${item.name} history`} description="Earlier versions. Routine ones can be restored for 7 days; compromised ones never.">
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
      <StepUpDialog open onClose={close} title={`Approve the ${c.name} change?`} confirmLabel="Approve"
        description={`${c.proposed_by}: ${c.reason}. The key is tested again before it applies.`}
        onConfirm={async (stepUp) => {
          await approveSecretChange(c.id, stepUp);
          toast.success(`${c.name} updated`);
          onDone();
        }}>
        {c.rotation_reason === "compromised" && <Notice tone="danger">Approving revokes the current key at once. It can never be restored.</Notice>}
      </StepUpDialog>
    );
  }

  const item = action.item;
  const reasonField = (
    <Field label="Reason (recorded and sent to every owner)">
      <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Quarterly rotation" />
    </Field>
  );

  if (action.kind === "remove") {
    return (
      <StepUpDialog open onClose={close} title={`Remove ${item.name}?`} confirmLabel="Propose removal" danger ready={reason.trim().length >= 5}
        description="Every stored version is wiped once approved. The feature falls back to the server environment, or switches off."
        onConfirm={async (stepUp) => {
          await removeSecret(item.name, { reason: reason.trim(), step_up: stepUp });
          toast.success("Removal proposed");
          onDone();
        }}>
        {reasonField}
      </StepUpDialog>
    );
  }

  if (action.kind === "rollback") {
    return (
      <StepUpDialog open onClose={close} title={`Restore v${action.version} of ${item.name}?`} confirmLabel="Propose restore"
        ready={reason.trim().length >= 5} description="The old key is tested against the provider first, then needs approval like any change."
        onConfirm={async (stepUp) => {
          await rollbackSecret(item.name, { version: action.version, reason: reason.trim(), step_up: stepUp });
          toast.success("Restore proposed");
          onDone();
        }}>
        {reasonField}
      </StepUpDialog>
    );
  }

  const isModel = item.kind === "model";
  return (
    <StepUpDialog open onClose={close} title={`${isModel ? "Change" : item.source === "unset" ? "Add" : "Rotate"} ${item.name}`}
      confirmLabel="Propose" ready={value.trim().length > 0 && reason.trim().length >= 5}
      description={isModel ? "Only models on the allowlist can be chosen." : "Tested against the provider before it is accepted. Never shown again."}
      onConfirm={async (stepUp) => {
        const r = await proposeSecret(item.name, { value: value.trim(), reason: reason.trim(), rotation, step_up: stepUp });
        toast.success(r.status === "cooling" ? "Proposed. It applies after the cooling-off period." : "Proposed. Another owner must approve it.");
        onDone();
      }}>
      {isModel ? (
        <Field label="Model">
          <select value={value} onChange={(e) => setValue(e.target.value)} className={inputClass}>
            <option value="" disabled>Choose a model</option>
            {(item.allowed_models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Value">
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} placeholder="Paste the key" />
        </Field>
      )}
      {!isModel && item.source !== "unset" && (
        <div className="grid grid-cols-2 gap-2">
          {(["routine", "compromised"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRotation(r)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                rotation === r ? (r === "compromised" ? "border-red-500 bg-red-500/[0.07]" : "border-brand bg-brand/[0.07]") : "border-d-border hover:border-brand/40"
              }`}>
              <span className="block text-[13px] font-semibold text-d-text">{r === "routine" ? "Routine" : "Compromised"}</span>
              <span className="block text-[11px] leading-snug text-d-muted">
                {r === "routine" ? "Old key kept 7 days" : "Old key wiped, never restorable"}
              </span>
            </button>
          ))}
        </div>
      )}
      {reasonField}
    </StepUpDialog>
  );
}
