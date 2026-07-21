"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Power } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { resolveApiKey } from "@/lib/fable/api";
import { getApiKey, setApiKey } from "@/lib/fable/tenant";

/** Ring sweeps, then the tick strokes itself in. Pure SVG, no dependency. */
function SuccessTick() {
  return (
    <svg viewBox="0 0 64 64" className="size-16" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="27" className="stroke-emerald-500/15" strokeWidth="4" />
      <circle
        cx="32"
        cy="32"
        r="27"
        className="stroke-emerald-500 animate-check-ring"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M21 33.5 L28.5 41 L43 25"
        className="stroke-emerald-500 animate-check-stroke"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Integration status, as a power button.
 *
 * Reads like a hardware power light: red when this app isn't authenticated to
 * an institution, green and breathing when it is.
 */
export function PowerConnect() {
  const { name, institutionId } = useInstitution();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [justConnected, setJustConnected] = useState(false);
  const [connectedTo, setConnectedTo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setMounted(true);
    setConnectedKey(getApiKey());
    return () => clearTimeout(closeTimer.current);
  }, []);

  async function save() {
    const trimmed = keyInput.trim();
    if (!trimmed || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      // The key has to be resolved before it's stored. Accepting any string
      // and showing a green light told the operator they were connected to
      // one institution while writes were attributed to another — or to none.
      const resolved = await resolveApiKey(trimmed);
      setApiKey(trimmed);
      setConnectedKey(trimmed);
      setKeyInput("");
      setJustConnected(true);
      setConnectedTo(resolved.name);

      closeTimer.current = setTimeout(() => {
        setJustConnected(false);
        setOpen(false);
        // The key is authoritative, so the app must move to the institution it
        // belongs to. Leaving the URL on another tenant is what made this look
        // broken: the header said Meridian while transfers booked to Zenith.
        if (resolved.institution_id !== institutionId) {
          router.push(resolved.demo_url);
        }
      }, 1600);
    } catch {
      setError("That API key isn't recognised. Check the key in your provisioning email.");
    } finally {
      setVerifying(false);
    }
  }

  function disconnect() {
    setApiKey(null);
    setConnectedKey(null);
    setConnectedTo(null);
    setKeyInput("");
    setError(null);
  }

  function close() {
    clearTimeout(closeTimer.current);
    setJustConnected(false);
    setError(null);
    setOpen(false);
  }

  const connected = Boolean(connectedKey);
  // Neutral until mounted: the key lives in localStorage, which SSR can't see.
  const state = !mounted ? "idle" : connected ? "on" : "off";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={connected ? `Connected to ${name}` : "Not connected to an institution"}
        title={connected ? `Connected to ${name}` : "Connect to an institution"}
        className={`group relative flex size-10 items-center justify-center rounded-xl border transition-all ${
          state === "on"
            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-500 dark:border-emerald-400/30 dark:text-emerald-400"
            : state === "off"
              ? "border-red-400/40 bg-red-500/12 text-red-500 dark:border-red-400/25 dark:text-red-400"
              : "border-gray-200 bg-gray-200 text-gray-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/30"
        }`}
      >
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
        onClose={close}
        title="Institution connection"
        subtitle="How this app authenticates to Fable"
      >
        {justConnected ? (
          <div className="flex flex-col items-center gap-3 py-10 animate-check-pop">
            <SuccessTick />
            <p className="text-[15px] font-bold text-gray-900 dark:text-white">Connected</p>
            <p className="text-[12px] text-gray-500 dark:text-white/40">
              Transfers now authenticate as {connectedTo ?? name}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Status */}
            <div
              className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
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
                    connected ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
                  }`}
                >
                  {connected ? "Connected" : "Not connected"}
                </p>
                <p className="text-[12px] text-gray-600 dark:text-white/50">
                  {connected ? "Authenticated by API key." : "Using the institution in the URL."}
                </p>
              </div>
            </div>

            {/* Tenant */}
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

            {/* Key */}
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
                placeholder={connected ? "Replace the connected key…" : "fbl_live_..."}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 font-mono text-[12px] text-gray-900 outline-none transition-shadow focus:ring-2 focus:ring-[var(--brand-primary)]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-white/35">
                From your provisioning email. The key, not the URL, decides the institution —
                connecting a different bank&apos;s key switches this app to that bank.
              </p>
              {error && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={!keyInput.trim() || verifying}
                className="flex-1 rounded-xl bg-[var(--brand-primary)] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/[0.05] dark:disabled:text-white/20"
              >
                {verifying ? "Verifying…" : "Connect"}
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
        )}
      </DemoSheet>
    </>
  );
}
