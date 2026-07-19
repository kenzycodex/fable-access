"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Power, WarningCircle } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { getApiKey, setApiKey } from "@/lib/fable/tenant";

/**
 * Integration status, as a power button.
 *
 * Reads instantly the way a hardware power light does: red when this app
 * isn't authenticated to an institution, green and breathing when it is.
 * Tapping opens the sheet that explains what that means and takes the key.
 */
export function PowerConnect() {
  const { name, institutionId } = useInstitution();
  const [open, setOpen] = useState(false);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConnectedKey(getApiKey());
  }, []);

  const connected = Boolean(connectedKey);

  function save() {
    const trimmed = keyInput.trim();
    setApiKey(trimmed || null);
    setConnectedKey(trimmed || null);
    setKeyInput("");
    if (trimmed) setOpen(false);
  }

  function disconnect() {
    setApiKey(null);
    setConnectedKey(null);
    setKeyInput("");
  }

  // Render a neutral shell until mounted so SSR and first paint agree
  // (the key lives in localStorage, which the server can't see).
  const state = !mounted ? "idle" : connected ? "on" : "off";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={connected ? `Connected to ${name}` : "Not connected to an institution"}
        title={connected ? `Connected to ${name}` : "Connect this app to an institution"}
        className={`group relative flex size-10 items-center justify-center rounded-xl border transition-all ${
          state === "on"
            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-500 dark:border-emerald-400/30 dark:text-emerald-400"
            : state === "off"
              ? "border-red-400/40 bg-red-500/12 text-red-500 dark:border-red-400/25 dark:text-red-400"
              : "border-gray-200 bg-gray-200 text-gray-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/30"
        }`}
      >
        {/* Connected: a slow breathing halo, plus a rotating conic sweep —
            enough motion to read as "live" without becoming a distraction. */}
        {state === "on" && (
          <>
            <span className="pointer-events-none absolute inset-0 rounded-xl bg-emerald-500/25 blur-md animate-pulse-glow" />
            <span
              className="pointer-events-none absolute -inset-px rounded-xl opacity-60 animate-spin-slow"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, transparent 250deg, rgba(16,185,129,0.85) 320deg, transparent 360deg)",
                maskImage: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))",
                WebkitMaskImage:
                  "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))",
              }}
            />
          </>
        )}
        <Power size={18} weight="bold" className="relative z-10" />

        {/* Status pip, so state survives colour-blindness and glare */}
        <span
          className={`absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full border-2 border-white dark:border-[#111] ${
            state === "on" ? "bg-emerald-500" : state === "off" ? "bg-red-500" : "bg-gray-400"
          }`}
        />
      </button>

      <DemoSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Institution connection"
        subtitle="How this banking app authenticates to Fable"
      >
        <div className="flex flex-col gap-4">
          {/* Live status */}
          <div
            className={`flex items-start gap-3 rounded-2xl border p-4 ${
              connected
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                : "border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10"
            }`}
          >
            <span
              className={`relative flex size-9 shrink-0 items-center justify-center rounded-xl ${
                connected
                  ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400"
              }`}
            >
              {connected && (
                <span className="absolute inset-0 rounded-xl bg-emerald-500/30 blur-md animate-pulse-glow" />
              )}
              <Power size={17} weight="bold" className="relative z-10" />
            </span>
            <div className="min-w-0">
              <p
                className={`text-[13px] font-bold ${
                  connected
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
                }`}
              >
                {connected ? "Connected" : "Not connected"}
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-white/50">
                {connected ? (
                  <>
                    Every transfer is authenticated with your API key and booked to that
                    institution.
                  </>
                ) : (
                  <>
                    Transfers fall back to the institution in the URL —{" "}
                    <span className="font-semibold text-gray-800 dark:text-white/70">{name}</span>.
                    Fine for a demo, but unauthenticated.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Current tenant */}
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-2.5 dark:bg-[#141414]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
              Institution
            </span>
            <span className="min-w-0 text-right">
              <span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-white">
                {name}
              </span>
              <span className="block font-mono text-[10px] text-gray-400 dark:text-white/25">
                {institutionId}
              </span>
            </span>
          </div>

          {/* Key entry */}
          <div>
            <label
              htmlFor="fable-api-key"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25"
            >
              Institution API key
            </label>
            <input
              id="fable-api-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder={connected ? "Replace the connected key…" : "fable_live_..."}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 font-mono text-[12px] text-gray-900 outline-none transition-shadow focus:ring-2 focus:ring-[#7C3AED]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
            />
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-white/35">
              {connected ? (
                <CheckCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />
              ) : (
                <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
              )}
              <span>
                This is how a bank plugs into Fable: paste the key from your provisioning email
                and the key, not the URL, decides which institution the transfer belongs to.
              </span>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!keyInput.trim()}
              className="flex-1 rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/[0.05] dark:disabled:text-white/20"
            >
              Connect
            </button>
            {connected && (
              <button
                type="button"
                onClick={disconnect}
                className="rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-white/50 dark:hover:bg-white/[0.04]"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </DemoSheet>
    </>
  );
}
