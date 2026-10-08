"use client";

import { useEffect, useState } from "react";
import { Fingerprint, EnvelopeSimple, DeviceMobile, CheckCircle } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PinInput } from "@/components/demo/PinInput";
import { Button, Notice, SuccessTick } from "@/components/app-kit";
import {
  authenticatePasskey,
  sendOtp,
  verifyOtp,
  verifyPin,
  composeIdentityCheck,
  type StepUpRequirement,
} from "@/lib/fable/webauthn";
import {
  newPinLengthOf,
  pinLengthOf,
  securityStatus,
  setPin as apiSetPin,
  type SecurityStatus,
} from "@/lib/fable/api";

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
 * Collects the factors a decision demands and hands back one proof.
 *
 * Releasing money out of a Ghost hold is the single most attacker-valuable
 * action in the product, so it can't be waved through on the session alone. The
 * factors are independent on purpose: a PIN is something known, a passkey is
 * answered by the device's secure element, and a one-time code arrives on a
 * channel the session doesn't control. An attacker who merely holds the tab has
 * none of them.
 *
 * Where the device has an enrolled passkey it is required as the strongest
 * factor; where it doesn't, a PIN plus an out-of-band code stand in.
 */
export function StepUpDialog(props: DialogProps) {
  const { open, onClose, requirement } = props;
  return (
    <DemoSheet open={open} onClose={onClose} title="Verify it's you" subtitle={requirement?.label ?? "Confirm to continue"}>
      {/* Keyed on the reference so each new hold mounts a fresh flow with clean
          state, with no reset-in-effect needed. */}
      {open && <StepUpFlow key={props.reference ?? "flow"} {...props} />}
    </DemoSheet>
  );
}

