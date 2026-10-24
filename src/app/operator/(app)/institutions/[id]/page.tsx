"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  Copy,
  DownloadSimple,
  EnvelopeSimple,
  Pause,
  Play,
  Sparkle,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Dialog } from "@/components/dashboard/Dialog";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  Skeleton,
  StatCard,
  StatGrid,
  TextInput,
  inputClass,
} from "@/components/dashboard/primitives";
import { ago, compact, EventIcon, eventDetail, eventLabel, fullDate, InstitutionMark, SetupBar, StageBadge, stageOf } from "@/components/operator/ui";
import {
  can,
  clearInstitutionData,
  deleteInstitution,
  downloadInstitutionExport,
  inviteOwner,
  reactivateInstitution,
  setInstitutionAssistant,
  suspendInstitution,
  useInstitution,
  useOperatorSession,
  type InstitutionDetail,
} from "@/lib/fable/operator";

type Tab = "overview" | "team" | "assistant" | "activity" | "data";
type Danger = "suspend" | "clear" | "delete" | "invite" | null;

export default function OperatorInstitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const session = useOperatorSession();
  const { data, error, isLoading, mutate } = useInstitution(id);
  const [dialog, setDialog] = useState<Danger>(null);
  const [tab, setTab] = useState<Tab>("overview");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <EmptyState icon={<Warning size={22} />} title="Institution not found" body={error?.message ?? "It may have been deleted."}
          action={<Link href="/operator/institutions" className="text-[13px] font-semibold text-brand">Back to institutions</Link>} />
      </Card>
    );
  }

  const i = data.institution;
  const stage = stageOf(i);
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

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "team", label: `Team ${data.members.length}`, show: true },
    { key: "assistant", label: "Ask Fable", show: true },
    { key: "activity", label: "Activity", show: true },
    { key: "data", label: "Data", show: admin },
  ];

  return (
    <>
      <Link href="/operator/institutions" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-d-muted hover:text-d-text">
        <ArrowLeft size={14} /> Institutions
      </Link>

      <Card>
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <InstitutionMark name={i.name} stage={stage} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[22px] font-bold leading-tight text-d-text">{i.name}</h1>
                <StageBadge stage={stage} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-d-muted">
                <button type="button" className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-d-text"
                  title="Copy id" onClick={() => navigator.clipboard.writeText(i.institution_id).then(() => toast.success("Id copied"))}>
                  {i.institution_id} <Copy size={11} />
                </button>
                {i.type && <span>· {i.type}</span>}
                {i.contact_email && <span className="truncate">· {i.contact_email}</span>}
                <span title={fullDate(i.created_at)}>· Created {ago(i.created_at)}</span>
              </p>
            </div>
          </div>
          {admin && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<EnvelopeSimple size={15} />} onClick={() => setDialog("invite")}>Invite owner</Button>
              {suspended ? (
                <Button size="sm" icon={<Play size={15} />} onClick={reactivate}>Reactivate</Button>
              ) : (
                <Button variant="secondary" size="sm" icon={<Pause size={15} />} onClick={() => setDialog("suspend")}>Suspend</Button>
              )}
            </div>
          )}
        </div>
        {suspended && i.suspended_reason && <Notice tone="danger" className="mt-4">Suspended: {i.suspended_reason}</Notice>}
        {!i.owners && (
          <Notice tone="warning" className="mt-4">
            {i.invites_pending ? "The owner hasn't accepted their invite yet. Send a new link if it expired." : "This institution has no owner. Invite one."}
          </Notice>
        )}
      </Card>

      <div role="tablist" aria-label="Institution sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-d-border px-4 sm:mx-0 sm:px-0">
        {TABS.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-3.5 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${
              tab === t.key ? "border-brand text-d-text" : "border-transparent text-d-muted hover:text-d-text"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} />}
      {tab === "team" && <TeamTab data={data} admin={admin} onInvite={() => setDialog("invite")} />}
      {tab === "assistant" && <AssistantTab id={id} data={data} admin={admin} onSaved={() => mutate()} />}
      {tab === "activity" && <ActivityTab data={data} />}
      {tab === "data" && admin && (
        <DataTab id={id} owner={owner} suspended={suspended} onClear={() => setDialog("clear")} onDelete={() => setDialog("delete")} />
      )}

      <SuspendDialog open={dialog === "suspend"} id={id} onClose={() => setDialog(null)} onDone={() => mutate()} />
      <InviteOwnerDialog open={dialog === "invite"} id={id} onClose={() => setDialog(null)} onDone={() => mutate()} />
      <DestructiveDialog
        open={dialog === "clear" || dialog === "delete"}
        kind={dialog === "delete" ? "delete" : "clear"}
        id={id}
        name={i.name}
        onClose={() => setDialog(null)}
        onDone={(gone) => (gone ? router.push("/operator/institutions") : mutate())}
      />
    </>
  );
}

