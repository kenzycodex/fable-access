"use client";

import { ShieldCheck, X } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import type { CopilotBaseline } from "@/lib/fable/api";
import { previewScore } from "@/lib/fable/scoring";
import { setTransparency, useFableStore } from "@/lib/fable/store";
import type { TransparencyState } from "@/lib/fable/types";
import { useCopilotBaseline } from "@/lib/fable/useBackend";

const CHANNEL_NAMES: Record<string, string> = {
  mobile_app: "Mobile App",
  ussd: "USSD",
  internet: "Web",
  pos: "POS",
  atm: "ATM",
};

/** Build the "what Copilot knows" rows from the real backend baseline, falling
 * back to sensible copy while it loads. */
function buildSignals(b?: CopilotBaseline): { key: keyof TransparencyState; label: string; desc: string }[] {
  return [
    { key: "typicalRange", label: "Spending patterns", desc: b ? `${b.typical_transfer_range} typical range` : "Learning your range…" },
    { key: "activeHours", label: "Active hours", desc: b ? `${b.active_hours} usual activity` : "Learning your hours…" },
    { key: "trustedRecipients", label: "Trusted contacts", desc: b ? `${b.trusted_recipients_count} saved recipients` : "Learning your contacts…" },
    { key: "knownDevices", label: "Device recognition", desc: b ? `${b.known_devices_count} verified device${b.known_devices_count === 1 ? "" : "s"}` : "1 verified device" },
    { key: "channel", label: "Channel analysis", desc: b ? `${CHANNEL_NAMES[b.preferred_channel] ?? b.preferred_channel} preferred` : "Mobile App preferred" },
  ];
}

const NEVER_STORED = [
  "Messages or call history",
  "GPS location data",
  "Card numbers or PINs",
  "Sold to third parties",
];

export default function TransparencyPage() {
  const store = useFableStore();
  const state = store?.transparency;
  const { data: baseline } = useCopilotBaseline();
  const SIGNALS = buildSignals(baseline);

  const preview = state ? previewScore(state) : 0;
  const pct = Math.round(preview * 100);
  const level = pct >= 80 ? "High" : pct >= 50 ? "Medium" : "Low";
  const levelColor = pct >= 80 ? "text-red-400" : pct >= 50 ? "text-amber-400" : "text-emerald-400";
  const barColor = pct >= 80 ? "bg-red-400" : pct >= 50 ? "bg-amber-400" : "bg-emerald-400";

  const enabledCount = state ? Object.values(state).filter(Boolean).length : 5;

  if (!state) {
    return (
      <Screen>
        <ScreenHeader title="Security" subtitle="Privacy & fraud protection" />
        <div className="flex min-h-[300px] items-center justify-center text-[13px] text-white/50">Loading…</div>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Security" subtitle="Privacy & fraud protection" />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-5">
        {/* Main column */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* Protection level */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#7C3AED]/15 text-[#7C3AED]">
                <ShieldCheck size={20} weight="fill" />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Protection level</p>
                <p className="text-[11px] text-gray-500 dark:text-white/40">{enabledCount} of 5 signals active</p>
              </div>
              <span className={`ml-auto text-[24px] font-bold tabular-nums ${levelColor}`}>
                {pct}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#111]">
              <div
                className={`h-full rounded-full ${barColor} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-gray-500 dark:text-white/30">
                Risk level: <span className={`font-medium ${levelColor}`}>{level}</span>
              </p>
              <p className="text-[11px] text-gray-400 dark:text-white/25">on ₦180k test transfer</p>
            </div>
          </Card>

          {/* Signal toggles */}
          <Card className="!p-0">
            <p className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
              Protection signals
            </p>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {store === null
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
                      <button
                        type="button"
                        role="switch"
                        aria-checked={state![s.key] as boolean}
                        aria-label={s.label}
                        onClick={() => setTransparency({ [s.key]: !state![s.key] })}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          state![s.key] ? "bg-[#7C3AED] shadow-[0_0_12px_rgba(124,58,237,0.4)]" : "bg-gray-200 dark:bg-white/10"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            state![s.key] ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
            </div>
            
            {/* Advanced configurations */}
            <p className="px-4 pt-6 pb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25 border-t border-gray-100 dark:border-white/[0.04]">
              Advanced Defenses
            </p>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {store !== null && state && (
                <>
                  {/* Velocity Limit */}
                  <div className="flex flex-col gap-2 px-4 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Velocity Limit</span>
                        <span className="text-[11px] text-gray-500 dark:text-white/40">Max transfers allowed per hour</span>
                      </div>
                      <span className="text-[14px] font-bold tabular-nums text-[#7C3AED]">{state.velocityLimit}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={state.velocityLimit}
                      onChange={(e) => setTransparency({ velocityLimit: parseInt(e.target.value) })}
                      className="w-full mt-2 accent-[#7C3AED]"
                    />
                  </div>

                  {/* Containment Window */}
                  <div className="flex flex-col gap-2 px-4 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Containment Window</span>
                        <span className="text-[11px] text-gray-500 dark:text-white/40">Ghost holding period for flagged transfers</span>
                      </div>
                      <span className="text-[14px] font-bold tabular-nums text-emerald-500">{state.containmentWindow} hrs</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="72"
                      value={state.containmentWindow}
                      onChange={(e) => setTransparency({ containmentWindow: parseInt(e.target.value) })}
                      className="w-full mt-2 accent-emerald-500"
                    />
                  </div>

                  {/* Biometric Strictness */}
                  <div className="flex flex-col gap-2 px-4 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Biometric Strictness</span>
                        <span className="text-[11px] text-gray-500 dark:text-white/40">Confidence required for Face ID checks</span>
                      </div>
                      <span className="text-[14px] font-bold tabular-nums text-amber-500">{state.biometricStrictness}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={state.biometricStrictness}
                      onChange={(e) => setTransparency({ biometricStrictness: parseInt(e.target.value) })}
                      className="w-full mt-2 accent-amber-500"
                    />
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Live Intelligence Feed */}
          <Card className="border-[#7C3AED]/20 shadow-[0_0_20px_rgba(124,58,237,0.05)]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7C3AED]">Live Intelligence Feed</p>
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7C3AED] opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-[#7C3AED]"></span>
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                <p className="text-[12px] font-semibold text-red-500 dark:text-red-400 mb-1">Threat Blocked</p>
                <p className="text-[11px] text-red-400/80 leading-relaxed">
                  Deepfake synthesis detected attempting login. Access to ₦18.4M held in Ghost containment.
                </p>
              </div>
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                <p className="text-[12px] font-semibold text-emerald-500 dark:text-emerald-400 mb-1">Network Update</p>
                <p className="text-[11px] text-emerald-400/80 leading-relaxed">
                  2,104 new device fingerprints added to known-bad cluster. Shield baseline updated globally.
                </p>
              </div>
            </div>
          </Card>

          {/* How it works */}
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25 mb-3">How it works</p>
            <div className="flex flex-col gap-2.5">
              {[
                "Learns your normal spending patterns",
                "Scores every transfer in under 200ms",
                "Flags or blocks suspicious activity",
                "You stay in control of what's tracked",
              ].map((step, i) => (
                <div key={step} className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-purple-50 dark:bg-[#7C3AED]/10 text-[10px] font-semibold text-[#7C3AED] mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] leading-relaxed text-gray-600 dark:text-white/50">{step}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Data we never store */}
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
