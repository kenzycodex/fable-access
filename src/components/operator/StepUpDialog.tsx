"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Password, ShieldCheck } from "@phosphor-icons/react";
import { Dialog } from "@/components/dashboard/Dialog";
import { Button, Notice } from "@/components/dashboard/primitives";
import { stepUpOptions, type StepUp, type StepUpOptions } from "@/lib/fable/operator";
import { getPasskeyAssertion } from "@/lib/fable/webauthn";

/**
 * A key action's dialog: the form, then one fresh factor to confirm it.
 * A passkey is offered first when the operator has one; an authenticator
 * code always works. The factor is requested only when they confirm, so a
 * passkey challenge never sits open while they type.
 */
export function StepUpDialog({
  open,
  onClose,
  title,
  description,
  children,
  ready = true,
  danger = false,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  ready?: boolean;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: (stepUp: StepUp) => Promise<void>;
}) {
  const [options, setOptions] = useState<StepUpOptions | null>(null);
  const [mode, setMode] = useState<"passkey" | "code">("passkey");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The factors this operator has, fetched each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    stepUpOptions()
      .then((o) => {
        if (!live) return;
        setOptions(o);
        setMode(o.passkey ? "passkey" : "code");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not start verification."));
    return () => {
      live = false;
    };
  }, [open]);

  function close() {
    setOptions(null);
    setCode("");
    setError("");
    onClose();
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      let stepUp: StepUp;
      if (mode === "passkey" && options?.passkey) {
        const credential = await getPasskeyAssertion(options.passkey.options);
        stepUp = { challenge_id: options.passkey.challenge_id, passkey: credential };
      } else {
        stepUp = { code };
      }
      await onConfirm(stepUp);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      // A passkey challenge is single-use; fetch a fresh one for the next try.
      stepUpOptions().then(setOptions).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const locked = options?.locked_until;
  const canConfirm = ready && !busy && !locked && (mode === "passkey" ? Boolean(options?.passkey) : code.length === 6);

  return (
    <Dialog open={open} onClose={close} title={title} description={description} size="sm"
      footer={<>
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={!canConfirm} onClick={confirm}
          icon={mode === "passkey" ? <Fingerprint size={16} /> : <ShieldCheck size={16} />}>
          {mode === "passkey" ? `${confirmLabel} with passkey` : confirmLabel}
        </Button>
      </>}>
      <div className="flex flex-col gap-4">
        {children}
        <div className="rounded-xl border border-d-border bg-d-surface-2/50 p-3.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-d-faint">
            <ShieldCheck size={13} weight="fill" /> Confirm it&apos;s you
          </p>
          {locked ? (
            <p className="mt-2 text-[13px] text-red-600 dark:text-red-400">
              Key actions are locked after repeated failed verifications. Try again after the lock ends.
            </p>
          ) : !options ? (
            <p className="mt-2 text-[13px] text-d-muted">Checking your factors...</p>
          ) : mode === "passkey" && options.passkey ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <p className="text-[13px] text-d-text">Your device will ask for your fingerprint, face or screen lock.</p>
              {options.totp && (
                <button type="button" onClick={() => setMode("code")} className="w-fit text-[12px] font-semibold text-brand hover:underline">
                  Use an authenticator code instead
                </button>
              )}
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              <label className="flex h-11 items-center gap-2 rounded-xl border border-d-border bg-d-surface px-3 focus-within:border-brand/50">
                <Password size={16} className="text-d-faint" />
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" aria-label="Authenticator code"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[16px] tracking-[0.3em] text-d-text outline-none placeholder:tracking-normal placeholder:text-d-faint" />
              </label>
              {options.passkey && (
                <button type="button" onClick={() => setMode("passkey")} className="w-fit text-[12px] font-semibold text-brand hover:underline">
                  Use my passkey instead
                </button>
              )}
            </div>
          )}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
