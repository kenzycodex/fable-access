"use client";

import { useEffect, useState } from "react";
import { CaretDown, CheckCircle, Link as LinkIcon, User } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { getApiKey, setApiKey } from "@/lib/fable/tenant";

/**
 * Who is using the demo bank, and which institution it's plugged into.
 *
 * The customer matters because Shield scores against that person's own
 * baseline: ₦250,000 is routine for Tunde the trader and a hard block for
 * Chioma the student. Switching customer here is what makes that visible.
 *
 * The API key field is the real integration path — a bank pastes the key it
 * was issued at provisioning and every call is then authenticated as that
 * institution, regardless of the URL.
 */
export function CustomerSwitcher() {
  const { customers, customer, selectCustomer, name, institutionId, offline } = useInstitution();
  const [open, setOpen] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [connectedKey, setConnectedKey] = useState<string | null>(null);

  useEffect(() => {
    setConnectedKey(getApiKey());
  }, []);

  // Default to the first customer so a transfer is never attributed to nobody.
  useEffect(() => {
    if (!customer && customers.length > 0) selectCustomer(customers[0]);
  }, [customer, customers, selectCustomer]);

  function connect() {
    const trimmed = keyInput.trim();
    setApiKey(trimmed || null);
    setConnectedKey(trimmed || null);
    setKeyInput("");
    setShowConnect(false);
  }

  return (
    <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/[0.05] dark:bg-[#0a0a0a]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Customer picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            disabled={customers.length === 0}
            className="flex items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100 disabled:opacity-50 dark:bg-[#141414] dark:hover:bg-[#1c1c1c]"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#7C3AED]/10 text-[#7C3AED]">
              <User size={16} weight="fill" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">
                {customer?.name ?? (customers.length ? "Select customer" : "No customers")}
              </span>
              <span className="block text-[11px] text-gray-500 dark:text-white/35">
                {customer ? `${customer.persona} · ${customer.typical_range}` : name}
              </span>
            </span>
            <CaretDown size={13} className={`ml-1 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[300px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#141414]">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/30">
                {name} customers
              </p>
              {customers.map((c) => (
                <button
                  key={c.user_id}
                  type="button"
                  onClick={() => {
                    selectCustomer(c);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    customer?.user_id === c.user_id
                      ? "bg-[#7C3AED]/10"
                      : "hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="flex items-center justify-between text-[13px] font-semibold text-gray-900 dark:text-white">
                    {c.name}
                    {customer?.user_id === c.user_id && <CheckCircle size={14} weight="fill" className="text-[#7C3AED]" />}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-white/40">{c.description}</span>
                  <span className="text-[10px] font-medium text-[#7C3AED]">Typical {c.typical_range}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Institution + connection state */}
        <div className="flex items-center gap-2">
          <span className="hidden text-right sm:block">
            <span className="block text-[11px] font-semibold text-gray-700 dark:text-white/60">{name}</span>
            <span className="block font-mono text-[10px] text-gray-400 dark:text-white/25">{institutionId}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowConnect(!showConnect)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              connectedKey
                ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
                : "border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:text-white/40 dark:hover:bg-white/[0.04]"
            }`}
          >
            <LinkIcon size={13} />
            {connectedKey ? "Connected" : "Connect"}
          </button>
        </div>
      </div>

      {offline && (
        <p className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          Fable API unreachable — the demo is running on the local scoring engine, and this
          institution&apos;s customer roster could not be loaded.
        </p>
      )}

      {showConnect && (
        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-white/[0.05]">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
            Institution API key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={connectedKey ? "Replace the connected key…" : "fable_live_..."}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] text-gray-900 outline-none focus:ring-1 focus:ring-[#7C3AED]/40 dark:border-white/[0.05] dark:bg-[#111] dark:text-white"
            />
            <button
              type="button"
              onClick={connect}
              className="rounded-lg bg-[#7C3AED] px-4 py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
            >
              {keyInput.trim() ? "Connect" : "Disconnect"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-white/35">
            This is how a bank plugs into Fable: paste the key from your provisioning email and
            every transfer is authenticated as that institution. Without a key the demo falls back
            to the institution in the URL.
          </p>
        </div>
      )}
    </div>
  );
}
