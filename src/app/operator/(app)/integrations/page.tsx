"use client";

import { useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  Clock,
  Fingerprint,
  HardDrives,
  Key,
  LockKey,
  Plus,
  ShieldCheck,
  ShieldWarning,
  Trash,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Notice,
  PageHeader,
  Skeleton,
  StatCard,
  StatGrid,
  TextInput,
  inputClass,
} from "@/components/dashboard/primitives";
import { StepUpDialog } from "@/components/operator/StepUpDialog";
import { ago, fullDate, isPast, withinDays } from "@/components/operator/ui";
import {
  addOperatorPasskey,
  approveSecretChange,
  can,
  proposeSecret,
  rejectSecretChange,
  removeOperatorPasskey,
  removeSecret,
  rollbackSecret,
  testSecret,
  useOperatorPasskeys,
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
  | { kind: "passkey-remove"; id: string; label: string };

/** Integration keys: which provider keys the API uses, and every change to them. */
export default function IntegrationsPage() {
  const session = useOperatorSession();
  const { data, error, mutate } = useSecrets();
  const owner = can(session?.role, "platform_owner");
  const admin = can(session?.role, "platform_admin");
  const [action, setAction] = useState<Action | null>(null);

  if (error) return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;

  const items = data?.items ?? [];
  const configured = items.filter((i) => i.kind === "secret" && i.source !== "unset").length;
  const secrets = items.filter((i) => i.kind === "secret").length;
  const inConsole = items.filter((i) => i.source === "console").length;
  const due = items.filter((i) => isPast(i.rotation_due)).length;
  const groups = [...new Set(items.map((i) => i.group))];
  const writable = Boolean(data?.write_enabled && data?.master_key);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="The provider keys the API uses. Values are encrypted, never shown again, and every change is approved by a second owner and recorded."
      />

      <StatGrid>
        <StatCard label="Keys configured" value={data ? `${configured}/${secrets}` : "-"} sub="AI and address providers"
          icon={<Key size={17} weight="fill" />} featured />
        <StatCard label="Managed here" value={data ? String(inConsole) : "-"} sub="The rest come from the server environment"
          icon={<LockKey size={17} weight="fill" />} tone="success" />
        <StatCard label="Waiting for a decision" value={data ? String(data.pending.length) : "-"}
          sub={data?.owners && data.owners < 2 ? "Cooling-off: one owner" : "Need a second owner"}
          icon={<Clock size={17} weight="fill" />} tone={data?.pending.length ? "warning" : "brand"} />
        <StatCard label="Rotation due" value={data ? String(due) : "-"} sub="Keys older than their rotation period"
          icon={<ArrowCounterClockwise size={17} weight="fill" />} tone={due ? "danger" : "success"} />
      </StatGrid>

      {data && <Banners data={data} />}

      {!!data?.pending.length && (
        <Card padded={false}>
          <div className="p-5 pb-3"><CardHeader title="Waiting for a decision" subtitle="Nothing changes until another owner approves, or the cooling-off period ends." /></div>
          <ul className="divide-y divide-d-border border-t border-d-border">
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

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          {!data ? (
            <Skeleton className="h-80" />
          ) : (
            groups.map((g) => (
              <Card key={g} padded={false}>
                <div className="p-5 pb-3"><CardHeader title={g} /></div>
                <ul className="divide-y divide-d-border border-t border-d-border">
                  {items.filter((i) => i.group === g).map((item) => (
                    <KeyRow key={item.name} item={item} owner={owner} admin={admin} writable={writable}
                      onSet={() => setAction({ kind: "set", item })}
                      onRemove={() => setAction({ kind: "remove", item })}
                      onRollback={(version) => setAction({ kind: "rollback", item, version })} />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Passkeys onRemove={(id, label) => setAction({ kind: "passkey-remove", id, label })} />
          <Card>
            <CardHeader title="How keys are protected" />
            <ul className="flex flex-col gap-2.5 text-[12px] leading-relaxed text-d-muted">
              {PROTECTIONS.map(([icon, text]) => (
                <li key={text} className="flex gap-2.5"><span className="mt-0.5 shrink-0 text-emerald-500">{icon}</span>{text}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Always in the server environment" subtitle="Never managed here, by design." />
            <p className="text-[12px] leading-relaxed text-d-muted">
              The session secret, this master key, the PIN pepper, email (SMTP) settings, URLs, CORS and WebAuthn settings.
              They either start the app or protect security emails and sign-in, so a web page must not be able to change them.
            </p>
          </Card>
        </div>
      </div>

      <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => mutate()} />
    </>
  );
}

const PROTECTIONS: [React.ReactNode, string][] = [
  [<LockKey key="1" size={14} weight="fill" />, "AES-256-GCM per value, wrapped by a master key that exists only on the server."],
  [<ShieldCheck key="2" size={14} weight="fill" />, "Write-only: after saving you see the last 4 characters and a fingerprint, never the key."],
  [<Fingerprint key="3" size={14} weight="fill" />, "Each change needs a passkey or a fresh authenticator code, and a second owner."],
  [<ShieldWarning key="4" size={14} weight="fill" />, "A key retired as compromised is wiped at once and can never be restored."],
  [<HardDrives key="5" size={14} weight="fill" />, "Every action is hash-chained in the audit log and copied to the server's log stream."],
];

function Banners({ data }: { data: SecretsOverview }) {
  return (
    <>
      {!data.master_key && (
        <Notice tone="warning">
          FABLE_SECRETS_KEY is not set on the server, so keys can only come from its environment and this page is read-only.
        </Notice>
      )}
      {data.master_key && !data.write_enabled && (
        <Notice tone="warning">Key changes are switched off on the server (FABLE_SECRETS_WRITE=off). This page is read-only.</Notice>
      )}
      {data.owners < 2 && (
        <Notice tone="warning">
          Only one platform owner can approve, so a change waits out a 12-hour cooling-off period, with every owner emailed, before it applies.
          Invite a second owner to restore maker-checker.
        </Notice>
      )}
      {data.me.locked_until && (
        <Notice tone="danger">Your key actions are locked after repeated failed verifications, until {fullDate(data.me.locked_until)}.</Notice>
      )}
    </>
  );
}

function SourceBadge({ item }: { item: SecretItem }) {
  if (item.source === "environment") return <Badge tone="neutral"><HardDrives size={12} /> Server environment</Badge>;
  if (item.source === "console") return <Badge tone="success"><LockKey size={12} weight="fill" /> Managed here</Badge>;
  if (item.default) return <Badge tone="neutral">Fable default</Badge>;
  return <Badge tone="warning">Not set</Badge>;
}

function KeyRow({ item, owner, admin, writable, onSet, onRemove, onRollback }: {
  item: SecretItem; owner: boolean; admin: boolean; writable: boolean;
  onSet: () => void; onRemove: () => void; onRollback: (version: number) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const overdue = isPast(item.rotation_due);
  const env = item.source === "environment";
  const restorable = item.versions.filter((v) => v.status === "retired" && withinDays(v.retired_at, 7));

  async function test() {
    setTesting(true);
    try {
      setResult(await testSecret(item.name));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Could not test." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-d-text">{item.label}</span>
            <SourceBadge item={item} />
            {overdue && <Badge tone="danger">Rotation due</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-d-muted">
            <span className="font-mono">{item.name}</span>
            {item.display && <span className="font-mono text-d-text">{item.display}</span>}
            {!item.display && item.default && <span>Default: <span className="font-mono">{item.default}</span></span>}
            {item.active && <span>v{item.active.version}, set {ago(item.active.created_at)} by {item.active.set_by}</span>}
            {item.active?.fingerprint && <span title="SHA-256 fingerprint">#{item.active.fingerprint}</span>}
          </p>
          {result && (
            <p className={`mt-1.5 flex items-center gap-1.5 text-[12px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {result.ok ? <CheckCircle size={13} weight="fill" /> : <XCircle size={13} weight="fill" />} {result.message}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {admin && item.kind === "secret" && item.source !== "unset" && (
            <Button size="sm" variant="secondary" loading={testing} onClick={test}>Test</Button>
          )}
          {owner && !env && (
            <Button size="sm" disabled={!writable} onClick={onSet} icon={item.source === "unset" && item.kind !== "model" ? <Plus size={14} /> : <ArrowCounterClockwise size={14} />}>
              {item.kind === "model" ? "Change" : item.source === "unset" ? "Add" : "Rotate"}
            </Button>
          )}
          {item.versions.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide history" : "History"}</Button>
          )}
          {owner && item.source === "console" && (
            <Button size="sm" variant="ghost" disabled={!writable} onClick={onRemove} icon={<Trash size={14} />}>Remove</Button>
          )}
        </div>
      </div>
      {env && (
        <p className="mt-2 text-[12px] text-d-faint">Set in the server&apos;s .env, which takes precedence. Remove it there to manage it here.</p>
      )}
      {open && (
        <ul className="mt-3 divide-y divide-d-border rounded-xl border border-d-border">
          {item.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[12px]">
              <span className="font-mono text-d-text">v{v.version}</span>
              <span className="font-mono text-d-muted">{v.last4}</span>
              <Badge tone={v.status === "revoked" ? "danger" : "neutral"}>{v.status === "revoked" ? "Revoked (compromised)" : "Retired"}</Badge>
              <span className="text-d-muted">retired {ago(v.retired_at)}</span>
              {owner && writable && restorable.some((r) => r.version === v.version) && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onRollback(v.version)}>Restore</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PendingRow({ c, me, owner, onApprove, onReject }: {
  c: SecretChange; me?: string; owner: boolean; onApprove: () => void; onReject: () => void;
}) {
  const mine = c.proposed_by === me;
  const when = c.status === "cooling" ? c.apply_after : c.expires_at;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${c.rotation_reason === "compromised" ? "bg-red-500/12 text-red-500" : "bg-amber-500/12 text-amber-600"}`}>
        {c.rotation_reason === "compromised" ? <ShieldWarning size={19} weight="fill" /> : <Clock size={19} weight="fill" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-d-text">
          <span className="font-semibold">{c.proposed_by}</span> wants to {c.action === "set" ? "set" : c.action === "rollback" ? `restore v${c.target_version} of` : "remove"}{" "}
          <span className="font-mono">{c.name}</span>
          {c.last4 && <span className="font-mono text-d-muted"> ({c.last4})</span>}
        </p>
        <p className="mt-0.5 text-[12px] text-d-muted">
          {c.reason}
          {c.rotation_reason === "compromised" && <span className="font-semibold text-red-600 dark:text-red-400"> · Compromised: the current key will be revoked</span>}
          {" · "}
          {c.status === "cooling" ? `Applies ${fullDate(when)} unless cancelled` : `Expires ${fullDate(when)}`}
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

function Passkeys({ onRemove }: { onRemove: (id: string, label: string) => void }) {
  const { data, mutate } = useOperatorPasskeys();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      await addOperatorPasskey(label.trim() || "Passkey");
      toast.success("Passkey added");
      setLabel("");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the passkey.");
    } finally {
      setBusy(false);
    }
  }
  const keys = data?.passkeys ?? [];
  return (
    <Card>
      <CardHeader title="Your passkeys" subtitle="Preferred for confirming key changes. Phishing-resistant and tied to this site." />
      {keys.length === 0 ? (
        <p className="mb-3 text-[13px] text-d-muted">None yet. Until you add one, you confirm with an authenticator code.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {keys.map((k) => (
            <li key={k.credential_id} className="flex items-center gap-3 rounded-xl border border-d-border px-3 py-2.5">
              <Fingerprint size={18} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-d-text">{k.label || "Passkey"}</span>
                <span className="block text-[11px] text-d-muted">Added {ago(k.created_at)}{k.last_used_at ? `, used ${ago(k.last_used_at)}` : ""}</span>
              </span>
              <button type="button" onClick={() => onRemove(k.credential_id, k.label || "Passkey")} aria-label="Remove passkey"
                className="flex size-8 items-center justify-center rounded-lg text-d-muted hover:bg-red-500/10 hover:text-red-500">
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. MacBook" aria-label="Passkey name" />
        <Button loading={busy} onClick={add} icon={<Plus size={14} />}>Add</Button>
      </div>
    </Card>
  );
}

function ActionDialog({ action, onClose, onDone }: { action: Action | null; onClose: () => void; onDone: () => void }) {
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
        {c.rotation_reason === "compromised" && (
          <Notice tone="danger">Approving revokes the current key at once. It can never be restored.</Notice>
        )}
      </StepUpDialog>
    );
  }

  if (action.kind === "passkey-remove") {
    return (
      <StepUpDialog open onClose={close} title={`Remove ${action.label}?`} confirmLabel="Remove" danger
        description="You will no longer be able to confirm key changes with it."
        onConfirm={async (stepUp) => {
          await removeOperatorPasskey(action.id, stepUp);
          toast.success("Passkey removed");
          onDone();
        }} />
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
      <StepUpDialog open onClose={close} title={`Remove ${item.label}?`} confirmLabel="Propose removal" danger ready={reason.trim().length >= 5}
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
      <StepUpDialog open onClose={close} title={`Restore v${action.version} of ${item.label}?`} confirmLabel="Propose restore"
        ready={reason.trim().length >= 5}
        description="The old key is tested against the provider first. A second owner approves before it is used."
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
    <StepUpDialog open onClose={close} title={`${item.source === "unset" ? "Add" : isModel ? "Change" : "Rotate"} ${item.label}`}
      confirmLabel="Propose" ready={value.trim().length > 0 && reason.trim().length >= 5}
      description={isModel ? "Only models on the allowlist can be chosen." : "The key is tested against the provider before it is accepted. It is never shown again."}
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
        <Field label="New key">
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} placeholder="Paste the key" />
        </Field>
      )}
      {!isModel && item.source !== "unset" && (
        <Field label="Why is it changing?">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["routine", "compromised"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRotation(r)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  rotation === r ? (r === "compromised" ? "border-red-500 bg-red-500/[0.07]" : "border-brand bg-brand/[0.07]") : "border-d-border hover:border-brand/40"
                }`}>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-d-text">
                  {r === "compromised" ? <Warning size={14} className="text-red-500" /> : <ArrowCounterClockwise size={14} className="text-brand" />}
                  {r === "routine" ? "Routine rotation" : "Compromised"}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-d-muted">
                  {r === "routine" ? "The old key is kept, encrypted, for 7 days in case you need it back." : "The old key is wiped at once and can never be restored."}
                </span>
              </button>
            ))}
          </div>
        </Field>
      )}
      {reasonField}
    </StepUpDialog>
  );
}
