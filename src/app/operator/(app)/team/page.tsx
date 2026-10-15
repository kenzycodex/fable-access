"use client";

import { useState } from "react";
import { Crown, EnvelopeSimple, Fingerprint, ShieldCheck, UserPlus, UsersThree } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ConfirmDialog, Dialog } from "@/components/dashboard/Dialog";
import { Avatar, Badge, Button, Card, CardHeader, Field, Notice, PageHeader, Skeleton, StatCard, StatGrid, TextInput, table } from "@/components/dashboard/primitives";
import { ago, fullDate } from "@/components/operator/ui";
import {
  can,
  changeOperatorRole,
  inviteOperator,
  removeOperator,
  ROLE_LABEL,
  useOperatorPasskeys,
  useOperatorSession,
  useOperatorTeam,
  type Operator,
  type OperatorRole,
} from "@/lib/fable/operator";

const ROLES: OperatorRole[] = ["platform_owner", "platform_admin", "support"];

const ROLE_HELP: { role: OperatorRole; icon: React.ReactNode; body: string }[] = [
  { role: "platform_owner", icon: <Crown size={16} weight="fill" />, body: "Everything, including operators, integration keys, Ask Fable limits, clearing and deleting institutions." },
  { role: "platform_admin", icon: <ShieldCheck size={16} weight="fill" />, body: "Provisions, suspends and reactivates institutions, invites owners, reads every audit view and exports." },
  { role: "support", icon: <UsersThree size={16} weight="fill" />, body: "Reads institutions and operator activity to help banks. Changes nothing." },
];

