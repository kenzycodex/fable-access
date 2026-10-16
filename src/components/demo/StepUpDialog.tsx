"use client";

import { useEffect, useState } from "react";
import { Fingerprint, EnvelopeSimple, CheckCircle } from "@phosphor-icons/react";
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
  type StepUpFactor,
  type StepUpPurpose,
  type StepUpRequirement,
} from "@/lib/fable/webauthn";
import {
  newPinLengthOf,
  pinLengthOf,
  securityStatus,
  setPin as apiSetPin,
  type SecurityStatus,
} from "@/lib/fable/api";

type Factor = StepUpFactor;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  requirement: StepUpRequirement | null;
  userId: string;
  institutionId: string | null;
  purpose: StepUpPurpose;
  reference: string | null;
}

/**
 * Collects the factors a decision demands and hands back one proof.
 *
 * Which factors, and in what order, is the server's call: the requirement
 * carries `steps`, worked out from Fable's stored decision and from the
 * factors this customer had in place (a factor set up after money was held
 * never releases it). The dialog only collects them. One step hands its
 * token straight back; several are combined by the server into one proof
 * whose level is exactly what they add up to.
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

/** The steps for an older API that does not send them: the same rules the
 * server now applies, so the dialog still works against it. */
function fallbackSteps(level: string, status: SecurityStatus | null): Factor[] | null {
  const hasPasskey = (status?.passkey_count ?? 0) > 0;
  const hasEmail = !!status?.email_set;
  const hasPin = !!status?.pin_set;
  if (level === "none") return [];
  if (level === "pin") return hasPin ? ["pin"] : hasEmail ? ["otp"] : hasPasskey ? ["passkey"] : ["pin"];
  if (level === "passkey") return hasPasskey ? ["passkey"] : hasPin && hasEmail ? ["pin", "otp"] : null;
  if (level === "passkey_and_otp") {
    if (hasPasskey && hasEmail) return ["passkey", "otp"];
    return !hasPasskey && hasPin && hasEmail ? ["pin", "otp"] : null;
  }
  if (level === "identity_check") return hasPasskey && hasPin && hasEmail ? ["passkey", "pin", "otp"] : null;
  return null;
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

  const [otpChallenge, setOtpChallenge] = useState<string | null>(null);
  const [otpDest, setOtpDest] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const level = requirement?.level ?? "pin";

  useEffect(() => {
    securityStatus(userId)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [userId]);

  const steps: Factor[] | null =
    requirement?.steps !== undefined ? (requirement.steps ?? null) : fallbackSteps(level, status);
  const doneMap: Record<Factor, boolean> = { passkey: !!passkeyToken, pin: !!pinToken, otp: !!otpToken };
  const active = steps?.find((s) => !doneMap[s]) ?? null;
  const allDone = !!steps && steps.length > 0 && steps.every((s) => doneMap[s]);

  /** Hand back the proof once every step is in hand: a single factor's token
   * as it is, several combined by the server into one. */
  async function finish(tokens: Record<Factor, string | null>) {
    if (!steps || !steps.every((s) => tokens[s])) return;
    if (steps.length === 1) {
      onVerified(tokens[steps[0]] as string);
      return;
    }
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
      setError(e instanceof Error ? e.message : "Could not verify that it's you.");
    } finally {
      setBusy(false);
    }
  }

  async function runPasskey() {
    setBusy(true);
    setError(null);
    try {
      const res = await authenticatePasskey(userId, purpose, reference, level);
      const token = res.token ?? res.passkey_token ?? null;
      if (token) {
        setPasskeyToken(token);
        await finish({ passkey: token, pin: pinToken, otp: otpToken });
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
      const res = await verifyPin({ userId, pin, purpose, reference });
      setPinToken(res.token);
      setPinValue("");
      await finish({ passkey: passkeyToken, pin: res.token, otp: otpToken });
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
      const res = await sendOtp({ userId, institutionId, purpose, reference });
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
      const res = await verifyOtp({ userId, challengeId: otpChallenge, code: entered });
      setOtpToken(res.token);
      setCode("");
      await finish({ passkey: passkeyToken, pin: pinToken, otp: res.token });
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

  if (!steps) {
    // Nothing the customer had in place reaches this level. Say so plainly and
    // leave the safe action open, rather than offering a flow that must fail.
    return (
      <div className="flex flex-col gap-4 pb-2">
        <Notice tone="warning">
          {purpose === "ghost_release"
            ? "This transfer can't be released with the verification you had set up before it was held. You can cancel it and get your money back, then set up your PIN, email and device in Security before trying again."
            : "This needs verification you haven't set up yet. Set up your PIN, email and device in Security, then try again."}
        </Notice>
        <Button size="lg" full onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-[13px] leading-relaxed text-d-muted">
        {steps.length > 1
          ? `A ${steps.length}-step check before this goes ahead.`
          : (requirement?.detail ?? "Confirm it's really you.")}
      </p>

      {/* Compact progress, only when there's more than one factor. */}
      {steps.length > 1 && (
        <div className="flex items-center">
          {steps.map((s, i) => (
            <StepDot
              key={s}
              label={factorLabel(s)}
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
            <Button
              size="lg"
              full
              loading={busy}
              onClick={requestCode}
              icon={<EnvelopeSimple size={17} weight="bold" />}
            >
              {busy ? "Sending…" : "Send a code to my email"}
            </Button>
          ) : (
            <>
              <p className="text-[13px] text-d-muted">
                Code sent to <span className="font-semibold text-d-text">{otpDest}</span>.
              </p>
              {debugCode && (
                <Notice>
                  No mail server is configured, so the code is shown here:{" "}
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

function factorLabel(factor: Factor): string {
  if (factor === "passkey") return "Device";
  if (factor === "pin") return "PIN";
  return "Email code";
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
