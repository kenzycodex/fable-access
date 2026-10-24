"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  DeviceMobile,
  EnvelopeSimple,
  Fingerprint,
  LockKey,
  MapPin,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import { PinInput } from "@/components/demo/PinInput";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DetailRow,
  Notice,
  Screen,
  Skeleton,
  Toggle,
  inputClass,
} from "@/components/app-kit";
import {
  confirmContact,
  newPinLengthOf,
  pinLengthOf,
  securityStatus,
  setPin as apiSetPin,
  setContact as apiSetContact,
  setLocationSharing as apiSetLocationSharing,
  setTwoFactor as apiSetTwoFactor,
  type ContactVerification,
  type SecurityStatus,
} from "@/lib/fable/api";
import {
  PasskeyError,
  registerPasskey,
  passkeySupported,
  stepUpRequirement,
  type StepUpRequirement,
} from "@/lib/fable/webauthn";
import { StepUpDialog } from "@/components/demo/StepUpDialog";
import { SandboxCode } from "@/components/demo/SandboxCode";
import { useCopilotBaseline } from "@/lib/fable/useBackend";

const CHANNEL_NAMES: Record<string, string> = {
  mobile_app: "Mobile app",
  ussd: "USSD",
  internet: "Web",
  pos: "POS",
  atm: "ATM",
};

const HOW_WE_VERIFY = [
  { title: "Your PIN", body: "For a transfer that looks slightly unusual." },
  { title: "Your fingerprint or face", body: "When more looks off, such as a new device or place." },
  { title: "A code plus your device", body: "For a risky transfer, and to release money that was held." },
];

