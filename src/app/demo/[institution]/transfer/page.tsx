"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  CaretDown,
  Check,
  Crosshair,
  Fingerprint,
  MapPin,
  PaperPlaneTilt,
  Timer,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DetailRow,
  Eyebrow,
  Field,
  Notice,
  Segmented,
  inputClass,
} from "@/components/app-kit";
import { BehavioralTracker } from "@/lib/fable/biometrics";
import { InsufficientFundsError, accountBalance } from "@/lib/fable/api";
import { collectDeviceFingerprint, type DeviceFingerprint } from "@/lib/fable/fingerprint";
import { formatNaira } from "@/lib/fable/format";
import { collectGeolocation, getGeolocationSnapshot, type GeoLocation } from "@/lib/fable/geolocation";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import { CONTACTS, QUICK_AMOUNTS } from "@/lib/fable/seed";
import { ensureSession, getSessionContext, type BankingSession } from "@/lib/fable/session";
import { submitTransfer } from "@/lib/fable/store";
import type { Channel, Recipient } from "@/lib/fable/types";

interface Bank {
  name: string;
  code: string;
}

const CHANNELS: Channel[] = ["app", "ussd", "web"];
type VerifyState = "idle" | "verifying" | "verified" | "error";

/** Why a name is simulated rather than a real NUBAN lookup. Surfaced on the
 * badge so a degraded integration is never mistaken for a working one. */
const FALLBACK_HINTS: Record<string, string> = {
  no_key: "No Paystack key configured. Set PAYSTACK_SECRET_KEY in .env.local.",
  ip_blocked:
    "Paystack is blocking this machine's IP on /bank/resolve. Clear the Test IP allowlist in the Paystack dashboard (empty = allow all). See /api/paystack-status.",
  unauthorized: "Paystack rejected the key. Check you copied the Test Secret Key (sk_test_...).",
  transport: "Could not reach Paystack. Check your connection.",
};

// One passive behavioural tracker per visit to this page (module scope keeps it
// out of React's render path; the mount effect owns its lifecycle).
let tracker: BehavioralTracker | null = null;
const recordKey = (field: string) => () => tracker?.recordKey(field);
const recordPaste = (field: string) => () => tracker?.recordPaste(field);

// The names the seeded beneficiaries resolve to.
const CONTACT_REAL_NAMES: Record<string, string> = {
  Mum: "Adeola Musa",
  Landlord: "Emeka Okafor",
  Chioma: "Chioma Nnamdi",
  Unknown: "Bello Mukhtar",
};

