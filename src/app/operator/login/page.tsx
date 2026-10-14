"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { AuthNotice, AuthShell, AuthSpinner, authButton, authInput } from "@/components/dashboard/AuthShell";
import { operatorLogin, operatorVerify, useOperatorSession, type LoginStep } from "@/lib/fable/operator";

/**
 * Sign-in for Fable staff. Two factors, always: the password, then a code from
 * an authenticator app. On the first sign-in the app is set up here, from a QR
 * code drawn in this browser; the secret is never sent anywhere else.
 */
export default function OperatorLoginPage() {
  const session = useOperatorSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) window.location.replace("/operator");
  }, [session]);

  useEffect(() => {
    if (step?.step !== "enroll") return;
    let cancelled = false;
    QRCode.toDataURL(step.otpauth_uri, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setStep(await operatorLogin(email, password));
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!step) return;
    setBusy(true);
    setError("");
    try {
      await operatorVerify(step.challenge, code);
      window.location.assign("/operator");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
      setBusy(false);
      if (err instanceof Error && /expired|again/i.test(err.message) && !/code/i.test(err.message)) setStep(null);
    }
  }

  if (!step) {
    return (
      <AuthShell title="Fable operator" description="For Fable staff. Sign in with your password, then your authenticator app.">
        <form className="flex w-full flex-col gap-4" onSubmit={submitPassword}>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput}
            placeholder="Work email" aria-label="Work email" autoComplete="username" required />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput}
            placeholder="Password" aria-label="Password" autoComplete="current-password" required />
          <button type="submit" disabled={busy} className={`mt-2 ${authButton}`}>
            {busy ? <><AuthSpinner />Checking...</> : "Continue"}
          </button>
        </form>
      </AuthShell>
    );
  }

  const enrolling = step.step === "enroll";
  return (
    <AuthShell
      title={enrolling ? "Set up your authenticator" : "Enter your code"}
      description={
        enrolling
          ? "Scan this with Google Authenticator, Microsoft Authenticator, 1Password or Authy, then enter the 6-digit code it shows."
          : "Open your authenticator app and enter the 6-digit code for Fable Operator."
      }
    >
      <form className="flex w-full flex-col items-center gap-4" onSubmit={submitCode}>
        {error && <AuthNotice tone="danger">{error}</AuthNotice>}
        {enrolling && (
          <div className="flex w-full flex-col items-center gap-3">
            <span className="rounded-lg bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- a QR code drawn locally as a data URI
                <img src={qr} alt="QR code for your authenticator app" width={180} height={180} />
              ) : (
                <span className="block size-[180px]" />
              )}
            </span>
            <details className="w-full text-center text-[12px] text-gray-400">
              <summary className="cursor-pointer">Can&apos;t scan? Enter the key instead</summary>
              <code className="mt-2 block break-all rounded bg-white/5 px-3 py-2 font-mono text-[13px] tracking-wider text-white">
                {step.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
            </details>
          </div>
        )}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className={`${authInput} text-center font-mono text-[20px] tracking-[0.4em]`}
          placeholder="000000"
          aria-label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
        />
        <button type="submit" disabled={busy || code.length !== 6} className={`mt-1 ${authButton}`}>
          {busy ? <><AuthSpinner />Verifying...</> : enrolling ? "Finish setup" : "Sign in"}
        </button>
        <button type="button" onClick={() => { setStep(null); setCode(""); setError(""); }}
          className="text-[13px] text-gray-400 transition-colors hover:text-white">
          Start again
        </button>
      </form>
    </AuthShell>
  );
}
