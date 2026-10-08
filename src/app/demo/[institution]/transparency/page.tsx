"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  DeviceMobile,
  EnvelopeSimple,
  Fingerprint,
  LockKey,
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
} from "@/components/demo/kit";
import {
  newPinLengthOf,
  pinLengthOf,
  securityStatus,
  setPin as apiSetPin,
  setContact as apiSetContact,
  setTwoFactor as apiSetTwoFactor,
  type SecurityStatus,
} from "@/lib/fable/api";
import { registerPasskey, passkeySupported } from "@/lib/fable/webauthn";
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
        <TwoFactorRow status={status} userId={userId} onDone={refresh} />
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
  const run = useCallback(async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, ok, run };
}

function Feedback({ error, ok }: { error: string | null; ok: string | null }) {
  if (error) return <Notice tone="danger" className="mt-3">{error}</Notice>;
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
  const { busy, error, ok, run } = useAction();

  const isSet = !!status?.pin_set;
  const newLength = newPinLengthOf(status);
  const currentLength = pinLengthOf(status);

  const ready =
    pin.length === newLength && confirm === pin && (!isSet || current.length === currentLength);

  function close() {
    setOpen(false);
    setCurrent("");
    setPin("");
    setConfirm("");
  }

  function save() {
    void run(async () => {
      await apiSetPin(userId, pin, isSet ? current : null, institutionId);
      close();
      onDone();
    }, "PIN saved.");
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
          <PinField label={isSet ? "New PIN" : "Choose a PIN"} length={newLength} value={pin} onChange={setPin} autoFocus={!isSet} />
          <PinField label="Confirm PIN" length={newLength} value={confirm} onChange={setConfirm} />
          {confirm.length === newLength && confirm !== pin && (
            <p className="text-center text-[12px] text-red-500">The PINs don&apos;t match.</p>
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
  const { busy, error, ok, run } = useAction();
  const hasContact = !!status?.email_set || !!status?.phone_set;
  const needsPin = !!status?.pin_set;
  const pinLength = pinLengthOf(status);

  function save() {
    void run(async () => {
      await apiSetContact(userId, { email: email || null, phone: phone || null, currentPin: needsPin ? pin : null }, institutionId);
      setEmail("");
      setPhone("");
      setPin("");
      setOpen(false);
      onDone();
    }, "Saved.");
  }

  return (
    <RowShell
      icon={<EnvelopeSimple size={18} weight="bold" />}
      title="Where codes are sent"
      description={hasContact ? (status?.contact_email ?? status?.contact_phone ?? "") : "Add an email so we can send you codes"}
      state={
        <div className="flex items-center gap-3">
          <StatePill ok={hasContact} okText="Added" offText="None" />
          <LinkButton onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Edit"}</LinkButton>
        </div>
      }
    >
      {open && (
        <div className="flex flex-col gap-4 rounded-2xl bg-d-surface-2/60 p-4">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="Email for codes" className={inputClass} aria-label="Email for codes" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="Phone (optional, e.g. 0803...)" className={inputClass} aria-label="Phone number" />
          {needsPin && <PinField label="Confirm with your PIN" length={pinLength} value={pin} onChange={setPin} />}
          <Button loading={busy} disabled={(!email && !phone) || (needsPin && pin.length < pinLength)} onClick={save}>
            Save
          </Button>
          <Feedback error={error} ok={ok} />
        </div>
      )}
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
  const { busy, error, ok, run } = useAction();
  const count = status?.passkey_count ?? 0;
  const needsPin = !!status?.pin_set;
  const pinLength = pinLengthOf(status);

  function add(enteredPin?: string) {
    void run(async () => {
      await registerPasskey(userId, displayName, institutionId, needsPin ? (enteredPin ?? pin) : null);
      setPin("");
      setOpen(false);
      onDone();
    }, "Device added.");
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
            <LinkButton onClick={() => (needsPin ? setOpen((o) => !o) : add())} disabled={busy}>
              {busy ? "..." : open ? "Close" : "Add device"}
            </LinkButton>
          </div>
        ) : (
          <span className="text-[12px] text-d-faint">Not available here</span>
        )
      }
    >
      {needsPin && open && (
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
      <Feedback error={error} ok={ok} />
    </RowShell>
  );
}

function TwoFactorRow({ status, userId, onDone }: { status: SecurityStatus | null; userId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const { busy, error, run } = useAction();
  const on = !!status?.two_factor_enabled;
  const needsPin = !!status?.pin_set;
  const pinLength = pinLengthOf(status);

  function toggle(enteredPin?: string) {
    void run(async () => {
      await apiSetTwoFactor(userId, !on, needsPin ? (enteredPin ?? pin) : null);
      setPin("");
      setOpen(false);
      onDone();
    }, "");
  }

  return (
    <RowShell
      icon={<DeviceMobile size={18} weight="bold" />}
      title="Always ask for a code"
      description="Extra check on every flagged transfer"
      state={<Toggle on={on} label="Always ask for a code" onChange={() => (needsPin ? setOpen((o) => !o) : toggle())} />}
    >
      {needsPin && open && (
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
      <Feedback error={error} ok={null} />
    </RowShell>
  );
}