export default function SecurityPage() {
  const { customer, institutionId, name: bankName } = useInstitution();
  const { data: baseline } = useCopilotBaseline(customer?.user_id);

  return (
    <Screen>
      <PageHeader title="Security" subtitle="How we verify it's you, and what we learn" back />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: the things you can change, then what we do with your data. */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          <VerificationSetup
            userId={customer?.user_id ?? null}
            displayName={customer?.name ?? "Customer"}
            institutionId={institutionId}
            bankName={bankName}
          />

          <Card>
            <CardHeader title="Your data" />
            <ul className="flex flex-col gap-3 text-[13px] leading-relaxed text-d-muted">
              <Fact>
                To tell your transfers from a scammer&apos;s, Fable uses your transfer details, your device, your
                approximate location, and how you type and pace a transfer.
              </Fact>
              <Fact>Your PIN is stored only as a salted hash, so nobody can read it back.</Fact>
              <Fact>Your passkey&apos;s private key stays on your device. We hold only the public key.</Fact>
              <Fact>Your data is never sold.</Fact>
            </ul>
            <Link href="/privacy" className="mt-4 inline-block text-[12px] font-semibold text-brand hover:underline">
              Read the privacy notice
            </Link>
          </Card>
        </div>

        {/* Right: what the system knows, and how it decides to ask you. */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card>
            <CardHeader title="What Fable has learned" subtitle="Each transfer is compared against this" />
            {baseline ? (
              <div className="divide-y divide-d-border">
                <DetailRow label="Typical transfer">{baseline.typical_transfer_range}</DetailRow>
                <DetailRow label="Usual hours">{baseline.active_hours}</DetailRow>
                <DetailRow label="Trusted recipients">{baseline.trusted_recipients_count}</DetailRow>
                <DetailRow label="Known devices">{baseline.known_devices_count}</DetailRow>
                <DetailRow label="Usual channel">
                  {CHANNEL_NAMES[baseline.preferred_channel] ?? baseline.preferred_channel}
                </DetailRow>
              </div>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="How we verify you" subtitle="The more unusual a transfer, the more we ask" />
            <ol className="flex flex-col gap-4">
              {HOW_WE_VERIFY.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/12 text-[12px] font-bold text-brand">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold text-d-text">{step.title}</p>
                    <p className="text-[12px] leading-relaxed text-d-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[12px] leading-relaxed text-d-faint">
              A transfer that matches how you normally bank goes through with no extra step at all.
            </p>
          </Card>
        </div>
      </div>
    </Screen>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <ShieldCheck size={16} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />
      <span>{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Verification setup: the real, backend-wired factors a customer controls.
// These are exactly what Shield and Ghost ask for when a transfer is held.
// ---------------------------------------------------------------------------

function VerificationSetup({
  userId,
  displayName,
  institutionId,
  bankName,
}: {
  userId: string | null;
  displayName: string;
  institutionId: string | null;
  bankName: string;
}) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [supported, setSupported] = useState(false);

  const refresh = useCallback(() => {
    if (!userId) return;
    securityStatus(userId).then(setStatus).catch(() => setStatus(null));
  }, [userId]);

  useEffect(() => {
    refresh();
    void passkeySupported().then(setSupported);
  }, [refresh]);

  if (!userId) {
    return (
      <Card>
        <p className="text-[13px] text-d-muted">Pick a customer to manage their verification.</p>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="flex items-center gap-3.5 px-5 pb-3 pt-5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand">
          <LockKey size={20} weight="fill" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-d-text">Verification</h2>
          <p className="text-[12px] text-d-muted">Used when a transfer is held for review</p>
        </div>
      </div>

      <div className="divide-y divide-d-border">
        <PinRow status={status} userId={userId} institutionId={institutionId} bankName={bankName} onDone={refresh} />
        <ContactRow status={status} userId={userId} institutionId={institutionId} onDone={refresh} />
        <PasskeyRow
          status={status}
          userId={userId}
          displayName={displayName}
          institutionId={institutionId}
          supported={supported}
          onDone={refresh}
        />
        <TwoFactorRow status={status} userId={userId} institutionId={institutionId} onDone={refresh} />
        <LocationRow status={status} userId={userId} institutionId={institutionId} onDone={refresh} />
      </div>
    </Card>
  );
}

function RowShell({
  icon,
  title,
  description,
  state,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  state: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-d-surface-2 text-d-muted">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-d-text">{title}</p>
          {description && <p className="text-[12px] text-d-muted">{description}</p>}
        </div>
        <div className="shrink-0">{state}</div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function StatePill({ ok, okText, offText }: { ok: boolean; okText: string; offText: string }) {
  return ok ? (
    <Badge tone="success">
      <CheckCircle size={12} weight="fill" /> {okText}
    </Badge>
  ) : (
    <Badge>{offText}</Badge>
  );
}

function LinkButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[12px] font-semibold text-brand hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // A message that is not a failure: something already fine, or a prompt the
  // customer dismissed. Shown calmly, not in red.
  const [note, setNote] = useState<{ tone: "success" | "neutral"; text: string } | null>(null);

  /** Run an action. `onSoft` runs when it ends in a non-error PasskeyError, for
   * example to refresh state when the device turns out to be added already. */
  const run = useCallback(async (fn: () => Promise<void>, okMsg: string, onSoft?: () => void) => {
    setBusy(true);
    setError(null);
    setOk(null);
    setNote(null);
    try {
      await fn();
      setOk(okMsg);
    } catch (e) {
      if (e instanceof PasskeyError && e.tone !== "error") {
        setNote({ tone: e.tone, text: e.message });
        onSoft?.();
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, ok, note, run };
}

function Feedback({
  error,
  ok,
  note,
}: {
  error: string | null;
  ok: string | null;
  note?: { tone: "success" | "neutral"; text: string } | null;
}) {
  if (error) return <Notice tone="danger" className="mt-3">{error}</Notice>;
  if (note) return <Notice tone={note.tone === "success" ? "success" : "neutral"} className="mt-3">{note.text}</Notice>;
  if (ok) return <Notice tone="success" className="mt-3">{ok}</Notice>;
  return null;
}

/** A labelled PIN field, centred, for the confirm-with-your-PIN steps. */
function PinField({
  label,
  length,
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
}: {
  label: string;
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[12px] font-semibold text-d-muted">{label}</p>
      <PinInput
        length={length}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        label={label}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * How a security change proves it is the customer. With a PIN, the PIN. With
 * no PIN but another factor (a device or a confirmed email), a quick check
 * with that factor. With nothing set up yet, nothing: the first factor is
 * free to add, and factors added that way never release money already held.
 */
type GateKind = "none" | "pin" | "token";

function gateKind(status: SecurityStatus | null): GateKind {
  if (status?.pin_set) return "pin";
  if (status?.email_set || (status?.passkey_count ?? 0) > 0) return "token";
  return "none";
}

function TokenGate({
  userId,
  institutionId,
  token,
  onToken,
}: {
  userId: string;
  institutionId: string | null;
  token: string | null;
  onToken: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [requirement, setRequirement] = useState<StepUpRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      setRequirement(await stepUpRequirement({ userId, purpose: "security_change" }));
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start verification.");
    }
  }

  if (token) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-emerald-600">
        <CheckCircle size={14} weight="fill" /> Verified
      </p>
    );
  }
  return (
    <>
      <Button variant="secondary" full onClick={start}>
        Verify it&apos;s you first
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
      <StepUpDialog
        open={open}
        onClose={() => setOpen(false)}
        onVerified={(t) => {
          setOpen(false);
          onToken(t);
        }}
        requirement={requirement}
        userId={userId}
        institutionId={institutionId}
        purpose="security_change"
        reference={null}
      />
    </>
  );
}

function PinRow({
  status,
  userId,
  institutionId,
  bankName,
  onDone,
}: {
  status: SecurityStatus | null;
  userId: string;
  institutionId: string | null;
  bankName: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const { busy, error, ok, run } = useAction();

  const isSet = !!status?.pin_set;
  const gate = gateKind(status);
  const newLength = newPinLengthOf(status);
  const currentLength = pinLengthOf(status);

  const proved = isSet ? current.length === currentLength : gate === "token" ? !!token : true;
  const ready = pin.length === newLength && confirm === pin && proved;

  function close() {
    setOpen(false);
    setCurrent("");
    setPin("");
    setConfirm("");
    setToken(null);
  }

  function save() {
    void run(async () => {
      await apiSetPin(userId, pin, isSet ? current : null, institutionId, token);
      close();
      onDone();
    }, "PIN saved. We've let you know by email.");
  }

  return (
    <RowShell
      icon={<LockKey size={18} weight="bold" />}
      title="Transaction PIN"
      description={status?.pin_locked ? "Locked after too many wrong attempts" : "Confirms transfers Shield wants to double-check"}
      state={
        <div className="flex items-center gap-3">
          <StatePill ok={isSet} okText="Set" offText="Not set" />
          <LinkButton onClick={() => (open ? close() : setOpen(true))}>{open ? "Close" : isSet ? "Change" : "Set up"}</LinkButton>
        </div>
      }
    >
      {open && (
        <div className="flex flex-col gap-5 rounded-2xl bg-d-surface-2/60 p-4">
          {isSet && <PinField label="Current PIN" length={currentLength} value={current} onChange={setCurrent} autoFocus />}
          {!isSet && gate === "token" && (
            <TokenGate userId={userId} institutionId={institutionId} token={token} onToken={setToken} />
          )}
          <PinField label={isSet ? "New PIN" : "Choose a PIN"} length={newLength} value={pin} onChange={setPin} autoFocus={!isSet && gate === "none"} />
          <PinField label="Confirm PIN" length={newLength} value={confirm} onChange={setConfirm} />
          {confirm.length === newLength && confirm !== pin && (
            <p className="text-center text-[12px] text-red-500" role="alert">The PINs don&apos;t match.</p>
          )}
          <Button full loading={busy} disabled={!ready} onClick={save}>
            Save PIN
          </Button>
          {isSet && (
            <p className="text-center text-[12px] text-d-faint">Forgot your PIN? Ask {bankName} to reset it.</p>
          )}
          <Feedback error={error} ok={ok} />
        </div>
      )}
      {!open && <Feedback error={null} ok={ok} />}
    </RowShell>
  );
}

function ContactRow({
  status,
  userId,
  institutionId,
  onDone,
}: {
  status: SecurityStatus | null;
  userId: string;
  institutionId: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<ContactVerification[]>([]);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState("");
  const verification = verifications[0] ?? null;
  const { busy, error, ok, run } = useAction();
  const gate = gateKind(status);
  const pinLength = pinLengthOf(status);
  const emailValid = !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const proved = gate === "pin" ? pin.length === pinLength : gate === "token" ? !!token : true;

  function reset() {
    setEmail("");
    setPhone("");
    setPin("");
    setToken(null);
    setCode("");
    setVerifications([]);
  }

  function save() {
    void run(async () => {
      const askedAt = Date.now();
      const res = await apiSetContact(
        userId,
        { email: email.trim() || null, phone: phone.trim() || null, currentPin: gate === "pin" ? pin : null, stepupToken: token },
        institutionId,
      );
      setPin("");
      setToken(null);
      onDone();
      const pending = res.verifications ?? (res.verification ? [res.verification] : []);
      if (pending.length) {
        // A new email or phone only takes effect once its own code is entered.
        setVerifications(pending);
        setSentAt(askedAt);
        return;
      }
      reset();
      setOpen(false);
    }, email || phone ? "We sent a code. Enter it to finish." : "Saved.");
  }

  function confirmCode(entered: string) {
    if (!verification || entered.length < 6) return;
    void run(async () => {
      await confirmContact(userId, verification.challenge_id, entered);
      setCode("");
      const rest = verifications.slice(1);
      onDone();
      if (rest.length) {
        // Both an email and a phone were changed: confirm the next one.
        setVerifications(rest);
        return;
      }
      reset();
      setOpen(false);
    }, "Confirmed. Whoever had the previous contact has been told about the change.");
  }

  const confirmed = [status?.email_set ? status.contact_email : null, status?.phone_set ? status.contact_phone : null]
    .filter(Boolean)
    .join(" · ");
  const description = status?.pending_email || status?.pending_phone
    ? `Waiting for you to confirm ${status.pending_email ?? status.pending_phone}`
    : confirmed || "Add an email so we can send you codes";

  return (
    <RowShell
      icon={<EnvelopeSimple size={18} weight="bold" />}
      title="Where codes are sent"
      description={description}
      state={
        <div className="flex items-center gap-3">
          <StatePill ok={!!status?.email_set || !!status?.phone_set} okText="Confirmed" offText="None" />
          <LinkButton onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Edit"}</LinkButton>
        </div>
      }
    >
      {open && !verification && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="Email for codes" className={inputClass} aria-label="Email for codes" aria-invalid={!emailValid} />
          {!emailValid && <p className="text-[12px] text-red-500" role="alert">Enter a valid email address.</p>}
          {status?.sms_available ? (
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="Phone for codes by SMS (optional, e.g. 0803...)" className={inputClass} aria-label="Phone number" />
          ) : (
            <p className="text-[12px] leading-relaxed text-d-faint">
              Codes are sent by email. SMS codes aren&apos;t available at this bank yet.
            </p>
          )}
          <p className="text-[12px] leading-relaxed text-d-faint">
            A new email or phone only starts receiving codes after you enter the code we send to it.
          </p>
          {gate === "pin" && <PinField label="Confirm with your PIN" length={pinLength} value={pin} onChange={setPin} />}
          {gate === "token" && <TokenGate userId={userId} institutionId={institutionId} token={token} onToken={setToken} />}
          <Button loading={busy} disabled={(!email && !phone) || !emailValid || !proved} onClick={save}>
            Save
          </Button>
          <Feedback error={error} ok={null} />
        </div>
      )}
      {open && verification && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-d-surface-2/60 p-4">
          <p className="text-center text-[13px] text-d-muted">
            Enter the code we sent {verification.channel === "sms" ? "by SMS " : ""}to{" "}
            <span className="font-semibold text-d-text">{verification.destination}</span>.
          </p>
          {verification.sandbox_inbox && <SandboxCode userId={userId} since={sentAt} />}
          {verification.debug_code && (
            <Notice>
              Local development: no mail server is configured, so the code is shown here:{" "}
              <span className="font-mono font-bold">{verification.debug_code}</span>
            </Notice>
          )}
          <PinInput length={6} value={code} onChange={setCode} onComplete={confirmCode} label="6-digit code" masked={false} autoFocus disabled={busy} />
          <Feedback error={error} ok={null} />
        </div>
      )}
      {!open && <Feedback error={null} ok={ok} />}
    </RowShell>
  );
}

function PasskeyRow({
  status,
  userId,
  displayName,
  institutionId,
  supported,
  onDone,
}: {
  status: SecurityStatus | null;
  userId: string;
  displayName: string;
  institutionId: string | null;
  supported: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const { busy, error, ok, note, run } = useAction();
  const count = status?.passkey_count ?? 0;
  const gate = gateKind(status);
  const pinLength = pinLengthOf(status);

  function add(enteredPin?: string, stepupToken?: string | null) {
    void run(async () => {
      await registerPasskey(userId, displayName, institutionId, gate === "pin" ? (enteredPin ?? pin) : null, stepupToken ?? token);
      setPin("");
      setToken(null);
      setOpen(false);
      onDone();
    }, "Device added.", () => {
      // "Already added" means the list on screen was stale: refresh it.
      setPin("");
      setToken(null);
      setOpen(false);
      onDone();
    });
  }

  return (
    <RowShell
      icon={<Fingerprint size={18} weight="bold" />}
      title="Device unlock"
      description="Fingerprint or face on this device"
      state={
        supported ? (
          <div className="flex items-center gap-3">
            <StatePill ok={count > 0} okText={`${count} added`} offText="None" />
            <LinkButton onClick={() => (gate !== "none" ? setOpen((o) => !o) : add())} disabled={busy}>
              {busy ? "..." : open ? "Close" : "Add device"}
            </LinkButton>
          </div>
        ) : (
          <span className="text-[12px] text-d-faint">Not available here</span>
        )
      }
    >
      {gate === "pin" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <PinField
            label="Confirm with your PIN to trust a new device"
            length={pinLength}
            value={pin}
            onChange={setPin}
            onComplete={(v) => add(v)}
            autoFocus
            disabled={busy}
          />
        </div>
      )}
      {gate === "token" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <TokenGate
            userId={userId}
            institutionId={institutionId}
            token={token}
            onToken={(t) => {
              setToken(t);
              add(undefined, t);
            }}
          />
        </div>
      )}
      <Feedback error={error} ok={ok} note={note} />
    </RowShell>
  );
}

/** Whether the customer's location is used to spot unusual transfers. Off
 * needs a factor they already have, so a stolen session cannot switch it off
 * before a transfer from somewhere new; on needs nothing. */
function LocationRow({
  status,
  userId,
  institutionId,
  onDone,
}: {
  status: SecurityStatus | null;
  userId: string;
  institutionId: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const { busy, error, run } = useAction();
  const on = status?.location_shared !== false;
  const gate = gateKind(status);
  const pinLength = pinLengthOf(status);

  function change(enteredPin?: string, stepupToken?: string | null) {
    void run(async () => {
      await apiSetLocationSharing(userId, !on, on && gate === "pin" ? (enteredPin ?? pin) : null, stepupToken ?? null);
      setPin("");
      setOpen(false);
      onDone();
    }, "");
  }

  return (
    <RowShell
      icon={<MapPin size={18} weight="bold" />}
      title="Use my location"
      description={on ? "A transfer from a new city gets an extra check" : "Off: a transfer from somewhere new is not noticed"}
      state={<Toggle on={on} label="Use my location" onChange={() => (on && gate !== "none" ? setOpen((o) => !o) : change())} />}
    >
      {on && gate === "pin" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <PinField
            label="Confirm with your PIN to turn off"
            length={pinLength}
            value={pin}
            onChange={setPin}
            onComplete={(v) => change(v)}
            autoFocus
            disabled={busy}
          />
        </div>
      )}
      {on && gate === "token" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <TokenGate userId={userId} institutionId={institutionId} token={null} onToken={(t) => change(undefined, t)} />
        </div>
      )}
      <Feedback error={error} ok={null} />
    </RowShell>
  );
}

function TwoFactorRow({
  status,
  userId,
  institutionId,
  onDone,
}: {
  status: SecurityStatus | null;
  userId: string;
  institutionId: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const { busy, error, run } = useAction();
  const on = !!status?.two_factor_enabled;
  const gate = gateKind(status);
  const pinLength = pinLengthOf(status);

  function toggle(enteredPin?: string, stepupToken?: string | null) {
    void run(async () => {
      await apiSetTwoFactor(userId, !on, gate === "pin" ? (enteredPin ?? pin) : null, stepupToken ?? null);
      setPin("");
      setOpen(false);
      onDone();
    }, "");
  }

  return (
    <RowShell
      icon={<DeviceMobile size={18} weight="bold" />}
      title="Always ask me to verify"
      description="Extra check on every flagged transfer"
      state={<Toggle on={on} label="Always ask me to verify" onChange={() => (gate !== "none" ? setOpen((o) => !o) : toggle())} />}
    >
      {gate === "pin" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <PinField
            label={on ? "Confirm with your PIN to turn off" : "Confirm with your PIN to turn on"}
            length={pinLength}
            value={pin}
            onChange={setPin}
            onComplete={(v) => toggle(v)}
            autoFocus
            disabled={busy}
          />
        </div>
      )}
      {gate === "token" && open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <TokenGate userId={userId} institutionId={institutionId} token={null} onToken={(t) => toggle(undefined, t)} />
        </div>
      )}
      <Feedback error={error} ok={null} />
    </RowShell>
  );
}
