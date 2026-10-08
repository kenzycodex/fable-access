"use client";

import { useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { Button, Field, Notice, inputClass } from "@/components/demo/kit";
import { resetPin, type SecurityStatus } from "@/lib/fable/api";
import { sendOtp, verifyOtp } from "@/lib/fable/webauthn";

type Step = "send" | "code" | "choose";

const pinInput = `${inputClass} text-center text-[18px] font-bold tracking-[0.3em] tabular-nums`;

/**
 * Forgotten PIN: prove the registered channel, then choose a new one.
 *
 * The proof is a code sent to the address the customer registered in Security,
 * which someone merely holding their session does not control. That is why this
 * is safe to offer without asking for the old PIN. A customer who never
 * registered a channel cannot use it, and is told to ask their bank instead.
 */
export function PinReset({
  userId,
  institutionId,
  status,
  bankName,
  onDone,
  onCancel,
}: {
  userId: string;
  institutionId: string | null;
  status: SecurityStatus | null;
  bankName: string;
  onDone: (status: SecurityStatus) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("send");
  const [channel, setChannel] = useState<"email" | "sms">(status?.email_set ? "email" : "sms");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChannel = !!(status?.email_set || status?.phone_set);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasChannel) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning">
          You haven&apos;t registered an email or phone number to receive codes, so we can&apos;t confirm it&apos;s you
          here. Ask {bankName} to reset your PIN, then choose a new one.
        </Notice>
        <Button variant="secondary" full onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {step === "send" && (
        <>
          <p className="text-[13px] leading-relaxed text-d-muted">
            We&apos;ll send a code to the {channel === "email" ? "email address" : "phone number"} you registered
            {channel === "email" && status?.contact_email ? ` (${status.contact_email})` : ""}
            {channel === "sms" && status?.contact_phone ? ` (${status.contact_phone})` : ""}.
          </p>
          {status?.email_set && status?.phone_set && (
            <div className="flex gap-2">
              {(["email", "sms"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={`h-10 flex-1 rounded-xl border text-[12px] font-semibold transition-colors ${
                    channel === c ? "border-brand bg-brand/10 text-brand" : "border-d-border text-d-muted"
                  }`}
                >
                  {c === "email" ? "Email" : "SMS"}
                </button>
              ))}
            </div>
          )}
          <Button
            full
            loading={busy}
            icon={<EnvelopeSimple size={17} weight="bold" />}
            onClick={() =>
              run(async () => {
                const res = await sendOtp({ userId, institutionId, purpose: "pin_reset", reference: null, channel });
                setChallengeId(res.challenge_id);
                setDestination(res.destination);
                setDebugCode(res.debug_code ?? null);
                setStep("code");
              })
            }
          >
            Send me a code
          </Button>
        </>
      )}

      {step === "code" && (
        <>
          <p className="text-[13px] text-d-muted">
            Code sent to <span className="font-semibold text-d-text">{destination}</span>.
          </p>
          {debugCode && (
            <Notice>
              No mail server is configured, so the code is shown here:{" "}
              <span className="font-mono font-bold">{debugCode}</span>
            </Notice>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="6-digit code"
            aria-label="6-digit code"
            className={pinInput}
          />
          <Button
            full
            loading={busy}
            disabled={code.length < 6}
            onClick={() =>
              run(async () => {
                const res = await verifyOtp({ userId, challengeId: challengeId!, code, requiredLevel: "pin" });
                setOtpToken(res.token);
                setStep("choose");
              })
            }
          >
            Confirm code
          </Button>
        </>
      )}

      {step === "choose" && (
        <>
          <p className="text-[13px] text-d-muted">Choose a new 4 or 6 digit PIN. Any digits you like.</p>
          <Field label="New PIN">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="4 or 6 digits"
              aria-label="New PIN"
              className={pinInput}
            />
          </Field>
          <Field label="Confirm PIN" error={confirm && confirm !== pin ? "The PINs don't match." : null}>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Repeat PIN"
              aria-label="Confirm PIN"
              className={pinInput}
            />
          </Field>
          <Button
            full
            loading={busy}
            disabled={(pin.length !== 4 && pin.length !== 6) || pin !== confirm}
            onClick={() =>
              run(async () => {
                const next = await resetPin(userId, pin, otpToken!, institutionId);
                onDone(next);
              })
            }
          >
            Save new PIN
          </Button>
        </>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <button type="button" onClick={onCancel} className="text-center text-[12px] font-semibold text-d-muted hover:text-d-text">
        Cancel
      </button>
    </div>
  );
}
