"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CaretDown, CircleNotch, Crosshair, DeviceMobile, Eye, Fingerprint, MapPin, ShieldCheck, Timer, XCircle } from "@phosphor-icons/react";
import { Avatar, Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { BehavioralTracker } from "@/lib/fable/biometrics";
import { collectDeviceFingerprint, type DeviceFingerprint } from "@/lib/fable/fingerprint";
import { formatNaira } from "@/lib/fable/format";
import { collectGeolocation, getGeolocationSnapshot, type GeoLocation } from "@/lib/fable/geolocation";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import { CONTACTS, QUICK_AMOUNTS } from "@/lib/fable/seed";
import { ensureSession, getSessionContext, type BankingSession } from "@/lib/fable/session";
import { submitTransfer } from "@/lib/fable/store";
import { InsufficientFundsError } from "@/lib/fable/api";
import type { Channel, Recipient } from "@/lib/fable/types";
import { useInstitution } from "@/components/demo/InstitutionProvider";

interface Bank {
  name: string;
  code: string;
}

const CHANNELS: Channel[] = ["app", "ussd", "web"];
type VerifyState = "idle" | "verifying" | "verified" | "error";

/** Why a name is simulated rather than a real NUBAN lookup. Surfaced on the
 * badge so a degraded integration is never mistaken for a working one. */
const FALLBACK_HINTS: Record<string, string> = {
  no_key: "No Paystack key configured — set PAYSTACK_SECRET_KEY in .env.local.",
  ip_blocked:
    "Paystack is blocking this machine's IP on /bank/resolve. Clear the Test IP allowlist in the Paystack dashboard (empty = allow all). See /api/paystack-status.",
  unauthorized: "Paystack rejected the key. Check you copied the Test Secret Key (sk_test_...).",
  transport: "Could not reach Paystack. Check your connection.",
};

// One passive biometrics tracker per transfer-page visit (module scope keeps
// it out of React's render path; the mount effect owns its lifecycle).
let tracker: BehavioralTracker | null = null;
const recordKey = (field: string) => () => tracker?.recordKey(field);
const recordPaste = (field: string) => () => tracker?.recordPaste(field);

export default function TransferPage() {
  const { href } = useInstitution();
  const router = useRouter();
  const [mode, setMode] = useState<"beneficiary" | "new">("beneficiary");
  const [contact, setContact] = useState<Recipient | null>(null);
  const [verify, setVerify] = useState<VerifyState>("idle");
  const [resolveSource, setResolveSource] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankSource, setBankSource] = useState<"paystack" | "fallback">("fallback");
  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [channel, setChannel] = useState<Channel>("app");
  const [detectedChannel, setDetectedChannel] = useState<Channel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Fable SDK: real data collection ---
  const [device, setDevice] = useState<DeviceFingerprint | null>(null);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [session, setSession] = useState<BankingSession | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  useEffect(() => {
    // Session starts (or resumes) the moment the banking surface loads.
    const s = ensureSession();
    setSession(s);
    const tick = setInterval(() => setSessionSeconds(Math.round((Date.now() - s.loginTimestamp) / 1000)), 1000);

    // Device fingerprint + geolocation (real GPS permission prompt, IP fallback).
    void collectDeviceFingerprint().then(setDevice);
    void collectGeolocation().then(setLocation);

    // Passive behavioral biometrics for the whole page visit.
    const t = new BehavioralTracker();
    t.start();
    tracker = t;

    // Auto-detect the channel this browser actually is (selector stays for testing).
    const isMobile =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
    const detected: Channel = isMobile ? "app" : "web";
    setDetectedChannel(detected);
    setChannel(detected);

    return () => {
      clearInterval(tick);
      t.stop();
      if (tracker === t) tracker = null;
    };
  }, []);

  // Real bank list (Paystack when a key is configured, fallback list otherwise).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/banks")
      .then((r) => r.json())
      .then((data: { banks: Bank[]; source: "paystack" | "fallback" }) => {
        if (cancelled) return;
        setBanks(data.banks);
        setBankSource(data.source);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const bankByCode = useMemo(() => new Map(banks.map((b) => [b.code, b])), [banks]);

  // Real names for the hardcoded contacts
  const getContactRealName = (name: string) => {
    const map: Record<string, string> = { Mum: "Adeola Musa", Landlord: "Emeka Okafor", Chioma: "Chioma Nnamdi", Unknown: "Bello Mukhtar" };
    return map[name] || name;
  };

  const verifyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(verifyTimer.current), []);

  function selectContact(c: Recipient) {
    setContact({ ...c, name: getContactRealName(c.name) });
    setMode("beneficiary");
    setVerify("verifying");
    setResolveSource(null);
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => setVerify("verified"), 950);
  }

  function handleAccountInput(val: string) {
    const clean = val.replace(/\D/g, "").slice(0, 10);
    setAccountNumber(clean);
    setMode("new");
    setContact(null);
    if (clean.length === 10 && selectedBankCode) {
      startNewVerify(clean, selectedBankCode);
    } else {
      setVerify("idle");
    }
  }

  function handleBankSelect(code: string) {
    setSelectedBankCode(code);
    if (accountNumber.length === 10 && code) {
      startNewVerify(accountNumber, code);
    }
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
  const canSubmit = contact !== null && verify === "verified" && amountValue > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setSubmitError(null);

    // Bundle everything the SDK has actually collected on this page.
    const sdk = {
      device,
      location: getGeolocationSnapshot(),
      session: getSessionContext(),
      behavior: tracker?.snapshot() ?? null,
    };

    // Every exit path resets the spinner. Previously an error here — most
    // often a declined-for-funds transfer — threw straight past the navigation
    // with nothing to catch it, so the button sat on "Analyzing Risk…"
    // forever. A frictionless product must never strand the user mid-action.
    try {
      const minDelay = new Promise((resolve) => setTimeout(resolve, 1400));
      await Promise.all([
        submitTransfer({ amount: amountValue, recipient: contact, narration, channel }, sdk),
        minDelay,
      ]);
      router.push(href("/result"));
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        const short = err.shortfall > 0 ? ` You're ${formatNaira(err.shortfall)} short.` : "";
        setSubmitError(`Not enough balance for this transfer.${short} Add money and try again.`);
      } else {
        setSubmitError("We couldn't process this transfer just now. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Send money" />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* Recipient */}
          <Card>
            {/* Tab toggle */}
            <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 dark:bg-[#111] p-0.5 border border-gray-200 dark:border-white/[0.04]">
              <button
                type="button"
                onClick={() => setMode("beneficiary")}
                className={`flex-1 rounded-md py-2 text-[12px] font-medium transition-colors ${
                  mode === "beneficiary" ? "bg-white text-gray-900 dark:bg-[#1a1a1a] dark:text-white shadow-sm border border-gray-200 dark:border-white/[0.05]" : "text-gray-500 dark:text-white/35 hover:text-gray-700 dark:hover:text-white/60"
                }`}
              >
                Beneficiary
              </button>
              <button
                type="button"
                onClick={() => { setMode("new"); setContact(null); setVerify("idle"); }}
                className={`flex-1 rounded-md py-2 text-[12px] font-medium transition-colors ${
                  mode === "new" ? "bg-white text-gray-900 dark:bg-[#1a1a1a] dark:text-white shadow-sm border border-gray-200 dark:border-white/[0.05]" : "text-gray-500 dark:text-white/35 hover:text-gray-700 dark:hover:text-white/60"
                }`}
              >
                New account
              </button>
            </div>

            {mode === "beneficiary" ? (
              /* Saved beneficiaries */
              <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-hide">
                {CONTACTS.map((c) => {
                  const selected = contact?.accountNumber === c.accountNumber && mode === "beneficiary";
                  return (
                    <button
                      key={c.accountNumber}
                      type="button"
                      onClick={() => selectContact(c)}
                      className="flex shrink-0 flex-col items-center gap-1.5"
                    >
                      <span className={`rounded-full p-0.5 transition-all ${selected ? "ring-2 ring-[#7C3AED]" : ""}`}>
                        <Avatar name={c.name} size="lg" />
                      </span>
                      <span className={`text-[11px] font-medium ${selected ? "text-[#7C3AED]" : "text-gray-500 dark:text-white/35"}`}>
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* New account input */
              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-400 dark:text-white/25 uppercase tracking-wider">Account number</label>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => handleAccountInput(e.target.value)}
                    onKeyDown={recordKey("account_number")}
                    onPaste={recordPaste("account_number")}
                    placeholder="Enter 10-digit account number"
                    className="w-full rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[14px] text-gray-900 dark:text-white tabular-nums outline-none placeholder:text-gray-400 dark:placeholder:text-white/15 focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-gray-400 dark:text-white/25 uppercase tracking-wider">Bank</label>
                    <span className={`text-[10px] font-semibold ${bankSource === "paystack" ? "text-emerald-500" : "text-gray-400 dark:text-white/25"}`}>
                      {bankSource === "paystack" ? `${banks.length} banks · live` : "built-in list"}
                    </span>
                  </div>
                  <div className="relative">
                    <select
                      value={selectedBankCode}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      className="w-full appearance-none rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[13px] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
                    >
                      <option value="" disabled>Select bank</option>
                      {banks.map((b) => <option key={`${b.code}-${b.name}`} value={b.code}>{b.name}</option>)}
                    </select>
                    <CaretDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/25" />
                  </div>
                </div>
              </div>
            )}

            {/* Verification status */}
            {(verify === "verifying" || verify === "verified" || verify === "error") && (
              <div
                className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] transition-colors border ${
                  verify === "verified"
                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20"
                    : verify === "error"
                    ? "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20"
                    : "bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-white/40 border-gray-200 dark:border-white/[0.05]"
                }`}
              >
                {verify === "verifying" ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-white/10 border-t-white/40" />
                    <span>Resolving account details...</span>
                  </>
                ) : verify === "error" ? (
                  <>
                    <XCircle size={16} weight="fill" />
                    <span>Account not found. Please check details.</span>
                  </>
                ) : contact ? (
                  <>
                    <Check size={16} weight="bold" />
                    <span>
                      <span className="font-semibold">{contact.name}</span> · {contact.bank}
                      {resolveSource === "paystack" ? (
                        <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">NUBAN verified</span>
                      ) : (
                        <span
                          className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                          title={FALLBACK_HINTS[fallbackReason ?? "no_key"]}
                        >
                          Simulated name
                        </span>
                      )}
                    </span>
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {/* Amount */}
          <Card>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">Amount</p>
            <div className="flex items-center justify-center gap-1 py-3">
              <span className="text-[24px] font-bold text-gray-400 dark:text-white/15">₦</span>
              <input
                inputMode="numeric"
                value={amount ? Number(amount).toLocaleString("en-NG") : ""}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={recordKey("amount")}
                onPaste={recordPaste("amount")}
                placeholder="0"
                className="w-full bg-transparent text-center text-[40px] font-bold tabular-nums text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-white/10"
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className={`rounded-lg py-2.5 text-[11px] font-semibold transition-colors border ${
                    amountValue === a
                      ? "text-white"
                      : "bg-gray-50 dark:bg-[#111] text-gray-600 dark:text-white/35 hover:bg-gray-100 dark:hover:bg-[#222] border-gray-200 dark:border-white/[0.04]"
                  }`}
                >
                  ₦{a >= 1000 ? `${a / 1000}k` : a}
                </button>
              ))}
            </div>
          </Card>

          {/* Fable SDK — live collection panel */}
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Eye size={15} weight="fill" className="text-[#7C3AED]" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">Fable is watching — real data collected</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-[#111] px-3 py-2.5 border border-gray-200 dark:border-white/[0.04]">
                <Fingerprint size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="min-w-0 text-[11px]">
                  <p className="font-semibold text-gray-700 dark:text-white/70">Device</p>
                  {device ? (
                    <p className="truncate text-gray-500 dark:text-white/40">
                      <span className="font-mono">{device.fingerprint_id}</span> · {device.os} · {device.browser}
                      {device.battery_level != null && ` · 🔋${Math.round(device.battery_level * 100)}%`}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-white/25">Fingerprinting…</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-[#111] px-3 py-2.5 border border-gray-200 dark:border-white/[0.04]">
                <MapPin size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="min-w-0 text-[11px]">
                  <p className="font-semibold text-gray-700 dark:text-white/70">Location</p>
                  {location ? (
                    location.source === "unavailable" ? (
                      <p className="text-gray-400 dark:text-white/25">Unavailable (GPS denied, IP lookup failed)</p>
                    ) : (
                      <p className="truncate text-gray-500 dark:text-white/40">
                        {[location.city, location.country].filter(Boolean).join(", ") || `${location.latitude?.toFixed(3)}, ${location.longitude?.toFixed(3)}`}
                        <span className="ml-1.5 rounded bg-[#7C3AED]/10 px-1 py-0.5 text-[9px] font-bold uppercase text-[#7C3AED]">{location.source}</span>
                      </p>
                    )
                  ) : (
                    <p className="text-gray-400 dark:text-white/25">Locating… (allow GPS or IP fallback)</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-[#111] px-3 py-2.5 border border-gray-200 dark:border-white/[0.04]">
                <Timer size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="min-w-0 text-[11px]">
                  <p className="font-semibold text-gray-700 dark:text-white/70">Session</p>
                  {session ? (
                    <p className="text-gray-500 dark:text-white/40">
                      {sessionSeconds < 60 ? `${sessionSeconds}s` : `${Math.floor(sessionSeconds / 60)}m ${sessionSeconds % 60}s`} since login · {session.authMethod}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-white/25">Starting…</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-[#111] px-3 py-2.5 border border-gray-200 dark:border-white/[0.04]">
                <Crosshair size={16} className="mt-0.5 shrink-0 text-[#7C3AED]" />
                <div className="min-w-0 text-[11px]">
                  <p className="font-semibold text-gray-700 dark:text-white/70">Behavior</p>
                  <p className="text-gray-500 dark:text-white/40">
                    Typing, pointer, scroll &amp; paste tracked live
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold text-gray-400 dark:text-white/25 uppercase tracking-wider">Narration</label>
              <input
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                onKeyDown={recordKey("narration")}
                onPaste={recordPaste("narration")}
                placeholder="What's this for?"
                className="w-full rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[13px] text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-white/15 focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
              />
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-white/30">
                Try <span className="font-medium text-amber-500 dark:text-amber-400/60">&ldquo;urgent help abeg&rdquo;</span> to a new contact to test Fable Shield.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[11px] font-bold text-gray-400 dark:text-white/25 uppercase tracking-wider">Channel</label>
                {detectedChannel && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 dark:text-white/30">
                    <DeviceMobile size={12} />
                    auto-detected: {CHANNEL_LABELS[detectedChannel]}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`relative rounded-xl py-2.5 text-[12px] font-medium transition-colors border ${
                      channel === ch
                        ? "text-white"
                        : "bg-gray-50 dark:bg-[#111] text-gray-600 dark:text-white/35 hover:bg-gray-100 dark:hover:bg-[#222] border-gray-200 dark:border-white/[0.04]"
                    }`}
                  >
                    {CHANNEL_LABELS[ch]}
                    {detectedChannel === ch && (
                      <span className={`absolute -top-1.5 -right-1.5 rounded-full px-1.5 text-[8px] font-bold uppercase ${channel === ch ? "bg-white text-[#7C3AED]" : "bg-[#7C3AED] text-white"}`}>
                        auto
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-2.5 flex items-center justify-between text-[13px]">
              <span className="text-gray-500 dark:text-white/40">Transfer amount</span>
              <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{formatNaira(amountValue)}</span>
            </div>
            <div className="mb-5 flex items-center justify-between text-[13px]">
              <span className="text-gray-500 dark:text-white/40">Transaction fee</span>
              <span className="font-semibold tabular-nums text-gray-900 dark:text-white">₦10.00</span>
            </div>

            <div className="mb-5 flex items-center justify-between border-t border-gray-200 dark:border-white/[0.04] pt-4 text-[14px]">
              <span className="font-bold text-gray-700 dark:text-white/60">Total debit</span>
              <span className="font-bold tabular-nums text-gray-900 dark:text-white">{formatNaira(amountValue + 10)}</span>
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              style={canSubmit ? { backgroundColor: "var(--brand-primary, #7C3AED)" } : undefined}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-[#111] disabled:text-gray-400 dark:disabled:text-white/15 disabled:border disabled:border-gray-200 dark:disabled:border-white/[0.04] shadow-lg disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <CircleNotch size={18} className="animate-spin" />
                  Analyzing Risk...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} weight="fill" />
                  Send {formatNaira(amountValue)}
                </>
              )}
            </button>

            {submitError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <span className="flex-1">{submitError}</span>
                <Link href={href("/add-money")} className="shrink-0 font-bold underline">
                  Add money
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}
