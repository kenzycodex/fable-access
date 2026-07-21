"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  LockKey,
  Fingerprint,
  EnvelopeSimple,
  DeviceMobile,
  CheckCircle,
  X,
} from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import {
  securityStatus,
  setPin as apiSetPin,
  setContact as apiSetContact,
  setTwoFactor as apiSetTwoFactor,
  type CopilotBaseline,
  type SecurityStatus,
} from "@/lib/fable/api";
import { registerPasskey, passkeySupported } from "@/lib/fable/webauthn";
import { previewScore } from "@/lib/fable/scoring";
import { setTransparency, useFableStore } from "@/lib/fable/store";
import type { TransparencyState } from "@/lib/fable/types";
import { useCopilotBaseline } from "@/lib/fable/useBackend";
import { useInstitution } from "@/components/demo/InstitutionProvider";

const CHANNEL_NAMES: Record<string, string> = {
  mobile_app: "Mobile App",
  ussd: "USSD",
  internet: "Web",
  pos: "POS",
  atm: "ATM",
};

function buildSignals(b?: CopilotBaseline): { key: keyof TransparencyState; label: string; desc: string }[] {
  return [
    { key: "typicalRange", label: "Spending patterns", desc: b ? `${b.typical_transfer_range} typical range` : "Learning your range…" },
    { key: "activeHours", label: "Active hours", desc: b ? `${b.active_hours} usual activity` : "Learning your hours…" },
    { key: "trustedRecipients", label: "Trusted contacts", desc: b ? `${b.trusted_recipients_count} saved recipients` : "Learning your contacts…" },
    { key: "knownDevices", label: "Device recognition", desc: b ? `${b.known_devices_count} verified device${b.known_devices_count === 1 ? "" : "s"}` : "1 verified device" },
    { key: "channel", label: "Channel analysis", desc: b ? `${CHANNEL_NAMES[b.preferred_channel] ?? b.preferred_channel} preferred` : "Mobile App preferred" },
  ];
}

const NEVER_STORED = ["Messages or call history", "GPS location data", "Card numbers or PINs", "Sold to third parties"];

