"use client";

import { useEffect, useState } from "react";
import { Fingerprint, EnvelopeSimple, ShieldWarning, WarningCircle } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import {
  authenticatePasskey,
  passkeySupported,
  registerPasskey,
  sendOtp,
  verifyOtp,
  type StepUpRequirement,
} from "@/lib/fable/webauthn";

/**
 * Runs the factor Shield demanded and hands back proof.
 *
 * The tiers exist because a prompt inside a compromised session proves
 * nothing. A passkey is answered by the device's secure element and an emailed
 * code arrives on a channel the session doesn't control, so neither can be
 * satisfied by an attacker who merely holds the tab.
 */
export function StepUpDialog({
  open,
  onClose,
  onVerified,
  requirement,
  userId,
  displayName,
  institutionId,
  purpose,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  requirement: StepUpRequirement | null;
  userId: string;
  displayName: string;
  institutionId: string | null;
  purpose: "transfer" | "ghost_release";
  reference: string | null;
}) {
  const [stage, setStage] = useState<"passkey" | "otp" | "enrol">("passkey");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [otpChallenge, setOtpChallenge] = useState<string | null>(null);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const level = requirement?.level ?? "pin";
  const needsPasskey = requirement?.factors.includes("passkey") ?? false;
  const needsOtp = requirement?.factors.includes("otp") ?? false;
  const vendorTier = level === "identity_check";

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCode("");
    setOtpChallenge(null);
    void passkeySupported().then(setSupported);
    // A tier that wants a passkey can't start until one exists on this device.
    if (needsPasskey && requirement && !requirement.passkey_registered) setStage("enrol");
    else if (needsPasskey) setStage("passkey");
    else setStage("otp");
  }, [open, needsPasskey, requirement]);

  async function enrol() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(userId, displayName, institutionId);
      setStage("passkey");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register a passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function runPasskey() {
    setBusy(true);
    setError(null);
    try {
      const res = await authenticatePasskey(userId, purpose, reference, level);
      if (res.token) {
        onVerified(res.token);
        return;
      }
      // Tier needs the out-of-band channel too, so no proof is issued yet.
      if (res.next === "otp") {
        await requestCode();
        setStage("otp");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    const res = await sendOtp({ userId, institutionId, purpose, reference });
    setOtpChallenge(res.challenge_id);
    setOtpEmail(res.email);
    setDebugCode(res.debug_code ?? null);
  }

  async function startOtp() {
    setBusy(true);
    setError(null);
    try {
      await requestCode();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!otpChallenge || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyOtp({
        userId,
        challengeId: otpChallenge,
        code: code.trim(),
        requiredLevel: level,
      });
      onVerified(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code isn't right.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DemoSheet
      open={open}
      onClose={onClose}
      title="Verify it's you"
      subtitle={requirement?.label ?? "Additional verification required"}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/10">
          <ShieldWarning size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
            {requirement?.detail ?? "This transfer needs extra verification."}
          </p>
        </div>

        {(requirement?.recent_failures ?? 0) > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-white/40">
            <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-red-500" />
            {requirement!.recent_failures} recent failed verification
            {requirement!.recent_failures === 1 ? "" : "s"} on this account.
          </p>
        )}

        {vendorTier ? (
          <div className="rounded-2xl border border-gray-200 p-4 text-[12px] leading-relaxed text-gray-600 dark:border-white/[0.08] dark:text-white/50">
            <p className="mb-1.5 font-bold text-gray-900 dark:text-white">Identity check required</p>
            This transfer needs a liveness check against the ID on file. Fable defines the
            interface; the check itself runs through a KYC provider, which this environment has
            no credentials for. Cancelling returns the money immediately.
          </div>
        ) : stage === "enrol" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed text-gray-600 dark:text-white/50">
              {supported
                ? "Set up this device's fingerprint or face unlock. The key is created inside the device and never leaves it, so it can't be phished or reused from anywhere else."
                : "This device has no built-in biometric available, so a code will be emailed instead."}
            </p>
            {supported ? (
              <button
                type="button"
                onClick={enrol}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Fingerprint size={17} weight="bold" />
                {busy ? "Waiting for device…" : "Set up device unlock"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setStage("otp"); void startOtp(); }}
                className="rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white"
              >
                Email me a code instead
              </button>
            )}
          </div>
        ) : stage === "passkey" ? (
          <button
            type="button"
            onClick={runPasskey}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Fingerprint size={18} weight="bold" />
            {busy ? "Waiting for device…" : "Confirm with device unlock"}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {!otpChallenge ? (
              <button
                type="button"
                onClick={startOtp}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
              >
                <EnvelopeSimple size={17} weight="bold" />
                {busy ? "Sending…" : "Send verification code"}
              </button>
            ) : (
              <>
                <p className="text-[12px] text-gray-600 dark:text-white/50">
                  {needsOtp && needsPasskey ? "Device confirmed. " : ""}
                  Code sent to <span className="font-semibold">{otpEmail}</span>.
                </p>
                {debugCode && (
                  <p className="rounded-lg bg-gray-100 px-3 py-2 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-white/50">
                    No mail server configured, so the code is shown here:{" "}
                    <span className="font-mono font-bold">{debugCode}</span>
                  </p>
                )}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && submitCode()}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-[18px] font-bold tracking-[0.3em] tabular-nums text-gray-900 outline-none focus:ring-2 focus:ring-[#7C3AED]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
                />
                <button
                  type="button"
                  onClick={submitCode}
                  disabled={busy || code.length < 6}
                  className="rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Checking…" : "Confirm"}
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 dark:text-white/35 dark:hover:text-white/70"
        >
          Cancel — keep the money held
        </button>
      </div>
    </DemoSheet>
  );
}
