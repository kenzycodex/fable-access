"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CaretDown, ShieldCheck, XCircle } from "@phosphor-icons/react";
import { Avatar, Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { formatNaira } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import { CONTACTS, QUICK_AMOUNTS } from "@/lib/fable/seed";
import { submitTransfer } from "@/lib/fable/store";
import type { Channel, Recipient } from "@/lib/fable/types";

const BANKS = ["Zenith Bank", "GTBank", "Access Bank", "First Bank", "UBA", "Moniepoint", "OPay", "Kuda MFB", "Palmpay"];

const CHANNELS: Channel[] = ["app", "ussd", "web"];
type VerifyState = "idle" | "verifying" | "verified" | "error";

export default function TransferPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"beneficiary" | "new">("beneficiary");
  const [contact, setContact] = useState<Recipient | null>(null);
  const [verify, setVerify] = useState<VerifyState>("idle");
  const [accountNumber, setAccountNumber] = useState("");
  const [selectedBank, setSelectedBank] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [channel, setChannel] = useState<Channel>("app");
  const [submitting, setSubmitting] = useState(false);
  
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
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => setVerify("verified"), 950);
  }

  function handleAccountInput(val: string) {
    const clean = val.replace(/\D/g, "").slice(0, 10);
    setAccountNumber(clean);
    setMode("new");
    setContact(null);
    if (clean.length === 10 && selectedBank) {
      startNewVerify(clean, selectedBank);
    } else {
      setVerify("idle");
    }
  }

  function handleBankSelect(bank: string) {
    setSelectedBank(bank);
    if (accountNumber.length === 10 && bank) {
      startNewVerify(accountNumber, bank);
    }
  }

  async function startNewVerify(acct: string, bank: string) {
    setVerify("verifying");
    setContact(null);
    
    try {
      const res = await fetch("/api/resolve-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber: acct, bankCode: bank }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setVerify("error");
        return;
      }
      
      setContact({
        name: data.accountName,
        bank: data.bankCode,
        bankCode: "000",
        accountNumber: data.accountNumber,
        known: false,
      });
      setVerify("verified");
    } catch (e) {
      setVerify("error");
    }
  }

  const amountValue = Number(amount) || 0;
  const canSubmit = contact !== null && verify === "verified" && amountValue > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 1400));
    await Promise.all([
      submitTransfer({ amount: amountValue, recipient: contact, narration, channel }),
      minDelay,
    ]);
    router.push("/demo/result");
  }

  return (
    <Screen>
      <ScreenHeader title="Send money" backHref="/demo" />

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
                    placeholder="Enter 10-digit account number"
                    className="w-full rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[14px] text-gray-900 dark:text-white tabular-nums outline-none placeholder:text-gray-400 dark:placeholder:text-white/15 focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-gray-400 dark:text-white/25 uppercase tracking-wider">Bank</label>
                  <div className="relative">
                    <select
                      value={selectedBank}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      className="w-full appearance-none rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[13px] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
                    >
                      <option value="" disabled>Select bank</option>
                      {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
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
                      ? "bg-[#7C3AED] text-white border-[#7C3AED]"
                      : "bg-gray-50 dark:bg-[#111] text-gray-600 dark:text-white/35 hover:bg-gray-100 dark:hover:bg-[#222] border-gray-200 dark:border-white/[0.04]"
                  }`}
                >
                  ₦{a >= 1000 ? `${a / 1000}k` : a}
                </button>
              ))}
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
                placeholder="What's this for?"
                className="w-full rounded-xl bg-gray-50 dark:bg-[#111] px-4 py-3 text-[13px] text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-white/15 focus:ring-1 focus:ring-[#7C3AED]/40 transition-all border border-gray-200 dark:border-white/[0.04]"
              />
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-white/30">
                Try <span className="font-medium text-amber-500 dark:text-amber-400/60">&ldquo;urgent help abeg&rdquo;</span> to a new contact to test Fable Shield.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold text-white/25 uppercase tracking-wider">Channel</label>
              <div className="grid grid-cols-3 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`rounded-xl py-2.5 text-[12px] font-medium transition-colors border ${
                      channel === ch
                        ? "bg-[#7C3AED] text-white border-[#7C3AED]"
                        : "bg-gray-50 dark:bg-[#111] text-gray-600 dark:text-white/35 hover:bg-gray-100 dark:hover:bg-[#222] border-gray-200 dark:border-white/[0.04]"
                    }`}
                  >
                    {CHANNEL_LABELS[ch]}
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED] py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-[#111] disabled:text-gray-400 dark:disabled:text-white/15 disabled:border disabled:border-gray-200 dark:disabled:border-white/[0.04] shadow-lg shadow-[#7C3AED]/20 disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Analyzing Risk...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} weight="fill" />
                  Send {formatNaira(amountValue)}
                </>
              )}
            </button>
          </Card>
        </div>
      </div>
    </Screen>
  );
}
