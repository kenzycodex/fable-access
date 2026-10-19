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
import { DemoSheet } from "@/components/demo/DemoSheet";
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
import { accountBalance, FableUnavailableError, InsufficientFundsError, sandboxRecipients, type SavedRecipient } from "@/lib/fable/api";
import { collectDeviceFingerprint, type DeviceFingerprint } from "@/lib/fable/fingerprint";
import { formatNaira } from "@/lib/fable/format";
import { getGeolocationSnapshot, subscribeGeolocation, type GeoLocation } from "@/lib/fable/geolocation";
import { CHANNEL_LABELS } from "@/lib/fable/constants";
import { QUICK_AMOUNTS } from "@/lib/fable/seed";
import { ensureSession, getSessionContext, type BankingSession } from "@/lib/fable/session";
import { submitTransfer } from "@/lib/fable/store";
import { authHeaders } from "@/lib/fable/tenant";
import type { Channel, Recipient } from "@/lib/fable/types";

interface Bank {
  name: string;
  code: string;
}

const CHANNELS: Channel[] = ["app", "ussd", "web"];
/** The smallest transfer the sandbox app accepts, shown in the amount range. */
const MIN_TRANSFER = 10;

/** A word for the amount's size, so a slipped zero is noticed before sending
 * (₦50,000 reads "Tens of thousands"; ₦500,000 reads "Hundreds of thousands"). */