export default function SecurityPage() {
  const store = useFableStore();
  const state = store?.transparency;
  const { customer, institutionId } = useInstitution();
  const { data: baseline } = useCopilotBaseline();
  const SIGNALS = buildSignals(baseline);

  const preview = state ? previewScore(state) : 0;
  const pct = Math.round(preview * 100);
  const level = pct >= 80 ? "High" : pct >= 50 ? "Medium" : "Low";
  const levelColor = pct >= 80 ? "text-red-400" : pct >= 50 ? "text-amber-400" : "text-emerald-400";
  const barColor = pct >= 80 ? "bg-red-400" : pct >= 50 ? "bg-amber-400" : "bg-emerald-400";
  const enabledCount = state ? Object.values(state).filter((v) => v === true).length : 0;

  return (
    <Screen>
      <ScreenHeader title="Security" subtitle="Verification & privacy" />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <VerificationSetup userId={customer?.user_id ?? null} displayName={customer?.name ?? "Customer"} institutionId={institutionId} />

          {/* What Fable knows — client-side transparency preview */}
          <Card className="!p-0">
            <div className="flex items-center gap-3 px-4 pt-4 pb-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]">
                <ShieldCheck size={18} weight="fill" />
              </span>
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white">What Fable watches</p>
                <p className="text-[11px] text-gray-500 dark:text-white/40">{enabledCount} of {SIGNALS.length} signals active</p>
              </div>
              <span className={`text-[22px] font-bold tabular-nums ${levelColor}`}>{pct}</span>
            </div>
            <div className="px-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#111]">
                <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-white/30">
                Preview risk on a ₦180k test transfer: <span className={`font-medium ${levelColor}`}>{level}</span>. Turn a
                signal off to see it change.
              </p>
            </div>
            <div className="mt-3 divide-y divide-gray-100 dark:divide-white/[0.04]">
              {!state
                ? SIGNALS.map((s) => (
                    <div key={s.key} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-1">
                        <div className="h-3 w-24 rounded bg-gray-200 dark:bg-[#111] animate-pulse" />
                        <div className="mt-1.5 h-2.5 w-32 rounded bg-gray-100 dark:bg-[#111] animate-pulse" />
                      </div>
                    </div>
                  ))
                : SIGNALS.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{s.label}</span>
                        <span className="text-[11px] text-gray-500 dark:text-white/40">{s.desc}</span>
                      </div>
                      <Toggle on={state[s.key] as boolean} onChange={() => setTransparency({ [s.key]: !state[s.key] })} label={s.label} />
                    </div>
                  ))}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25 mb-3">How it works</p>
            <div className="flex flex-col gap-2.5">
              {[
                "Learns your normal spending patterns",
                "Scores every transfer in under 200ms",
                "Flags or blocks suspicious activity",
                "Holds risky transfers until you verify it's you",
              ].map((step, i) => (
                <div key={step} className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)]/10 text-[10px] font-semibold text-[var(--brand-primary)] mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] leading-relaxed text-gray-600 dark:text-white/50">{step}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25 mb-3">We never store</p>
            <div className="flex flex-col gap-2.5">
              {NEVER_STORED.map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400">
                    <X size={12} weight="bold" />
                  </span>
                  <p className="text-[13px] text-gray-600 dark:text-white/45">{item}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Verification setup — the real, backend-wired factors a customer controls.
// These are exactly what Ghost demands before releasing a contained transfer.
// ---------------------------------------------------------------------------

function VerificationSetup({
  userId,
  displayName,
  institutionId,
}: {
  userId: string | null;
  displayName: string;
  institutionId: string | null;
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
        <p className="text-[13px] text-gray-500 dark:text-white/40">Pick a customer to manage their verification.</p>
      </Card>
    );
  }

  return (
    <Card className="!p-0">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]">
          <LockKey size={18} weight="fill" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Verification &amp; sign-in</p>
          <p className="text-[11px] text-gray-500 dark:text-white/40">Used when a transfer is held for review</p>
        </div>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
        <PinRow status={status} userId={userId} institutionId={institutionId} onDone={refresh} />
        <ContactRow status={status} userId={userId} institutionId={institutionId} onDone={refresh} />
        <PasskeyRow status={status} userId={userId} displayName={displayName} institutionId={institutionId} supported={supported} onDone={refresh} />
        <TwoFactorRow status={status} userId={userId} onDone={refresh} />
      </div>
    </Card>
  );
}

