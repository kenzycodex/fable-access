"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthNotice, AuthShell, AuthSpinner, AuthSuccess, authButton, authInput } from "@/components/dashboard/AuthShell";
import { acceptOperatorInvite } from "@/lib/fable/operator";

/** A new operator chooses their password from the invite link. The
 * authenticator is set up at their first sign-in. */
function AcceptForm() {
  const token = useSearchParams().get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match.");
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    setError("");
    try {
      await acceptOperatorInvite(token, password, name.trim());
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That invite link didn't work.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <AuthSuccess title="You're in" action={<Link href="/operator/login" className={authButton}>Sign in</Link>}>
          Your password is set. Sign in to set up your authenticator app.
        </AuthSuccess>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join Fable operations" description="Choose your name and a password. You'll set up an authenticator app when you sign in.">
      <form className="flex w-full flex-col gap-3" onSubmit={submit}>
        {!token && <AuthNotice tone="danger">This link is missing its invite code. Open the link from your email again.</AuthNotice>}
        {error && <AuthNotice tone="danger">{error}</AuthNotice>}
        <input value={name} onChange={(e) => setName(e.target.value)} className={authInput} placeholder="Your name" aria-label="Your name" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput}
          placeholder="Password (8 characters or more)" aria-label="Password" autoComplete="new-password" required />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput}
          placeholder="Repeat password" aria-label="Repeat password" autoComplete="new-password" required />
        <button type="submit" disabled={busy || !token} className={`mt-2 ${authButton}`}>
          {busy ? <><AuthSpinner />Saving...</> : "Set password"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function OperatorAcceptPage() {
  return (
    <Suspense fallback={null}>
      <AcceptForm />
    </Suspense>
  );
}
