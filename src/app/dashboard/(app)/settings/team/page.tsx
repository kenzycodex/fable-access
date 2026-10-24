"use client";

import { useState } from "react";
import { Check, Copy, UserPlus, UsersThree } from "@phosphor-icons/react";
import { ConfirmDialog, Dialog } from "@/components/dashboard/Dialog";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  Segmented,
  Skeleton,
  TextInput,
} from "@/components/dashboard/primitives";
import { changeMemberRole, inviteMember, removeMember, type TeamMember } from "@/lib/fable/console";
import { usePermissions, useTeam } from "@/lib/fable/useConsole";

type MemberRole = TeamMember["role"];

const ROLES: { value: MemberRole; label: string; detail: string }[] = [
  { value: "owner", label: "Owner", detail: "Everything, including people, keys, webhooks and risk policy." },
  { value: "analyst", label: "Analyst", detail: "Works the review queue and resets customer PINs. Reads everything else." },
  { value: "viewer", label: "Viewer", detail: "Reads everything, changes nothing. For auditors and leadership." },
];

export default function TeamPage() {
  const { data, error, isLoading, mutate } = useTeam();
  const { canManage } = usePermissions();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function changeRole(m: TeamMember, role: MemberRole) {
    setMsg(null);
    try {
      await changeMemberRole(m.email, role);
      await mutate();
      setMsg({ tone: "success", text: `${m.name || m.email} is now ${role}.` });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not change the role." });
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setMsg(null);
    try {
      await removeMember(removing.email);
      await mutate();
      setMsg({ tone: "success", text: `${removing.name || removing.email} no longer has access.` });
      setRemoving(null);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not remove them." });
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <CardHeader title="Team" subtitle="Everyone who can sign in to your console" />
            {canManage && (
              <Button icon={<UserPlus size={16} />} onClick={() => setInviting(true)}>
                Invite
              </Button>
            )}
          </div>

          {error ? (
            <div className="p-5 pt-0">
              <Notice tone="danger">{error.message}</Notice>
            </div>
          ) : isLoading && !data ? (
            <div className="space-y-3 p-5 pt-0">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : !data || data.members.length === 0 ? (
            <EmptyState icon={<UsersThree size={22} />} title="Just you so far" body="Invite analysts to work the review queue with you." />
          ) : (
            <ul className="divide-y divide-d-border">
              {data.members.map((m) => (
                <li key={m.email} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar name={m.name || m.email} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-d-text">
                      {m.name || m.email.split("@")[0]}
                      {m.you && <Badge tone="brand">You</Badge>}
                      {m.status === "invited" && <Badge tone="warning">Invite pending</Badge>}
                    </p>
                    <p className="truncate text-[12px] text-d-muted">{m.email}</p>
                  </div>
                  {canManage && !m.you ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m, e.target.value as MemberRole)}
                        aria-label={`Role for ${m.email}`}
                        className="h-9 rounded-xl border border-d-border bg-d-surface-2 px-3 text-[13px] font-medium text-d-text outline-none focus:border-brand/50"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" className="!text-red-500" onClick={() => setRemoving(m)}>
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Badge>{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Roles" subtitle="Enforced by the API, not just hidden in the console" />
          <ul className="flex flex-col gap-3">
            {ROLES.map((r) => (
              <li key={r.value} className="rounded-xl bg-d-surface-2 px-3.5 py-3">
                <p className="text-[13px] font-semibold text-d-text">{r.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-d-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} onInvited={() => void mutate()} />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        busy={busy}
        tone="danger"
        title={`Remove ${removing?.name || removing?.email}?`}
        description="They are signed out on their next action and can no longer sign in. Their past activity stays in the audit trail."
        confirmLabel="Remove access"
      />
    </>
  );
}

function InviteDialog({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("analyst");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; link: string | null; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  function close() {
    setEmail("");
    setName("");
    setRole("analyst");
    setError(null);
    setResult(null);
    setCopied(false);
    onClose();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await inviteMember(email.trim(), role, name.trim());
      setResult({ email: res.email, link: res.invite_link, emailed: res.emailed });
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={result ? "Invite created" : "Invite a teammate"}
      description={result ? undefined : "They get a link to set their own password. It expires in 7 days."}
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={busy} disabled={!email.trim()}>
              Send invite
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          {result.emailed ? (
            <Notice tone="success">We emailed {result.email} a link to join.</Notice>
          ) : (
            <>
              <Notice tone="warning">
                Email isn&apos;t set up on this server, so send {result.email} this link yourself. It is shown only once.
              </Notice>
              {result.link && (
                <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 py-2 pl-3.5 pr-2">
                  <code className="flex-1 truncate text-[12px] text-d-text">{result.link}</code>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                    onClick={() => {
                      void navigator.clipboard?.writeText(result.link ?? "");
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <form id="invite-form" onSubmit={send} className="flex flex-col gap-4">
          <Field label="Email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourbank.ng" required autoFocus />
          </Field>
          <Field label="Name (optional)">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Okafor" maxLength={80} />
          </Field>
          <Field label="Role" hint={ROLES.find((r) => r.value === role)?.detail}>
            <Segmented<MemberRole>
              value={role}
              onChange={setRole}
              options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      )}
    </Dialog>
  );
}
