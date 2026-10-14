"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, CheckCircle, Circle, DownloadSimple, EnvelopeSimple, Pause, Play, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Dialog } from "@/components/dashboard/Dialog";
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
import { formatRelativeTime } from "@/lib/fable/format";
import {
  can,
  clearInstitutionData,
  deleteInstitution,
  downloadInstitutionExport,
  inviteOwner,
  reactivateInstitution,
  suspendInstitution,
  useInstitution,
  useOperatorSession,
} from "@/lib/fable/operator";

const EVENT_LABEL: Record<string, string> = {
  "institution.provisioned": "Institution created",
  "institution.suspended": "Suspended",
  "institution.reactivated": "Reactivated",
  "institution.owner_invited": "Owner invited",
  "institution.mode_changed": "Mode changed",
  "institution.agreements_confirmed": "Agreements confirmed",
  "institution.exported": "Data exported",
  "institution.data_cleared": "Customer data cleared",
  "team.invited": "Member invited",
  "import.applied": "Data imported",
  "apikey.rotated": "API key created",
  "policy.changed": "Risk policy saved",
  "sandbox.reset": "Sandbox reset",
};

const when = (iso: string | null) =>
  iso ? formatRelativeTime(new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").getTime()) : "-";

type Danger = "suspend" | "clear" | "delete" | "invite" | null;

export default function OperatorInstitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useOperatorSession();
  const { data, error, isLoading, mutate } = useInstitution(id);
  const [dialog, setDialog] = useState<Danger>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) {
    return (
      <Card>
        <p className="text-[14px] text-d-muted">{error?.message ?? "Institution not found."}</p>
        <Link href="/operator" className="mt-3 inline-block text-[13px] font-semibold text-brand">Back to institutions</Link>
      </Card>
    );
  }

  const i = data.institution;
  const suspended = i.status === "suspended";
  const admin = can(session?.role, "platform_admin");
  const owner = can(session?.role, "platform_owner");

  async function reactivate() {
    try {
      await reactivateInstitution(id);
      toast.success("Reactivated");
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reactivate.");
    }
  }

  return (
    <>
      <Link href="/operator" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-d-muted hover:text-d-text">
        <ArrowLeft size={14} /> Institutions
      </Link>
      <PageHeader
        title={i.name}
        description={`${i.institution_id}${i.type ? ` · ${i.type}` : ""}${i.contact_email ? ` · ${i.contact_email}` : ""}`}
        actions={
          <>
            <Badge tone={i.mode === "live" ? "success" : "neutral"}>{i.mode === "live" ? "Live" : "Sandbox"}</Badge>
            {suspended && <Badge tone="danger">Suspended</Badge>}
            {admin &&
              (suspended ? (
                <Button variant="secondary" icon={<Play size={16} />} onClick={reactivate}>Reactivate</Button>
              ) : (
                <Button variant="secondary" icon={<Pause size={16} />} onClick={() => setDialog("suspend")}>Suspend</Button>
              ))}
          </>
        }
      />

      {suspended && i.suspended_reason && <Notice tone="danger">Suspended: {i.suspended_reason}</Notice>}

      <StatGrid>
        <StatCard label="Customers" value={i.customers.toLocaleString("en-NG")} sub={`${i.real_customers.toLocaleString("en-NG")} real`} featured />
        <StatCard label="Past transfers imported" value={i.history.toLocaleString("en-NG")} />
        <StatCard label="Decisions, 30 days" value={i.decisions_30d.toLocaleString("en-NG")} />
        <StatCard label="Console members" value={String(i.members)} />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Go-live checklist"
            subtitle={data.onboarding.ready_to_go_live ? "Ready to go live." : `${data.onboarding.done} of ${data.onboarding.total} done.`}
          />
          <ul className="flex flex-col divide-y divide-d-border">
            {data.onboarding.items.map((item) => (
              <li key={item.key} className="flex items-start gap-3 py-3">
                {item.done ? (
                  <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle size={20} className="mt-0.5 shrink-0 text-d-faint" />
                )}
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-d-text">
                    {item.label} {!item.required && <span className="text-[12px] font-normal text-d-faint">(recommended)</span>}
                  </p>
                  <p className="text-[12px] leading-relaxed text-d-muted">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Team"
            action={admin && <Button size="sm" variant="secondary" icon={<EnvelopeSimple size={14} />} onClick={() => setDialog("invite")}>Invite owner</Button>}
          />
          {data.members.length === 0 ? (
            <p className="text-[13px] text-d-muted">No members yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.members.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-d-text">{m.name || m.email}</span>
                    {m.name && <span className="block truncate text-[12px] text-d-muted">{m.email}</span>}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Badge tone="brand">{m.role}</Badge>
                    {m.status === "invited" && <Badge tone="warning">Invited</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" subtitle="What has happened in this institution, newest first." />
        {data.recent_events.length === 0 ? (
          <p className="text-[13px] text-d-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-d-border">
            {data.recent_events.map((e, n) => (
              <li key={n} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="text-d-text">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                <span className="shrink-0 text-d-muted">{when(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {admin && (
        <Card className="border-red-500/30">
          <CardHeader title="Data" subtitle="Export first. Clearing and deleting can't be undone." />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button variant="secondary" icon={<DownloadSimple size={16} />}
              onClick={() => downloadInstitutionExport(id).catch((err) => toast.error(err.message))}>
              Export all data
            </Button>
            {owner && (
              <>
                <Button variant="danger" icon={<Warning size={16} />} onClick={() => setDialog("clear")}>Clear customer data</Button>
                <Button variant="danger" icon={<Trash size={16} />} onClick={() => setDialog("delete")} disabled={!suspended}>
                  Delete institution
                </Button>
              </>
            )}
          </div>
          {owner && !suspended && <p className="mt-3 text-[12px] text-d-muted">Suspend the institution before deleting it.</p>}
        </Card>
      )}

      <SuspendDialog open={dialog === "suspend"} id={id} onClose={() => setDialog(null)} onDone={() => mutate()} />
      <InviteOwnerDialog open={dialog === "invite"} id={id} onClose={() => setDialog(null)} onDone={() => mutate()} />
      <DestructiveDialog
        open={dialog === "clear" || dialog === "delete"}
        kind={dialog === "delete" ? "delete" : "clear"}
        id={id}
        name={i.name}
        onClose={() => setDialog(null)}
        onDone={(gone) => (gone ? window.location.assign("/operator") : mutate())}
      />
    </>
  );
}

function SuspendDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await suspendInstitution(id, reason.trim());
      toast.success("Suspended");
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not suspend.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Suspend this institution?" size="sm"
      description="Its console, API keys and sandbox stop working at once. Nothing is deleted, and you can reactivate it."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={go}>Suspend</Button></>}>
      <Field label="Reason (recorded and shown to the institution)">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Security review" />
      </Field>
    </Dialog>
  );
}

function InviteOwnerDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await inviteOwner(id, email.trim(), name.trim());
      setLink(r.invite_link);
      toast.success(r.emailed ? `Invite emailed to ${r.email}` : "Invite created");
      onDone();
      if (r.emailed) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={() => { setLink(null); onClose(); }} title="Invite an owner" size="sm"
      description="They get a one-time link to set their password. Use this when the first link expired or the owner changed."
      footer={!link ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go} disabled={!email.includes("@")}>Send invite</Button></> : undefined}>
      {link ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-d-muted">Email isn&apos;t set up, so send this link yourself:</p>
          <code className="block break-all rounded-lg bg-d-surface-2 p-3 font-mono text-[12px]">{link}</code>
          <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Copied"))}>Copy link</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Owner's work email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name (optional)"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
      )}
    </Dialog>
  );
}

function DestructiveDialog({
  open, kind, id, name, onClose, onDone,
}: { open: boolean; kind: "clear" | "delete"; id: string; name: string; onClose: () => void; onDone: (gone: boolean) => void }) {
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = confirm.trim() === id && reason.trim().length >= 5;
  async function go() {
    setBusy(true);
    try {
      if (kind === "delete") {
        await deleteInstitution(id, confirm.trim(), reason.trim());
        toast.success(`${name} was deleted`);
        onDone(true);
      } else {
        const r = await clearInstitutionData(id, confirm.trim(), reason.trim());
        toast.success(`Cleared ${r.customers_removed} customer(s) and their activity`);
        onDone(false);
      }
      setConfirm("");
      setReason("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} size="sm"
      title={kind === "delete" ? `Delete ${name}?` : `Clear ${name}'s customer data?`}
      description={
        kind === "delete"
          ? "Everything about this institution is removed: its customers, decisions, history, team, keys and settings. Only its audit trail is kept, recording the deletion."
          : "Every customer and everything they did is removed. The institution, its team, keys, policy, webhooks and audit trail stay. Export first if the bank needs a copy."
      }
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!ready} onClick={go}>{kind === "delete" ? "Delete for good" : "Clear data"}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={`Type ${id} to confirm`}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Reason (recorded)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The bank's written instruction of 14 October" />
        </Field>
      </div>
    </Dialog>
  );
}
