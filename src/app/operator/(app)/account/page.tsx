"use client";

import { useTheme } from "next-themes";
import { useState } from "react";
import { Fingerprint, Plus, ShieldCheck, SignOut, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Card, CardHeader, DetailRow, PageHeader, Segmented, TextInput } from "@/components/dashboard/primitives";
import { StepUpDialog } from "@/components/operator/StepUpDialog";
import { ago, fullDate } from "@/components/operator/ui";
import { LAYOUTS, setConsoleLayout, useConsoleLayout, type ConsoleLayout } from "@/lib/fable/layout";
import {
  addOperatorPasskey,
  operatorSignOut,
  removeOperatorPasskey,
  ROLE_LABEL,
  useOperatorMe,
  useOperatorPasskeys,
  useOperatorSession,
} from "@/lib/fable/operator";

/** The signed-in operator: who they are, how they sign in, and how the platform looks for them. */
export default function OperatorAccountPage() {
  const session = useOperatorSession();
  const { data: me } = useOperatorMe();
  const name = me?.name || session?.email || "";

  return (
    <>
      <PageHeader title="Your account" description="How you sign in and confirm sensitive actions, and how the platform looks for you." />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar name={name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[18px] font-bold text-d-text">{name}</p>
                <p className="truncate text-[13px] text-d-muted">{session?.email}</p>
              </div>
              {session && <Badge tone="warning">{ROLE_LABEL[session.role]}</Badge>}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailRow label="Signed in">{me?.last_login_at ? fullDate(me.last_login_at) : "-"}</DetailRow>
              <DetailRow label="Operator since">{me?.created_at ? fullDate(me.created_at) : "-"}</DetailRow>
            </div>
          </Card>
          <Passkeys />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Sign-in" />
            <ul className="flex flex-col gap-3 text-[13px]">
              <li className="flex items-center justify-between gap-3">
                <span className="text-d-text">Password</span>
                <Badge tone="success">Set</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-d-text">Authenticator app</span>
                <Badge tone="success"><ShieldCheck size={12} weight="fill" /> On</Badge>
              </li>
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-d-muted">
              Every sign-in needs both. To reset your authenticator, ask another platform owner to re-invite you.
            </p>
          </Card>
          <Appearance />
          <Button variant="secondary" icon={<SignOut size={16} />} onClick={operatorSignOut}>Sign out</Button>
        </div>
      </div>
    </>
  );
}

function Passkeys() {
  const { data, mutate } = useOperatorPasskeys();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const keys = data?.passkeys ?? [];

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

  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader title="Passkeys" subtitle="Your fingerprint, face or device lock. Preferred for confirming secret changes: phishing-resistant and tied to this site." />
      </div>
      {keys.length === 0 ? (
        <p className="border-t border-d-border px-5 py-4 text-[13px] text-d-muted">
          None yet. Until you add one, you confirm sensitive actions with a code from your authenticator app.
        </p>
      ) : (
        <ul className="divide-y divide-d-border border-t border-d-border">
          {keys.map((k) => (
            <li key={k.credential_id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand"><Fingerprint size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-d-text">{k.label || "Passkey"}</span>
                <span className="block text-[12px] text-d-muted">Added {ago(k.created_at)}{k.last_used_at ? ` · used ${ago(k.last_used_at)}` : " · never used"}</span>
              </span>
              <Button size="sm" variant="ghost" icon={<Trash size={14} />} onClick={() => setRemoving({ id: k.credential_id, label: k.label || "Passkey" })}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 border-t border-d-border p-4">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name it, e.g. MacBook" aria-label="Passkey name" />
        <Button loading={busy} onClick={add} icon={<Plus size={14} />}>Add passkey</Button>
      </div>
      <StepUpDialog open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${removing?.label ?? "passkey"}?`}
        confirmLabel="Remove" danger description="You will no longer be able to confirm changes with it."
        onConfirm={async (stepUp) => {
          await removeOperatorPasskey(removing!.id, stepUp);
          toast.success("Passkey removed");
          mutate();
        }} />
    </Card>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const layout = useConsoleLayout();
  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Saved in this browser." />
      <p className="mb-2 text-[12px] font-medium text-d-muted">Theme</p>
      <Segmented<string>
        value={theme ?? "system"}
        onChange={setTheme}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <p className="mb-2 mt-4 text-[12px] font-medium text-d-muted">Layout</p>
      <div className="flex flex-col gap-2">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" onClick={() => setConsoleLayout(l.id as ConsoleLayout)}
            className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${layout === l.id ? "border-brand bg-brand/[0.07]" : "border-d-border hover:border-brand/40"}`}>
            <span className="block text-[13px] font-semibold text-d-text">{l.name}</span>
            <span className="mt-0.5 block text-[12px] text-d-muted">{l.summary}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