function OverviewTab({ data }: { data: InstitutionDetail }) {
  const i = data.institution;
  const ob = data.onboarding;
  return (
    <>
      <StatGrid>
        <StatCard label="Real customers" value={compact(i.real_customers)} sub={`${compact(i.customers - i.real_customers)} test`} featured />
        <StatCard label="Past transfers imported" value={compact(i.history)} sub="Baselines from day one" tone="success" />
        <StatCard label="Decisions, 30 days" value={compact(i.decisions_30d)} sub={i.last_decision ? `Last ${ago(i.last_decision)}` : "None yet"} tone="warning" />
        <StatCard label="Console members" value={String(i.members)} sub={i.invites_pending ? `${i.invites_pending} invite pending` : "All accepted"} />
      </StatGrid>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardHeader title="Go-live checklist" subtitle={ob.ready_to_go_live ? "Every required step is done." : "What the institution still has to do in its console."} />
          <SetupBar done={ob.done} total={ob.total} className="w-full sm:w-56" />
        </div>
        <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          {ob.items.map((item) => (
            <li key={item.key} className={`flex items-start gap-3 rounded-xl border p-3.5 ${item.done ? "border-d-border" : "border-d-border bg-d-surface-2/50"}`}>
              {item.done ? (
                <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />
              ) : (
                <Circle size={20} className="mt-0.5 shrink-0 text-d-faint" />
              )}
              <div className="min-w-0">
                <p className={`text-[13px] font-semibold ${item.done ? "text-d-muted" : "text-d-text"}`}>
                  {item.label}
                  {!item.required && <span className="ml-1.5 text-[11px] font-normal text-d-faint">Recommended</span>}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-d-muted">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function TeamTab({ data, admin, onInvite }: { data: InstitutionDetail; admin: boolean; onInvite: () => void }) {
  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader title="Console members" subtitle="People at the institution. They manage their own team; you can only invite an owner." />
        {admin && <Button size="sm" variant="secondary" icon={<EnvelopeSimple size={14} />} onClick={onInvite}>Invite owner</Button>}
      </div>
      {data.members.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-d-muted">No members yet.</p>
      ) : (
        <ul className="divide-y divide-d-border border-t border-d-border">
          {data.members.map((m) => (
            <li key={m.email} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={m.name || m.email} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-d-text">{m.name || m.email}</span>
                <span className="block truncate text-[12px] text-d-muted">{m.name ? m.email : `Added ${ago(m.created_at)}`}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Badge tone="brand">{m.role[0].toUpperCase() + m.role.slice(1)}</Badge>
                {m.status === "invited" && <Badge tone="warning">Invited</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssistantTab({ id, data, admin, onSaved }: { id: string; data: InstitutionDetail; admin: boolean; onSaved: () => void }) {
  const { override, usage, platform } = data.assistant;
  const [mode, setMode] = useState<"platform" | "on" | "off">(override.enabled === null ? "platform" : override.enabled ? "on" : "off");
  const [custom, setCustom] = useState(override.daily_answers !== null);
  const [budget, setBudget] = useState(String(override.daily_answers ?? platform.institution_daily_answers));
  const [busy, setBusy] = useState(false);
  const effectiveOn = mode === "platform" ? platform.ai_enabled : mode === "on";
  const effectiveBudget = custom ? Number(budget) || 0 : platform.institution_daily_answers;

  async function save() {
    setBusy(true);
    try {
      await setInstitutionAssistant(id, {
        enabled: mode === "platform" ? null : mode === "on",
        daily_answers: custom ? Math.max(0, Math.round(Number(budget) || 0)) : null,
      });
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="Ask Fable for this institution" subtitle="Override the platform setting for this one bank. Answers from its own figures always work." />
        <div className="flex flex-col gap-4">
          <Field label="AI answers">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                ["platform", `Follow platform (${platform.ai_enabled ? "on" : "off"})`],
                ["on", "Always on"],
                ["off", "Off: figures only"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" disabled={!admin} onClick={() => setMode(value)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                    mode === value ? "border-brand bg-brand/[0.07] text-d-text" : "border-d-border text-d-muted hover:border-brand/40"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="AI answers a day">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-[13px] text-d-text">
                <input type="checkbox" checked={custom} disabled={!admin} onChange={(e) => setCustom(e.target.checked)}
                  className="size-4 accent-[var(--brand-primary)]" />
                Its own budget
              </label>
              {custom ? (
                <TextInput type="number" min={0} max={100000} value={budget} disabled={!admin}
                  onChange={(e) => setBudget(e.target.value)} className="sm:max-w-[160px]" />
              ) : (
                <span className="text-[13px] text-d-muted">Platform budget: {platform.institution_daily_answers} a day</span>
              )}
            </div>
          </Field>
          <Notice tone="neutral">
            {effectiveOn
              ? `AI answers are on, up to ${effectiveBudget.toLocaleString("en-NG")} a day. Past that, answers come from the figures alone until midnight, Lagos time.`
              : "AI answers are off. Every answer comes from the institution's figures, at no model cost."}
          </Notice>
          {admin && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-d-faint">{override.updated_by ? `Last changed by ${override.updated_by}, ${ago(override.updated_at)}` : ""}</span>
              <Button loading={busy} onClick={save}>Save</Button>
            </div>
          )}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Usage" subtitle="Lagos time" />
        <div className="grid grid-cols-2 gap-2">
          <Mini label="Questions today" value={usage.questions_today} />
          <Mini label="AI answers today" value={usage.model_answers_today} hint={`of ${effectiveOn ? effectiveBudget : 0}`} />
          <Mini label="Questions, 30 days" value={usage.questions} />
          <Mini label="Tokens, 30 days" value={usage.input_tokens + usage.output_tokens} />
        </div>
        <Link href="/operator/assistant" className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
          <Sparkle size={12} weight="fill" /> Platform limits and usage
        </Link>
      </Card>
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl bg-d-surface-2 px-3.5 py-3">
      <p className="text-[11px] font-medium text-d-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums text-d-text">
        {compact(value)}
        {hint && <span className="ml-1 text-[12px] font-medium text-d-faint">{hint}</span>}
      </p>
    </div>
  );
}

function ActivityTab({ data }: { data: InstitutionDetail }) {
  return (
    <Card padded={false}>
      <div className="p-5 pb-3"><CardHeader title="Activity" subtitle="What has happened at this institution, newest first." /></div>
      {data.recent_events.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-d-muted">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-d-border border-t border-d-border">
          {data.recent_events.map((e, n) => (
            <li key={n} className="flex items-center gap-3 px-5 py-3">
              <EventIcon type={e.event_type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-d-text">{eventLabel(e.event_type)}</span>
                {Boolean(eventDetail(e.payload) || e.payload.operator) && (
                  <span className="block truncate text-[12px] text-d-muted">
                    {e.payload.operator ? `By ${String(e.payload.operator)}` : ""}
                    {e.payload.operator && eventDetail(e.payload) ? " · " : ""}
                    {eventDetail(e.payload)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[12px] text-d-faint" title={fullDate(e.created_at)}>{ago(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DataTab({ id, owner, suspended, onClear, onDelete }: {
  id: string; owner: boolean; suspended: boolean; onClear: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Export" subtitle="Every table the institution owns, as CSV files in one zip. Spreadsheet formulas are neutralised." />
        <Button variant="secondary" icon={<DownloadSimple size={16} />}
          onClick={() => downloadInstitutionExport(id).catch((err) => toast.error(err.message))}>
          Export all data
        </Button>
      </Card>
      <Card className="border-red-500/30">
        <CardHeader title="Danger zone" subtitle="Platform owners only. Each needs the institution's id typed out and a recorded reason." />
        <div className="flex flex-col divide-y divide-d-border">
          <DangerRow title="Clear customer data"
            body="Removes every customer and everything they did. The institution, team, keys, policy and audit trail stay."
            action={<Button variant="danger" size="sm" icon={<Warning size={15} />} disabled={!owner} onClick={onClear}>Clear data</Button>} />
          <DangerRow title="Delete institution"
            body={suspended ? "Removes the institution and everything it owns. Only its audit trail is kept." : "Suspend the institution first, then delete it."}
            action={<Button variant="danger" size="sm" icon={<Trash size={15} />} disabled={!owner || !suspended} onClick={onDelete}>Delete</Button>} />
        </div>
        {!owner && <p className="mt-3 text-[12px] text-d-muted">Only a platform owner can clear or delete.</p>}
      </Card>
    </div>
  );
}

function DangerRow({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-d-text">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-d-muted">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
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
