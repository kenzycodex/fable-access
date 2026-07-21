"use client";

import { useEffect, useState } from "react";
import {
  Fingerprint,
  EnvelopeSimple,
  DeviceMobile,
  LockKey,
  ShieldWarning,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import {
  authenticatePasskey,
  sendOtp,
  verifyOtp,
  verifyPin,
  composeIdentityCheck,
  type StepUpRequirement,
} from "@/lib/fable/webauthn";
import { securityStatus, setPin as apiSetPin, type SecurityStatus } from "@/lib/fable/api";

type Factor = "passkey" | "pin" | "otp";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  requirement: StepUpRequirement | null;
  userId: string;
  institutionId: string | null;
  purpose: "transfer" | "ghost_release";
  reference: string | null;
}

/**
 * Collects the factors a contained release demands and hands back one proof.
 *
 * Releasing money out of a Ghost hold is the single most attacker-valuable
 * action in the product, so it can't be waved through on the session alone. The
 * factors are independent on purpose: a PIN is something known, a passkey is
 * answered by the device's secure element, and a one-time code arrives on a
 * channel the session doesn't control. An attacker who merely holds the tab has
 * none of them.
 *
 * Where the device has an enrolled passkey it is required as the strongest
 * factor; where it doesn't, a PIN plus an out-of-band code stand in — the same
 * composition real Nigerian banks rely on, and honest about what it is.
 */
export function StepUpDialog(props: DialogProps) {
  const { open, onClose, requirement } = props;
  return (
    <DemoSheet
      open={open}
      onClose={onClose}
      title="Verify it's you"
      subtitle={requirement?.label ?? "Release verification"}
    >
      {/* Keyed on the reference so each new hold mounts a fresh flow with clean
          state — no reset-in-effect needed. */}
      {open && <StepUpFlow key={props.reference ?? "flow"} {...props} />}
    </DemoSheet>
  );
}