function StepUpFlow({ onVerified, onClose, requirement, userId, institutionId, purpose, reference }: DialogProps) {
  const { name: bankName } = useInstitution();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passkeyToken, setPasskeyToken] = useState<string | null>(null);
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);

  const [pinValue, setPinValue] = useState("");
  const [pinInvalid, setPinInvalid] = useState(false);
  // Choosing a PIN takes two entries, so a typo is caught before it is saved.
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStage, setPinStage] = useState<"new" | "confirm">("new");

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
    level === "pin" ? "single_pin" : level === "passkey" && hasPasskey ? "single_passkey" : "composed";

  useEffect(() => {
    securityStatus(userId)
      .then((s) => {
        setStatus(s);
        setChannel(s.phone_set && !s.email_set ? "sms" : "email");
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [userId]);

  // Releasing needs TWO independent factors, not three: one primary (the device
  // passkey if enrolled, otherwise the PIN) plus one out-of-band code to the
  // customer's own email or phone. With no registered contact, the out-of-band
  // step is replaced by the PIN, so a passkey customer is never asked for a code
  // that has nowhere to go.
  const hasContact = !!(status?.email_set || status?.phone_set);
  const composedSteps: Factor[] = hasPasskey
    ? hasContact
      ? ["passkey", "otp"]
      : ["passkey", "pin"]
    : hasContact
      ? ["pin", "otp"]
      : ["pin"];
  const steps: Factor[] = mode === "single_pin" ? ["pin"] : mode === "single_passkey" ? ["passkey"] : composedSteps;
  const doneMap: Record<Factor, boolean> = { passkey: !!passkeyToken, pin: !!pinToken, otp: !!otpToken };
  const active = steps.find((s) => !doneMap[s]) ?? null;
  const allDone = steps.every((s) => doneMap[s]);

  /** Compose the collected factors into one proof, once every required step is
   * in hand. Called from whichever handler completes the final factor, rather
   * than from an effect, so state updates stay driven by user actions. */
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

  async function submitPin(pin: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyPin({
        userId,
        pin,
        purpose,
        reference,
        requiredLevel: mode === "composed" ? "identity_check" : level,
      });
      // A single-PIN tier (a medium-risk flag) is done here: no code needed.
      if (mode === "single_pin") {
        onVerified(res.token);
        return;
      }
      setPinToken(res.token);
      setPinValue("");
      await compose({ passkey: passkeyToken, pin: res.token, otp: otpToken });
    } catch (e) {
      // Wrong PIN: shake, clear the boxes, and leave them ready for another try.
      setPinInvalid(true);
      setPinValue("");
      setError(e instanceof Error ? e.message : "That PIN isn't right.");
    } finally {
      setBusy(false);
    }
  }

  async function createPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      const s = await apiSetPin(userId, pin, null, institutionId);
      setStatus(s);
      setNewPin("");
      setConfirmPin("");
      setPinStage("new");
    } catch (e) {
      // The server may refuse a PIN the operator's rules do not allow.
      setError(e instanceof Error ? e.message : "Could not set your PIN.");
      setPinInvalid(true);
      setNewPin("");
      setConfirmPin("");
      setPinStage("new");
    } finally {
      setBusy(false);
    }
  }

  function confirmNewPin(entered: string) {
    if (entered === newPin) {
      void createPin(entered);
      return;
    }
    setError("Those PINs don't match. Try again.");
    setPinInvalid(true);
    setConfirmPin("");
    setNewPin("");
    setPinStage("new");
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

  async function submitCode(entered: string) {
    if (!otpChallenge || entered.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyOtp({ userId, challengeId: otpChallenge, code: entered, requiredLevel: "pin" });
      setOtpToken(res.token);
      setCode("");
      await compose({ passkey: passkeyToken, pin: pinToken, otp: res.token });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code isn't right.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (allDone) {
    return (
      <div className="flex animate-check-pop flex-col items-center gap-2 py-8">
        <SuccessTick size={64} />
        <p className="mt-2 text-[16px] font-bold text-d-text">{busy ? "Verifying…" : "Verified"}</p>
        <p className="text-[13px] text-d-muted">{busy ? "Sending your transfer securely." : "You're all set."}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-[13px] text-d-muted">Checking your security…</div>;
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-[13px] leading-relaxed text-d-muted">
        {mode === "composed"
          ? "A quick two-step check before this transfer leaves your account."
          : (requirement?.detail ?? "Confirm it's really you.")}
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

      {active === "passkey" && (
        <Button size="lg" full loading={busy} onClick={runPasskey} icon={<Fingerprint size={18} weight="bold" />}>
          {busy ? "Waiting for your device…" : "Confirm with fingerprint or face"}
        </Button>
      )}

      {active === "pin" &&
        (status?.pin_set ? (
          <div className="flex flex-col items-center gap-4">
            <PinInput
              length={pinLengthOf(status)}
              value={pinValue}
              onChange={(v) => {
                setPinInvalid(false);
                setPinValue(v);
              }}
              onComplete={(v) => void submitPin(v)}
              label="Enter your PIN"
              autoFocus
              disabled={busy}
              invalid={pinInvalid}
            />
            {busy && <p className="text-[12px] text-d-muted">Checking...</p>}
            <p className="text-center text-[12px] text-d-faint">
              Forgot your PIN? Ask {bankName} to reset it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-[13px] leading-relaxed text-d-muted">
              {pinStage === "new"
                ? `Choose a ${newPinLengthOf(status)}-digit transaction PIN. You will use it again next time.`
                : "Enter it once more to confirm."}
            </p>
            {pinStage === "new" ? (
              <PinInput
                key="new"
                length={newPinLengthOf(status)}
                value={newPin}
                onChange={(v) => {
                  setPinInvalid(false);
                  setNewPin(v);
                }}
                onComplete={() => setPinStage("confirm")}
                label="Choose a PIN"
                autoFocus
                invalid={pinInvalid}
              />
            ) : (
              <>
                <PinInput
                  key="confirm"
                  length={newPinLengthOf(status)}
                  value={confirmPin}
                  onChange={(v) => {
                    setPinInvalid(false);
                    setConfirmPin(v);
                  }}
                  onComplete={confirmNewPin}
                  label="Confirm your PIN"
                  autoFocus
                  disabled={busy}
                  invalid={pinInvalid}
                />
                <button
                  type="button"
                  onClick={() => {
                    setConfirmPin("");
                    setNewPin("");
                    setPinStage("new");
                  }}
                  className="text-[12px] font-semibold text-brand hover:underline"
                >
                  Start again
                </button>
              </>
            )}
          </div>
        ))}

      {active === "otp" && (
        <div className="flex flex-col gap-3">
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
                      className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-[12px] font-semibold transition-colors ${
                        channel === ch ? "border-brand bg-brand/10 text-brand" : "border-d-border text-d-muted"
                      }`}
                    >
                      {ch === "email" ? <EnvelopeSimple size={15} /> : <DeviceMobile size={15} />}
                      {ch === "email" ? "Email" : "SMS"}
                    </button>
                  ))}
                </div>
              )}
              <Button
                size="lg"
                full
                loading={busy}
                onClick={requestCode}
                icon={channel === "email" ? <EnvelopeSimple size={17} weight="bold" /> : <DeviceMobile size={17} weight="bold" />}
              >
                {busy ? "Sending…" : `Send a code by ${channel === "email" ? "email" : "SMS"}`}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13px] text-d-muted">
                Code sent to <span className="font-semibold text-d-text">{otpDest}</span>.
              </p>
              {debugCode && (
                <Notice>
                  No {channel === "sms" ? "SMS provider" : "mail server"} is configured, so the code is shown here:{" "}
                  <span className="font-mono font-bold">{debugCode}</span>
                </Notice>
              )}
              <PinInput
                length={6}
                value={code}
                onChange={setCode}
                onComplete={(v) => void submitCode(v)}
                label="6-digit code"
                masked={false}
                autoFocus
                disabled={busy}
              />
              {busy && <p className="text-center text-[12px] text-d-muted">Checking...</p>}
            </>
          )}
        </div>
      )}

      {(requirement?.recent_failures ?? 0) > 0 && (
        <p className="text-center text-[12px] text-d-faint">
          {requirement!.recent_failures} recent failed attempt{requirement!.recent_failures === 1 ? "" : "s"} on this account.
        </p>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <button type="button" onClick={onClose} className="text-center text-[12px] font-semibold text-d-muted hover:text-d-text">
        Cancel
      </button>
    </div>
  );
}

function factorLabel(factor: Factor, channel: "email" | "sms"): string {
  if (factor === "passkey") return "Device";
  if (factor === "pin") return "PIN";
  return channel === "sms" ? "SMS code" : "Email code";
}

/** A small labelled progress dot with an optional connector: the whole
 * multi-factor flow at a glance. */
function StepDot({ label, state, connect }: { label: string; state: "done" | "active" | "todo"; connect: boolean }) {
  return (
    <div className="flex items-center">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`flex size-7 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
            state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-brand text-white" : "bg-d-surface-2 text-d-faint"
          }`}
        >
          {state === "done" ? <CheckCircle size={14} weight="fill" /> : "•"}
        </span>
        <span className={`text-[11px] font-medium ${state === "todo" ? "text-d-faint" : "text-d-muted"}`}>{label}</span>
      </div>
      {connect && <span className="mx-2 mb-4 h-px w-8 bg-d-border" />}
    </div>
  );
}
