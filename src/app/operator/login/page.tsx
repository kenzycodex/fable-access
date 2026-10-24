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
      // A full navigation, not router.push, for the same reason as the console
      // sign-in: a prefetch made while signed out cached a redirect back here,
      // and the client router would replay it. A hard navigation skips that.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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

  const codeForm = (
    <div className="flex w-full flex-col gap-3">
      {error && <AuthNotice tone="danger">{error}</AuthNotice>}
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
      <button type="submit" disabled={busy || code.length !== 6} className={authButton}>
        {busy ? <><AuthSpinner />Verifying...</> : enrolling ? "Finish setup" : "Sign in"}
      </button>
      <button type="button" onClick={() => { setStep(null); setCode(""); setError(""); }}
        className="text-[13px] text-gray-400 transition-colors hover:text-white">
        Start again
      </button>
    </div>
  );

  if (!enrolling) {
    return (
      <AuthShell title="Enter your code" description="Open your authenticator app and enter the 6-digit code for Fable Operator.">
        <form className="flex w-full flex-col items-center" onSubmit={submitCode}>{codeForm}</form>
      </AuthShell>
    );
  }

  // Setting up: the QR code beside the code entry on wider screens, above it on phones.
  return (
    <AuthShell
      wide
      title="Set up your authenticator"
      description="Works with Google Authenticator, Microsoft Authenticator, 1Password or Authy."
    >
      <form className="grid w-full items-center gap-6 sm:grid-cols-[1fr_auto]" onSubmit={submitCode}>
        <div className="order-2 flex flex-col gap-3 sm:order-1">
          <ol className="flex flex-col gap-1.5 text-[12.5px] text-gray-400">
            <li><span className="mr-1.5 font-semibold text-white">1.</span>Scan the code with your app</li>
            <li><span className="mr-1.5 font-semibold text-white">2.</span>Enter the 6-digit code it shows</li>
          </ol>
          {codeForm}
        </div>
        <div className="order-1 flex flex-col items-center gap-2 sm:order-2">
          <span className="rounded-xl bg-white p-2">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- a QR code drawn locally as a data URI
              <img src={qr} alt="QR code for your authenticator app" width={156} height={156} />
            ) : (
              <span className="block size-[156px]" />
            )}
          </span>
          <details className="w-[172px] text-center text-[11.5px] text-gray-400">
            <summary className="cursor-pointer">Can&apos;t scan? Use the key</summary>
            <code className="mt-2 block break-all rounded bg-white/5 px-2 py-1.5 font-mono text-[12px] tracking-wider text-white">
              {step.secret.match(/.{1,4}/g)?.join(" ")}
            </code>
          </details>
        </div>
      </form>
    </AuthShell>
  );
}