function StepUpFlow({ onVerified, requirement, userId, institutionId, purpose, reference }: DialogProps) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passkeyToken, setPasskeyToken] = useState<string | null>(null);
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);

  const [pinValue, setPinValue] = useState("");
  const [newPin, setNewPin] = useState("");

  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [otpChallenge, setOtpChallenge] = useState<string | null>(null);
  const [otpDest, setOtpDest] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const level = requirement?.level ?? "pin";
  const vendorTier = level === "identity_check";
  const hasPasskey = (status?.passkey_count ?? 0) > 0;

  // How much this decision demands. A medium-risk flag needs one factor;
  // containment release needs the composed substitute. A "passkey" tier with no
  // passkey enrolled escalates to the composed path rather than dead-ending.
  const mode: "single_pin" | "single_passkey" | "composed" =
    level === "pin"
      ? "single_pin"
      : level === "passkey" && hasPasskey
        ? "single_passkey"
        : "composed";

  useEffect(() => {
    securityStatus(userId)
      .then((s) => {
        setStatus(s);
        setChannel(s.phone_set && !s.email_set ? "sms" : "email");
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [userId]);

  const steps: Factor[] =
    mode === "single_pin"
      ? ["pin"]
      : mode === "single_passkey"
        ? ["passkey"]
        : [...(hasPasskey ? (["passkey"] as Factor[]) : []), "pin", "otp"];
  const doneMap: Record<Factor, boolean> = { passkey: !!passkeyToken, pin: !!pinToken, otp: !!otpToken };
  const active = steps.find((s) => !doneMap[s]) ?? null;
  const allDone = steps.every((s) => doneMap[s]);

  /** Compose the collected factors into one release proof, once they're all in
   * hand. Called from whichever handler completes the final factor, rather than
   * from an effect, so state updates stay driven by user actions. */
  async function compose(tokens: { passkey: string | null; pin: string | null; otp: string | null }) {
    const ready = (!hasPasskey || tokens.passkey) && tokens.pin && tokens.otp;
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await composeIdentityCheck({
        userId,
        purpose,
        reference,
        passkeyToken: tokens.passkey,
        pinToken: tokens.pin,
        otpToken: tokens.otp,
      });
      onVerified(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify your identity.");
    } finally {
      setBusy(false);
    }
  }

  async function runPasskey() {
    setBusy(true);
    setError(null);
    try {
      const res = await authenticatePasskey(userId, purpose, reference, mode === "composed" ? "identity_check" : level);
      if (res.token) {
        // A single-passkey tier is satisfied outright; the composed tier folds
        // the passkey in with the other factors.
        if (mode === "single_passkey") {
          onVerified(res.token);
          return;
        }
        setPasskeyToken(res.token);
        await compose({ passkey: res.token, pin: pinToken, otp: otpToken });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Device verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPin() {
    if (pinValue.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyPin({ userId, pin: pinValue, purpose, reference, requiredLevel: mode === "composed" ? "identity_check" : level });
      // A single-PIN tier (a medium-risk flag) is done here — no code needed.
      if (mode === "single_pin") {
        onVerified(res.token);
        return;
      }
      setPinToken(res.token);
      setPinValue("");
      await compose({ passkey: passkeyToken, pin: res.token, otp: otpToken });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That PIN isn't right.");
    } finally {
      setBusy(false);
    }
  }

  async function createPin() {
    if (newPin.length !== 4 && newPin.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const s = await apiSetPin(userId, newPin, null, institutionId);
      setStatus(s);
      setNewPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set your PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await sendOtp({ userId, institutionId, purpose, reference, channel });
      setOtpChallenge(res.challenge_id);
      setOtpDest(res.destination);
      setDebugCode(res.debug_code ?? null);
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
      const res = await verifyOtp({ userId, challengeId: otpChallenge, code: code.trim(), requiredLevel: "pin" });
      setOtpToken(res.token);
      setCode("");
      await compose({ passkey: passkeyToken, pin: pinToken, otp: res.token });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code isn't right.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-[var(--brand-primary)]/20 bg-[var(--brand-primary)]/5 p-3.5">
        <ShieldWarning size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--brand-primary)]" />
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-white/60">
          {vendorTier
            ? "This transfer looked dangerous, so releasing it needs more than your session. Confirm each factor below."
            : requirement?.detail ?? "This release needs extra verification."}
        </p>
      </div>

      {(requirement?.recent_failures ?? 0) > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-white/40">
          <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-red-500" />
          {requirement!.recent_failures} recent failed verification
          {requirement!.recent_failures === 1 ? "" : "s"} on this account.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-[12px] text-gray-500 dark:text-white/40">
          Checking your security setup…
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {steps.map((s) => (
              <FactorRow key={s} factor={s} done={doneMap[s]} active={active === s} channel={channel} />
            ))}
          </div>

          {active === "passkey" && (
            <button
              type="button"
              onClick={runPasskey}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Fingerprint size={18} weight="bold" />
              {busy ? "Waiting for device…" : "Confirm with device unlock"}
            </button>
          )}

          {active === "pin" &&
            (status?.pin_set ? (
              <div className="flex flex-col gap-2.5">
                <input
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && submitPin()}
                  inputMode="numeric"
                  type="password"
                  autoComplete="off"
                  placeholder="Enter your transaction PIN"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-[18px] font-bold tracking-[0.3em] tabular-nums text-gray-900 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
                />
                <button
                  type="button"
                  onClick={submitPin}
                  disabled={busy || pinValue.length < 4}
                  className="rounded-xl bg-[var(--brand-primary)] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Checking…" : "Confirm PIN"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <p className="text-[12px] leading-relaxed text-gray-600 dark:text-white/50">
                  You don&apos;t have a transaction PIN yet. Create one to release this transfer, then re-use it for
                  future verifications.
                </p>
                <input
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  type="password"
                  autoComplete="off"
                  placeholder="Choose a 4 or 6-digit PIN"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-[18px] font-bold tracking-[0.3em] tabular-nums text-gray-900 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
                />
                <button
                  type="button"
                  onClick={createPin}
                  disabled={busy || (newPin.length !== 4 && newPin.length !== 6)}
                  className="rounded-xl bg-[var(--brand-primary)] py-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Set PIN"}
                </button>
              </div>
            ))}

          {active === "otp" && (
            <div className="flex flex-col gap-2.5">
              {!otpChallenge ? (
                <>
                  {status?.phone_set && status?.email_set && (
                    <div className="flex gap-2">
                      {(["email", "sms"] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setChannel(ch)}
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[12px] font-semibold transition-colors ${
                            channel === ch
                              ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
                              : "border-gray-200 text-gray-500 dark:border-white/[0.08] dark:text-white/40"
                          }`}
                        >
                          {ch === "email" ? <EnvelopeSimple size={15} /> : <DeviceMobile size={15} />}
                          {ch === "email" ? "Email" : "SMS"}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={requestCode}
                    disabled={busy}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    {channel === "email" ? <EnvelopeSimple size={17} weight="bold" /> : <DeviceMobile size={17} weight="bold" />}
                    {busy ? "Sending…" : `Send code by ${channel === "email" ? "email" : "SMS"}`}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-gray-600 dark:text-white/50">
                    Code sent to <span className="font-semibold">{otpDest}</span>.
                  </p>
                  {debugCode && (
                    <p className="rounded-lg bg-gray-100 px-3 py-2 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-white/50">
                      No {channel === "sms" ? "SMS provider" : "mail server"} configured, so the code is shown here:{" "}
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
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-[18px] font-bold tracking-[0.3em] tabular-nums text-gray-900 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={submitCode}
                    disabled={busy || code.length < 6}
                    className="rounded-xl bg-[var(--brand-primary)] py-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Checking…" : "Confirm code"}
                  </button>
                </>
              )}
            </div>
          )}

          {allDone && (
            <div className="flex items-center justify-center gap-2 py-2 text-[13px] font-semibold text-emerald-500">
              <CheckCircle size={18} weight="fill" />
              {busy ? "Releasing…" : "Verified"}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function FactorRow({
  factor,
  done,
  active,
  channel,
}: {
  factor: Factor;
  done: boolean;
  active: boolean;
  channel: "email" | "sms";
}) {
  const meta: Record<Factor, { label: string; icon: React.ReactNode }> = {
    passkey: { label: "Device unlock", icon: <Fingerprint size={15} weight="bold" /> },
    pin: { label: "Transaction PIN", icon: <LockKey size={15} weight="bold" /> },
    otp: { label: channel === "sms" ? "SMS code" : "Email code", icon: <EnvelopeSimple size={15} weight="bold" /> },
  };
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
        done
          ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-500"
          : active
            ? "border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/[0.06] text-[var(--brand-primary)]"
            : "border-gray-200 text-gray-400 dark:border-white/[0.06] dark:text-white/30"
      }`}
    >
      {done ? <CheckCircle size={16} weight="fill" /> : meta[factor].icon}
      {meta[factor].label}
      {done && <span className="ml-auto text-[11px] font-semibold">Done</span>}
    </div>
  );
}