export default function TransferPage() {
  const { href, customer, institutionId } = useInstitution();
  const router = useRouter();

  const [mode, setMode] = useState<"saved" | "new">("saved");
  const [contact, setContact] = useState<Recipient | null>(null);
  const [verify, setVerify] = useState<VerifyState>("idle");
  const [resolveSource, setResolveSource] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [channel, setChannel] = useState<Channel>("app");
  const [detectedChannel, setDetectedChannel] = useState<Channel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // What the Fable SDK has actually collected on this page.
  const [device, setDevice] = useState<DeviceFingerprint | null>(null);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [session, setSession] = useState<BankingSession | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  const { data: account } = useSWR(
    customer ? ["account", customer.user_id, institutionId] : null,
    () => accountBalance(customer!.user_id, institutionId),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  // Tapping the button is a user gesture, which is what lets a phone browser
  // show its location prompt; one raised on page load is easy to miss or is
  // suppressed.
  function retryLocation() {
    setLocating(true);
    void collectGeolocation(true)
      .then(setLocation)
      .finally(() => setLocating(false));
  }

  useEffect(() => {
    const t = new BehavioralTracker();
    t.start();
    tracker = t;

    void collectDeviceFingerprint().then(setDevice);
    void collectGeolocation().then(setLocation);

    // Browser-only state (the session clock and the detected channel) is set up
    // from a callback rather than synchronously in the effect body, so the first
    // paint is not followed by a cascade of renders.
    let tick: ReturnType<typeof setInterval> | undefined;
    const init = setTimeout(() => {
      // The session starts (or resumes) the moment the banking surface loads.
      const s = ensureSession();
      setSession(s);
      tick = setInterval(() => setSessionSeconds(Math.round((Date.now() - s.loginTimestamp) / 1000)), 1000);

      // Auto-detect the channel this browser actually is. The selector stays so
      // a demo can switch to USSD, which Shield treats as a riskier rail.
      const isMobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
      const detected: Channel = isMobile ? "app" : "web";
      setDetectedChannel(detected);
      setChannel(detected);
    }, 0);

    return () => {
      clearTimeout(init);
      if (tick) clearInterval(tick);
      t.stop();
      if (tracker === t) tracker = null;
    };
  }, []);

  // Real bank list (Paystack when a key is configured, a built-in list otherwise).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/banks")
      .then((r) => r.json())
      .then((data: { banks: Bank[] }) => {
        if (!cancelled) setBanks(data.banks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const bankByCode = useMemo(() => new Map(banks.map((b) => [b.code, b])), [banks]);

  const verifyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(verifyTimer.current), []);

  function selectContact(c: Recipient) {
    setContact({ ...c, name: CONTACT_REAL_NAMES[c.name] ?? c.name });
    setMode("saved");
    setVerify("verifying");
    setResolveSource(null);
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => setVerify("verified"), 700);
  }

  function handleAccountInput(val: string) {
    const clean = val.replace(/\D/g, "").slice(0, 10);
    setAccountNumber(clean);
    setContact(null);
    if (clean.length === 10 && selectedBankCode) void startNewVerify(clean, selectedBankCode);
    else setVerify("idle");
  }

  function handleBankSelect(code: string) {
    setSelectedBankCode(code);
    if (accountNumber.length === 10 && code) void startNewVerify(accountNumber, code);
  }

  async function startNewVerify(acct: string, bankCode: string) {
    setVerify("verifying");
    setContact(null);
    setResolveSource(null);
    setFallbackReason(null);
    try {
      const res = await fetch("/api/resolve-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber: acct, bankCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerify("error");
        return;
      }
      setContact({
        name: data.accountName,
        bank: data.bankName ?? bankByCode.get(bankCode)?.name ?? bankCode,
        bankCode: data.bankCode ?? bankCode,
        accountNumber: data.accountNumber,
        known: false,
      });
      setResolveSource(data.source ?? null);
      setFallbackReason(data.fallbackReason ?? null);
      setVerify("verified");
    } catch {
      setVerify("error");
    }
  }

  const amountValue = Number(amount) || 0;
  const available = account?.available ?? null;
  const overBalance = available !== null && amountValue > available;
  const canSubmit = contact !== null && verify === "verified" && amountValue > 0 && !overBalance && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setSubmitError(null);

    // Everything the SDK collected on this page travels with the transfer.
    const sdk = {
      device,
      location: getGeolocationSnapshot(),
      session: getSessionContext(),
      behavior: tracker?.snapshot() ?? null,
    };

    // Every exit path resets the spinner: a declined-for-funds transfer used to
    // throw past the navigation and strand the button on "Checking" forever.
    try {
      // A short floor so the checking moment registers. Scoring is sub-200ms, so
      // a long artificial wait would be pure friction.
      const minDelay = new Promise((resolve) => setTimeout(resolve, 650));
      await Promise.all([submitTransfer({ amount: amountValue, recipient: contact, narration, channel }, sdk), minDelay]);
      router.push(href("/result"));
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        const short = err.shortfall > 0 ? ` You're ${formatNaira(err.shortfall)} short.` : "";
        setSubmitError(`Not enough balance for this transfer.${short}`);
      } else {
        setSubmitError("We couldn't process this transfer just now. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <PageHeader title="Send money" subtitle="Move money to any Nigerian bank account" back />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {/* 1. Recipient */}
          <Card>
            <CardHeader
              title="Who are you sending to?"
              action={
                <Segmented
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setContact(null);
                    setVerify("idle");
                  }}
                  options={[
                    { value: "saved", label: "Saved" },
                    { value: "new", label: "New account" },
                  ]}
                />
              }
            />

            {mode === "saved" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CONTACTS.map((c) => {
                  const selected = contact?.accountNumber === c.accountNumber;
                  return (
                    <button
                      key={c.accountNumber}
                      type="button"
                      onClick={() => selectContact(c)}
                      className={`flex flex-col items-center gap-2 rounded-2xl border p-3.5 transition-all ${
                        selected ? "border-brand bg-brand/[0.06] ring-4 ring-brand/10" : "border-d-border hover:bg-d-surface-2"
                      }`}
                    >
                      <Avatar name={c.name} size="lg" />
                      <span className="text-[13px] font-semibold text-d-text">{c.name}</span>
                      <span className="text-[11px] text-d-muted">{c.bank}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Account number">
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => handleAccountInput(e.target.value)}
                    onKeyDown={recordKey("account_number")}
                    onPaste={recordPaste("account_number")}
                    placeholder="10-digit account number"
                    aria-label="Account number"
                    className={`${inputClass} tabular-nums`}
                  />
                </Field>
                <Field label="Bank">
                  <div className="relative">
                    <select
                      value={selectedBankCode}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      aria-label="Bank"
                      className={`${inputClass} appearance-none pr-10`}
                    >
                      <option value="" disabled>
                        Select bank
                      </option>
                      {banks.map((b) => (
                        <option key={`${b.code}-${b.name}`} value={b.code}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <CaretDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-d-faint" />
                  </div>
                </Field>
              </div>
            )}

            {verify !== "idle" && (
              <div
                className={`mt-4 flex items-center gap-3 rounded-xl px-4 py-3 text-[13px] ${
                  verify === "verified"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : verify === "error"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-d-surface-2 text-d-muted"
                }`}
              >
                {verify === "verifying" ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-d-border border-t-d-muted" />
                    Looking up account…
                  </>
                ) : verify === "error" ? (
                  <>
                    <XCircle size={18} weight="fill" />
                    We couldn&apos;t find that account. Check the number and bank.
                  </>
                ) : contact ? (
                  <>
                    <Check size={18} weight="bold" />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{contact.name}</span> · {contact.bank}
                    </span>
                    {mode === "new" &&
                      (resolveSource === "paystack" ? (
                        <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          Verified
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                          title={FALLBACK_HINTS[fallbackReason ?? "no_key"]}
                        >
                          Demo name
                        </span>
                      ))}
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {/* 2. Amount */}
          <Card>
            <CardHeader title="How much?" />
            <div className="rounded-2xl bg-d-surface-2 px-4 py-6">
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-[28px] font-bold text-d-faint">₦</span>
                <input
                  inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString("en-NG") : ""}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={recordKey("amount")}
                  onPaste={recordPaste("amount")}
                  placeholder="0"
                  aria-label="Amount in naira"
                  className="w-full min-w-0 bg-transparent text-center text-[44px] font-bold tabular-nums text-d-text outline-none placeholder:text-d-faint/50 sm:text-[52px]"
                />
              </div>
              {available !== null && (
                <p className="mt-1 text-center text-[12px] text-d-muted">Available {formatNaira(available)}</p>
              )}
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className={`h-10 rounded-xl text-[12px] font-semibold transition-colors ${
                    amountValue === a ? "bg-brand text-white" : "bg-d-surface-2 text-d-muted hover:text-d-text"
                  }`}
                >
                  ₦{a >= 1000 ? `${a / 1000}k` : a}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <Field
                label="Narration (optional)"
                hint={
                  <>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">Demo tip:</span> try &ldquo;urgent help abeg&rdquo; to a new
                    account to see Shield step in.
                  </>
                }
              >
                <input
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  onKeyDown={recordKey("narration")}
                  onPaste={recordPaste("narration")}
                  placeholder="What's this for?"
                  aria-label="Narration"
                  className={inputClass}
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* 3. Review */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card className="lg:sticky lg:top-6">
            <CardHeader title="Review" />

            <div className="divide-y divide-d-border">
              <DetailRow label="From">{customer?.name ?? "—"}</DetailRow>
              <DetailRow label="To">{contact ? contact.name : <span className="text-d-faint">Not chosen yet</span>}</DetailRow>
              <DetailRow label="Bank">{contact?.bank ?? <span className="text-d-faint">—</span>}</DetailRow>
              <DetailRow label="Amount">
                <span className="text-[16px] font-bold tabular-nums">{formatNaira(amountValue)}</span>
              </DetailRow>
            </div>

            <div className="mt-4">
              <Eyebrow className="mb-2">Sent via</Eyebrow>
              <Segmented
                value={channel}
                onChange={setChannel}
                options={CHANNELS.map((ch) => ({
                  value: ch,
                  label: detectedChannel === ch ? `${CHANNEL_LABELS[ch]} · detected` : CHANNEL_LABELS[ch],
                }))}
                className="w-full [&>button]:flex-1"
              />
            </div>

            {overBalance && (
              <Notice tone="warning" className="mt-4 flex items-start gap-2">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  That&apos;s more than your available balance.{" "}
                  <Link href={href("/add-money")} className="font-semibold underline">
                    Add money
                  </Link>
                </span>
              </Notice>
            )}

            <Button
              size="lg"
              full
              className="mt-5"
              disabled={!canSubmit}
              loading={submitting}
              onClick={handleSubmit}
              icon={!submitting ? <PaperPlaneTilt size={18} weight="fill" /> : undefined}
            >
              {submitting ? "Checking transfer…" : amountValue > 0 ? `Send ${formatNaira(amountValue)}` : "Send money"}
            </Button>

            {submitError && (
              <Notice tone="danger" className="mt-3">
                {submitError}{" "}
                {submitError.startsWith("Not enough") && (
                  <ButtonLink href={href("/add-money")} variant="ghost" size="sm" className="!h-auto !px-0 underline">
                    Add money
                  </ButtonLink>
                )}
              </Notice>
            )}

            {/* What Fable reads, collapsed by default. It is the product's real
                data collection, shown for evaluators without crowding the form. */}
            <details className="group mt-5 rounded-xl border border-d-border">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-semibold text-d-text">
                What Fable checks on this transfer
                <CaretDown size={14} className="text-d-faint transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-3 border-t border-d-border px-4 py-3.5 text-[12px]">
                <Signal icon={<Fingerprint size={16} />} title="Device">
                  {device ? `${device.os} · ${device.browser}` : "Reading…"}
                </Signal>
                <Signal icon={<MapPin size={16} />} title="Location">
                  <LocationStatus location={location} locating={locating} onRetry={retryLocation} />
                </Signal>
                <Signal icon={<Timer size={16} />} title="Session">
                  {session
                    ? `${sessionSeconds < 60 ? `${sessionSeconds}s` : `${Math.floor(sessionSeconds / 60)}m ${sessionSeconds % 60}s`} since sign-in`
                    : "Starting…"}
                </Signal>
                <Signal icon={<Crosshair size={16} />} title="Behaviour">
                  Typing, paste and pace on this page
                </Signal>
              </div>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LocationStatus({
  location,
  locating,
  onRetry,
}: {
  location: GeoLocation | null;
  locating: boolean;
  onRetry: () => void;
}) {
  if (!location || locating) return <>Locating…</>;
  if (location.source === "gps") {
    const acc = location.accuracy_m;
    const place = [location.locality, location.city].filter(Boolean).join(", ") || "Device location";
    const within = acc ? ` (within ${acc >= 1000 ? `${Math.round(acc / 1000)} km` : `${Math.round(acc)} m`})` : "";
    return <>{place + within}</>;
  }
  const area = [location.city, location.country].filter(Boolean).join(", ");
  const blocked = location.gps_error === "denied";
  return (
    <>
      {blocked
        ? "Location is blocked for this site. Allow it in your browser's site settings, then try again."
        : area
          ? `Only your network's area is known (${area}).`
          : "Your location could not be read."}{" "}
      <button type="button" onClick={onRetry} className="font-semibold text-brand underline-offset-2 hover:underline">
        {blocked ? "Try again" : "Use my exact location"}
      </button>
    </>
  );
}

function Signal({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-brand">{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold text-d-text">{title}</p>
        <div className="break-words text-d-muted">{children}</div>
      </div>
    </div>
  );
}