function RowShell({
  icon,
  title,
  state,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  state: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-white/50">
          {icon}
        </span>
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="ml-auto">{state}</span>
      </div>
      {children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  );
}

function StatePill({ ok, okText, offText }: { ok: boolean; okText: string; offText: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
      <CheckCircle size={11} weight="fill" /> {okText}
    </span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:bg-white/[0.06] dark:text-white/35">
      {offText}
    </span>
  );
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-900 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white";
const btnCls =
  "rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

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
  if (error) return <p className="mt-2 text-[11px] text-red-500">{error}</p>;
  if (ok) return <p className="mt-2 text-[11px] text-emerald-500">{ok}</p>;
  return null;
}

function PinRow({ status, userId, institutionId, onDone }: { status: SecurityStatus | null; userId: string; institutionId: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState("");
  const { busy, error, ok, run } = useAction();
  const isSet = !!status?.pin_set;

  function save() {
    void run(async () => {
      await apiSetPin(userId, pin, isSet ? current : null, institutionId);
      setPin("");
      setCurrent("");
      setOpen(false);
      onDone();
    }, "PIN saved.");
  }

  return (
    <RowShell
      icon={<LockKey size={16} weight="bold" />}
      title="Transaction PIN"
      state={
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2">
          <StatePill ok={isSet} okText="Set" offText="Not set" />
          <span className="text-[11px] font-semibold text-[var(--brand-primary)]">{open ? "Close" : isSet ? "Change" : "Set up"}</span>
        </button>
      }
    >
      {open && (
        <div className="flex flex-col gap-2">
          {isSet && (
            <input value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" placeholder="Current PIN" className={inputCls} />
          )}
          <div className="flex gap-2">
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" placeholder="New 4 or 6-digit PIN" className={inputCls} />
            <button type="button" onClick={save} disabled={busy || (pin.length !== 4 && pin.length !== 6)} className={btnCls}>
              {busy ? "…" : "Save"}
            </button>
          </div>
          <Feedback error={error} ok={ok} />
        </div>
      )}
    </RowShell>
  );
}

function ContactRow({ status, userId, institutionId, onDone }: { status: SecurityStatus | null; userId: string; institutionId: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const { busy, error, ok, run } = useAction();
  const hasContact = !!status?.email_set || !!status?.phone_set;

  function save() {
    void run(async () => {
      await apiSetContact(userId, { email: email || null, phone: phone || null }, institutionId);
      setEmail("");
      setPhone("");
      setOpen(false);
      onDone();
    }, "Contact saved.");
  }

  return (
    <RowShell
      icon={<EnvelopeSimple size={16} weight="bold" />}
      title="Codes go to"
      state={
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2">
          {hasContact ? (
            <span className="text-[11px] font-medium text-gray-500 dark:text-white/45">
              {status?.contact_email ?? status?.contact_phone}
            </span>
          ) : (
            <StatePill ok={false} okText="" offText="None" />
          )}
          <span className="text-[11px] font-semibold text-[var(--brand-primary)]">{open ? "Close" : "Edit"}</span>
        </button>
      }
    >
      {open && (
        <div className="flex flex-col gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="Email for codes" className={inputCls} />
          <div className="flex gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="Phone (e.g. 0803…)" className={inputCls} />
            <button type="button" onClick={save} disabled={busy || (!email && !phone)} className={btnCls}>
              {busy ? "…" : "Save"}
            </button>
          </div>
          <Feedback error={error} ok={ok} />
        </div>
      )}
    </RowShell>
  );
}

function PasskeyRow({ status, userId, displayName, institutionId, supported, onDone }: { status: SecurityStatus | null; userId: string; displayName: string; institutionId: string | null; supported: boolean; onDone: () => void }) {
  const { busy, error, ok, run } = useAction();
  const count = status?.passkey_count ?? 0;

  function add() {
    void run(async () => {
      await registerPasskey(userId, displayName, institutionId);
      onDone();
    }, "Passkey added.");
  }

  return (
    <RowShell
      icon={<Fingerprint size={16} weight="bold" />}
      title="Device unlock"
      state={
        supported ? (
          <button type="button" onClick={add} disabled={busy} className="flex items-center gap-2">
            <StatePill ok={count > 0} okText={`${count}`} offText="None" />
            <span className="text-[11px] font-semibold text-[var(--brand-primary)]">{busy ? "…" : "Add device"}</span>
          </button>
        ) : (
          <span className="text-[11px] text-gray-400 dark:text-white/30">Not available here</span>
        )
      }
    >
      <Feedback error={error} ok={ok} />
    </RowShell>
  );
}

function TwoFactorRow({ status, userId, onDone }: { status: SecurityStatus | null; userId: string; onDone: () => void }) {
  const on = !!status?.two_factor_enabled;
  return (
    <RowShell
      icon={<DeviceMobile size={16} weight="bold" />}
      title="Always ask for a code"
      state={
        <Toggle
          on={on}
          label="Two-factor"
          onChange={() => {
            void apiSetTwoFactor(userId, !on).then(onDone).catch(() => {});
          }}
        />
      }
    />
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        on ? "bg-[var(--brand-primary)] shadow-[0_0_12px_rgba(124,58,237,0.4)]" : "bg-gray-200 dark:bg-white/10"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