/** Fable's own staff. Platform owners invite, change and remove operators. */
export default function OperatorTeamPage() {
  const session = useOperatorSession();
  const { data, isLoading, mutate } = useOperatorTeam();
  const owner = can(session?.role, "platform_owner");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const { data: myKeys } = useOperatorPasskeys();
  const team = data?.operators ?? [];
  const owners = team.filter((o) => o.role === "platform_owner" && o.status !== "invited").length;
  const invited = team.filter((o) => o.status === "invited").length;
  const withMfa = team.filter((o) => o.mfa).length;

  async function setRole(email: string, role: OperatorRole) {
    try {
      await changeOperatorRole(email, role);
      toast.success("Role changed");
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the role.");
    }
  }

  return (
    <>
      <PageHeader
        title="Operators"
        description="Fable staff with access to this platform. Everyone signs in with an authenticator app."
        actions={owner && <Button icon={<UserPlus size={16} />} onClick={() => setInviting(true)}>Invite operator</Button>}
      />
      <StatGrid>
        <StatCard label="Operators" value={data ? String(team.length) : "-"} sub={`${invited} invite${invited === 1 ? "" : "s"} pending`}
          icon={<UsersThree size={17} weight="fill" />} featured />
        <StatCard label="Platform owners" value={data ? String(owners) : "-"}
          sub={owners < 2 ? "Add a second for maker-checker" : "Key changes need two of them"} icon={<Crown size={17} weight="fill" />}
          tone={owners < 2 ? "warning" : "success"} />
        <StatCard label="Authenticator set up" value={data ? `${withMfa}/${team.length}` : "-"} sub="Required to sign in"
          icon={<ShieldCheck size={17} weight="fill" />} tone="success" />
        <StatCard label="Your passkeys" value={myKeys ? String(myKeys.passkeys.length) : "-"}
          sub={myKeys?.passkeys.length ? "Preferred for secret changes" : "Add one in Your account"}
          icon={<Fingerprint size={17} weight="fill" />} tone="brand" />
      </StatGrid>

      {data && owners < 2 && (
        <Notice tone="warning">
          There is only one platform owner. Integration-key changes then wait out a 12-hour cooling-off period instead of a second owner&apos;s approval. Invite a second owner to restore maker-checker.
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
      <Card padded={false} className="xl:col-span-2">
        <div className="p-5 pb-3"><CardHeader title="Fable staff" subtitle="Everyone who can sign in to this platform." /></div>
        {isLoading ? (
          <div className="p-5"><Skeleton className="h-24" /></div>
        ) : (
          <>
            <ul className="divide-y divide-d-border md:hidden">
              {(data?.operators ?? []).map((o) => {
                const you = o.email === session?.email;
                return (
                  <li key={o.email} className="flex flex-col gap-2.5 px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={o.name || o.email} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-d-text">
                          {o.name || o.email}{you && <span className="ml-1.5 text-[12px] font-normal text-d-faint">(you)</span>}
                        </span>
                        <span className="block truncate text-[12px] text-d-muted">{o.name ? o.email : ROLE_LABEL[o.role]}</span>
                      </span>
                      <Status o={o} />
                    </div>
                    {owner && !you && (
                      <div className="flex items-center gap-2 pl-11">
                        <RoleSelect value={o.role} onChange={(r) => setRole(o.email, r)} />
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(o.email)}>Remove</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className={`${table.wrap} hidden md:block`}>
              <table className={`${table.base} min-w-[680px]`}>
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Operator</th>
                    <th className={table.th}>Role</th>
                    <th className={table.th}>Status</th>
                    <th className={`${table.th} whitespace-nowrap`}>Last sign-in</th>
                    <th className={table.th} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.operators ?? []).map((o) => {
                    const you = o.email === session?.email;
                    return (
                      <tr key={o.email} className={table.row}>
                        <td className={table.td}>
                          <span className="flex items-center gap-3">
                            <Avatar name={o.name || o.email} size="sm" />
                            <span className="min-w-0">
                              <span className="block whitespace-nowrap font-semibold text-d-text">
                                {o.name || o.email}{you && <span className="ml-2 text-[12px] font-normal text-d-faint">(you)</span>}
                              </span>
                              {o.name && <span className="block text-[12px] text-d-muted">{o.email}</span>}
                            </span>
                          </span>
                        </td>
                        <td className={table.td}>
                          {owner && !you ? <RoleSelect value={o.role} onChange={(r) => setRole(o.email, r)} /> : <Badge tone="brand">{ROLE_LABEL[o.role]}</Badge>}
                        </td>
                        <td className={table.td}><Status o={o} /></td>
                        <td className={`${table.td} whitespace-nowrap text-d-muted`} title={fullDate(o.last_login_at)}>
                          {o.last_login_at ? ago(o.last_login_at) : "Never"}
                        </td>
                        <td className={`${table.td} text-right`}>
                          {owner && !you && <Button size="sm" variant="ghost" onClick={() => setRemoving(o.email)}>Remove</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Roles" subtitle="Least privilege: give each person the lowest role that does their job." />
          <ul className="flex flex-col gap-3">
            {ROLE_HELP.map((r) => (
              <li key={r.role} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{r.icon}</span>
                <span>
                  <span className="block text-[13px] font-semibold text-d-text">{ROLE_LABEL[r.role]}</span>
                  <span className="block text-[12px] leading-relaxed text-d-muted">{r.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="How operators sign in" />
          <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-d-muted">
            <li className="flex gap-2"><ShieldCheck size={14} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />A password and an authenticator code, every time. Codes cannot be reused.</li>
            <li className="flex gap-2"><Fingerprint size={14} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />A passkey or a fresh code again for any integration-key change.</li>
            <li className="flex gap-2"><EnvelopeSimple size={14} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />Invites are one-time links that expire in 3 days. No password is ever emailed.</li>
          </ul>
        </Card>
      </div>
      </div>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onDone={() => mutate()} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        tone="danger"
        title="Remove this operator?"
        description={`${removing} loses access immediately, including any session open now.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await removeOperator(removing!);
            toast.success("Removed");
            mutate();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not remove.");
          }
          setRemoving(null);
        }}
      />
    </>
  );
}

function Status({ o }: { o: Operator }) {
  if (o.status === "invited") return <Badge tone="warning">Invited</Badge>;
  return o.mfa ? <Badge tone="success"><ShieldCheck size={12} weight="fill" /> MFA on</Badge> : <Badge tone="warning">MFA at first sign-in</Badge>;
}

function RoleSelect({ value, onChange }: { value: OperatorRole; onChange: (r: OperatorRole) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as OperatorRole)} aria-label="Role"
      className="h-9 rounded-lg border border-d-border bg-d-surface-2 px-2 text-[13px] text-d-text">
      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );
}

function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<OperatorRole>("support");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await inviteOperator(email.trim(), role, name.trim());
      onDone();
      if (r.invite_link) setLink(r.invite_link);
      else {
        toast.success(`Invite emailed to ${r.email}`);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={() => { setLink(null); onClose(); }} title="Invite an operator" size="sm"
      description="They set a password from a one-time link (valid 3 days), then set up an authenticator app at first sign-in."
      footer={!link ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go} disabled={!email.includes("@")}>Send invite</Button></> : undefined}>
      {link ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-d-muted">Email isn&apos;t set up, so send this link yourself:</p>
          <code className="block break-all rounded-lg bg-d-surface-2 p-3 font-mono text-[12px]">{link}</code>
          <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Copied"))}>Copy link</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Work email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name (optional)"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as OperatorRole)}
              className="h-11 w-full rounded-xl border border-d-border bg-d-surface-2 px-3 text-[14px] text-d-text">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}
