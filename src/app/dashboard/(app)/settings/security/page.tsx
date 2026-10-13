"use client";

import { useState } from "react";
import { Button, Card, CardHeader, Field, Notice, TextInput } from "@/components/dashboard/primitives";
import { changePassword } from "@/lib/fable/console";
import { useMe } from "@/lib/fable/useConsole";

export default function SecuritySettingsPage() {
  const { data: who } = useMe();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirm) return setMsg({ tone: "danger", text: "The new passwords do not match." });
    if (newPw.length < 8) return setMsg({ tone: "danger", text: "Use at least 8 characters." });
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(oldPw, newPw);
      setMsg({ tone: "success", text: "Password changed." });
      setOldPw("");
      setNewPw("");
      setConfirm("");
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Could not change the password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Your password" subtitle={who ? `Signed in as ${who.email}` : "Change the password you sign in with."} />
        {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
        <form onSubmit={submit} className="grid max-w-[36rem] grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Lets password managers save the change against the right account. */}
          <input type="email" autoComplete="username" value={who?.email ?? ""} readOnly hidden />
          <div className="sm:col-span-2">
            <Field label="Current password">
              <TextInput type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required autoComplete="current-password" />
            </Field>
          </div>
          <Field label="New password" hint="At least 8 characters.">
            <TextInput type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Sessions" subtitle="How console access works" />
        <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-d-muted">
          <li>A sign-in lasts 12 hours, then you sign in again.</li>
          <li>Removing someone from the team ends their access on their next action.</li>
          <li>Every sign-in, password change and setting change is recorded in Compliance.</li>
        </ul>
      </Card>
    </div>
  );
}