function magnitude(n: number): string {
  if (n < 1_000) return "";
  const names = ["Thousands", "Tens of thousands", "Hundreds of thousands", "Millions", "Tens of millions",
    "Hundreds of millions"];
  const step = Math.floor(Math.log10(n)) - 3;
  return step < names.length ? names[step] : "Billions";
}
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
  const submitRef = useRef<{ key: string; reference: string } | null>(null);
  const [narration, setNarration] = useState("");
  const [channel, setChannel] = useState<Channel>("app");
  const [detectedChannel, setDetectedChannel] = useState<Channel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // What the Fable SDK has actually collected on this page.
  const [device, setDevice] = useState<DeviceFingerprint | null>(null);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [session, setSession] = useState<BankingSession | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  const { data: account } = useSWR(
    customer ? ["account", customer.user_id, institutionId] : null,
    () => accountBalance(customer!.user_id, institutionId),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  useEffect(() => {
    const t = new BehavioralTracker();
    t.start();
    tracker = t;

    void collectDeviceFingerprint().then(setDevice);
    // Shown the moment a first reading exists, then updated as it sharpens.
    const stopLocation = subscribeGeolocation(setLocation);

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
      stopLocation();
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
  const bankCodeByName = useMemo(() => new Map(banks.map((b) => [b.name.toLowerCase(), b.code])), [banks]);

  // Saved recipients are the people this customer has actually paid before.
  const { data: savedData } = useSWR(
    customer ? ["saved-recipients", customer.user_id] : null,
    () => sandboxRecipients(customer!.user_id),
  );
  const saved = savedData?.recipients ?? null;

  const verifyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(verifyTimer.current), []);

  function selectContact(c: SavedRecipient) {
    // Already verified: the server issued it from a completed transfer.
    setContact({
      name: c.name,
      bank: c.bank ?? "",
      bankCode: bankCodeByName.get((c.bank ?? "").toLowerCase()) ?? "",
      accountNumber: "",
      known: true,
      token: c.token,
      last4: c.account_last4,
    });
    setMode("saved");
    setResolveSource(null);
    setVerify("verified");
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
        // The lookup needs the signed-in session (src/lib/routeGuard.ts).
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
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
  const underMinimum = amountValue > 0 && amountValue < MIN_TRANSFER;
  const canSubmit = customer !== null && contact !== null && verify === "verified" && amountValue >= MIN_TRANSFER
    && !overBalance && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setReviewing(false);
    setSubmitting(true);
    setSubmitError(null);
    // One reference per transfer the customer is making, reused if they retry
    // after an error, so a retry returns the decision already made rather than
    // booking a second one. A changed amount or recipient starts a new one.
    const fingerprint = `${amountValue}|${contact.accountNumber || contact.token || contact.name}|${channel}`;
    if (!submitRef.current || submitRef.current.key !== fingerprint) {
      submitRef.current = { key: fingerprint, reference: `ref_${crypto.randomUUID()}` };
    }

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
      await Promise.all([
        submitTransfer({ amount: amountValue, recipient: contact, narration, channel }, sdk, submitRef.current.reference),
        minDelay,
      ]);
      submitRef.current = null;
      router.push(href("/result"));
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        const short = err.shortfall > 0 ? ` You're ${formatNaira(err.shortfall)} short.` : "";
        setSubmitError(`Not enough balance for this transfer.${short}`);
      } else if (err instanceof FableUnavailableError) {
        setSubmitError(err.message);
      } else {
        setSubmitError("We couldn't process this transfer just now. Nothing was sent. Please try again.");
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
              saved === null ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-[124px] animate-pulse rounded-2xl bg-d-surface-2" />)}
                </div>
              ) : saved.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-d-border px-4 py-8 text-center">
                  <p className="text-[14px] font-semibold text-d-text">No saved recipients yet</p>
                  <p className="max-w-[320px] text-[13px] text-d-muted">
                    People this customer has paid before appear here. Send to a new account to start.
                  </p>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className="rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white"
                  >
                    New account
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {saved.map((c) => {
                    const selected = contact?.token === c.token;
                    return (
                      <button
                        key={c.token}
                        type="button"
                        onClick={() => selectContact(c)}
                        className={`flex flex-col items-center gap-2 rounded-2xl border p-3.5 transition-all ${
                          selected ? "border-brand bg-brand/[0.06] ring-4 ring-brand/10" : "border-d-border hover:bg-d-surface-2"
                        }`}
                      >
                        <Avatar name={c.name} size="lg" />
                        <span className="line-clamp-1 text-center text-[13px] font-semibold text-d-text">{c.name}</span>
                        <span className="text-[11px] text-d-muted">
                          {c.bank ? `${c.bank} · ` : ""}
                          <span className="tabular-nums">{c.account_last4}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
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
              <p className="h-4 text-center text-[12px] font-semibold text-brand" aria-live="polite">{magnitude(amountValue)}</p>
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
                <p className="mt-1 text-center text-[12px] text-d-muted">
                  {formatNaira(MIN_TRANSFER)} to {formatNaira(Math.max(available, 0))} · Available {formatNaira(available)}
                </p>
              )}
              {underMinimum && (
                <p className="mt-1 text-center text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                  The smallest transfer is {formatNaira(MIN_TRANSFER)}.
                </p>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
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
              onClick={() => setReviewing(true)}
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

            <ReviewSheet
              open={reviewing}
              onClose={() => setReviewing(false)}
              onConfirm={handleSubmit}
              from={customer?.name ?? ""}
              to={contact}
              amount={amountValue}
              available={available}
              narration={narration}
              channel={CHANNEL_LABELS[channel]}
            />

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
                  <LocationStatus location={location} />
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

/** The check before money moves: who, how much, from what, and the reminder
 * that a sent transfer cannot be pulled back. Recheck closes it; nothing is
 * sent until the customer confirms here. */
function ReviewSheet({ open, onClose, onConfirm, from, to, amount, available, narration, channel }: {
  open: boolean; onClose: () => void; onConfirm: () => void; from: string; to: Recipient | null; amount: number;
  available: number | null; narration: string; channel: string;
}) {
  if (!to) return null;
  const account = to.accountNumber || (to.last4 ? `•••• ${to.last4}` : "");
  return (
    <DemoSheet open={open} onClose={onClose} title="Check before you send" subtitle="Nothing is sent until you confirm">
      <div className="flex flex-col gap-4 pb-1">
        <div className="rounded-2xl bg-d-surface-2 px-4 py-5 text-center">
          <p className="text-[30px] font-bold tabular-nums text-d-text">{formatNaira(amount)}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-brand">{magnitude(amount)}</p>
        </div>
        <div className="divide-y divide-d-border">
          <DetailRow label="To"><span className="font-semibold">{to.name}</span></DetailRow>
          {account && <DetailRow label="Account"><span className="tabular-nums">{account}</span></DetailRow>}
          <DetailRow label="Bank">{to.bank || "—"}</DetailRow>
          <DetailRow label="From">{from}</DetailRow>
          {narration && <DetailRow label="Narration"><span className="break-words">{narration}</span></DetailRow>}
          <DetailRow label="Sent via">{channel}</DetailRow>
          {available !== null && (
            <DetailRow label="Balance after"><span className="tabular-nums">{formatNaira(Math.max(available - amount, 0))}</span></DetailRow>
          )}
        </div>
        <Notice tone="warning" className="flex items-start gap-2 text-[12px]">
          <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            A transfer can&apos;t be reversed once it&apos;s sent. Check the name and amount. If anyone is rushing you or
            telling you to send money to keep it safe, stop: that is how scams work.
          </span>
        </Notice>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose}>Recheck</Button>
          <Button size="lg" onClick={onConfirm} icon={<PaperPlaneTilt size={18} weight="fill" />}>Confirm</Button>
        </div>
      </div>
    </DemoSheet>
  );
}

/** Whatever location was detected, stated plainly. The customer is not asked
 * to do anything here; the browser's own permission prompt runs on page load. */
function LocationStatus({ location }: { location: GeoLocation | null }) {
  if (!location) return <>Locating…</>;
  if (location.source === "gps") {
    const acc = location.accuracy_m;
    // A street address is only stated outright when the fix is tight enough to
    // stand behind it; a looser fix says "near", which is the honest reading.
    const exact = acc !== null && acc <= 50;
    const street = location.address ?? (exact ? location.plus_code?.split(" ")[0] : null);
    const place =
      [street, location.locality, location.district, location.city].filter(Boolean).join(", ") || "Device location";
    return (
      <>
        {(street && !exact ? "Near " : "") + place}
        {location.landmark && `, by ${location.landmark}`}
      </>
    );
  }
  return <>{[location.city, location.country].filter(Boolean).join(", ") || "Not available"}</>;
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
