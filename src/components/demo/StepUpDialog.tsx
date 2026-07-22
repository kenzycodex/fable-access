"use client";

import { useEffect, useState } from "react";
import { Fingerprint, EnvelopeSimple, DeviceMobile, CheckCircle } from "@phosphor-icons/react";
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

  // Releasing needs TWO independent factors, not three. One "primary" — the
  // device passkey if enrolled, otherwise the PIN — plus one out-of-band code
  // to the customer's own email/phone. When there's no registered contact, the
  // out-of-band step is replaced by the PIN, so a passkey+PIN customer never
  // gets asked for a code that has nowhere to go.
  const hasContact = !!(status?.email_set || status?.phone_set);
  const composedSteps: Factor[] = hasPasskey
    ? hasContact
      ? ["passkey", "otp"]
      : ["passkey", "pin"]
    : hasContact
      ? ["pin", "otp"]
      : ["pin"]; // only a PIN and no contact — the one factor available
  const steps: Factor[] =
    mode === "single_pin" ? ["pin"] : mode === "single_passkey" ? ["passkey"] : composedSteps;
  const doneMap: Record<Factor, boolean> = { passkey: !!passkeyToken, pin: !!pinToken, otp: !!otpToken };
  const active = steps.find((s) => !doneMap[s]) ?? null;
  const allDone = steps.every((s) => doneMap[s]);

  /** Compose the collected factors into one release proof, once every required
   * step is in hand. Called from whichever handler completes the final factor,
   * rather than from an effect, so state updates stay driven by user actions. */
  async function compose(tokens: { passkey: string | null; pin: string | null; otp: string | null }) {
    const ready = steps.every((s) => tokens[s]);
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

  // Success: a clean tick, echoing the connect modal — the calm end state.
  if (allDone) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 animate-check-pop">
        <VerifyTick />
        <p className="text-[15px] font-bold text-gray-900 dark:text-white">{busy ? "Verifying…" : "Verified"}</p>
        <p className="text-[12px] text-gray-500 dark:text-white/40">
          {busy ? "Sending your transfer securely." : "You're all set."}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-[12px] text-gray-500 dark:text-white/40">
        Checking your security…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One calm line, no alarm. */}
      <p className="text-[12px] leading-relaxed text-gray-500 dark:text-white/45">
        {mode === "composed"
          ? "A quick two-step check before this transfer leaves your account."
          : requirement?.detail ?? "Confirm it's really you."}
      </p>

      {/* Compact progress, only when there's more than one factor. */}
      {steps.length > 1 && (
        <div className="flex items-center">
          {steps.map((s, i) => (
            <StepDot
              key={s}
              label={factorLabel(s, channel)}
              state={doneMap[s] ? "done" : active === s ? "active" : "todo"}
              connect={i < steps.length - 1}
            />
          ))}
        </div>
      )}

      {/* The one factor in focus. */}
      {active === "passkey" && (
        <button
          type="button"
          onClick={runPasskey}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Fingerprint size={18} weight="bold" />
          {busy ? "Waiting for device…" : "Confirm with fingerprint or face"}
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
              autoFocus
              placeholder="Enter your PIN"
              className={pinInputCls}
            />
            <button type="button" onClick={submitPin} disabled={busy || pinValue.length < 4} className={primaryBtnCls}>
              {busy ? "Checking…" : "Confirm"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12px] leading-relaxed text-gray-500 dark:text-white/45">
              Set a transaction PIN to continue. You&apos;ll re-use it next time.
            </p>
            <input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Choose a 4 or 6-digit PIN"
              className={pinInputCls}
            />
            <button type="button" onClick={createPin} disabled={busy || (newPin.length !== 4 && newPin.length !== 6)} className={primaryBtnCls}>
              {busy ? "Saving…" : "Set PIN"}
            </button>
          </div>
        ))}

      {active === "otp" && (
        <div className="flex flex-col gap-2.5">
          {!otpChallenge ? (
            <>
              {/* Offer the channels the customer actually has. */}
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
              <button type="button" onClick={requestCode} disabled={busy} className={`flex items-center justify-center gap-2 ${primaryBtnCls}`}>
                {channel === "email" ? <EnvelopeSimple size={17} weight="bold" /> : <DeviceMobile size={17} weight="bold" />}
                {busy ? "Sending…" : `Send a code by ${channel === "email" ? "email" : "SMS"}`}
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] text-gray-500 dark:text-white/45">
                Code sent to <span className="font-semibold text-gray-700 dark:text-white/70">{otpDest}</span>.
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
                autoFocus
                placeholder="6-digit code"
                className={pinInputCls}
              />
              <button type="button" onClick={submitCode} disabled={busy || code.length < 6} className={primaryBtnCls}>
                {busy ? "Checking…" : "Confirm"}
              </button>
            </>
          )}
        </div>
      )}

      {(requirement?.recent_failures ?? 0) > 0 && (
        <p className="text-center text-[11px] text-gray-400 dark:text-white/30">
          {requirement!.recent_failures} recent failed attempt{requirement!.recent_failures === 1 ? "" : "s"} on this account.
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

const pinInputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-[18px] font-bold tracking-[0.3em] tabular-nums text-gray-900 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white";
const primaryBtnCls =
  "rounded-xl bg-[var(--brand-primary)] py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

function factorLabel(factor: Factor, channel: "email" | "sms"): string {
  if (factor === "passkey") return "Device";
  if (factor === "pin") return "PIN";
  return channel === "sms" ? "SMS code" : "Email code";
}

/** A small labelled progress dot with an optional connector — the whole
 * multi-factor flow at a glance, without the boxy checklist. */
function StepDot({ label, state, connect }: { label: string; state: "done" | "active" | "todo"; connect: boolean }) {
  return (
    <div className="flex items-center">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`flex size-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
            state === "done"
              ? "bg-emerald-500 text-white"
              : state === "active"
                ? "bg-[var(--brand-primary)] text-white"
                : "bg-gray-200 text-gray-400 dark:bg-white/[0.08] dark:text-white/30"
          }`}
        >
          {state === "done" ? <CheckCircle size={13} weight="fill" /> : "•"}
        </span>
        <span
          className={`text-[10px] font-medium ${
            state === "todo" ? "text-gray-400 dark:text-white/30" : "text-gray-600 dark:text-white/55"
          }`}
        >
          {label}
        </span>
      </div>
      {connect && <span className="mx-1.5 mb-4 h-px w-6 bg-gray-200 dark:bg-white/[0.08]" />}
    </div>
  );
}

/** Ring sweeps, then the tick strokes itself in — matched to the connect modal. */
function VerifyTick() {
  return (
    <svg viewBox="0 0 64 64" className="size-14" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="27" className="stroke-emerald-500/15" strokeWidth="4" />
      <circle cx="32" cy="32" r="27" className="stroke-emerald-500 animate-check-ring" strokeWidth="4" strokeLinecap="round" />
      <path d="M21 33.5 L28.5 41 L43 25" className="stroke-emerald-500 animate-check-stroke" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
