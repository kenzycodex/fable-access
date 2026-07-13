"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { BrainIcon, EyeIcon, GhostIcon, ShieldIcon } from "@/components/app-icons";
import { Card, PageHeader } from "@/components/dashboard/primitives";
import { INSTITUTION } from "@/lib/fable/seed";
import { login, resetDemo } from "@/lib/fable/store";

const AGENTS = [
  { name: "Copilot", role: "Behavioral baseline. Always on.", icon: BrainIcon, locked: true },
  { name: "Shield", role: "Real-time scam & deepfake defense.", icon: ShieldIcon, locked: false },
  { name: "Ghost", role: "Cooling-window containment.", icon: GhostIcon, locked: false },
  { name: "Watch", role: "Passive between-session monitoring.", icon: EyeIcon, locked: false },
];

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [agents, setAgents] = useState({ Shield: true, Ghost: true, Watch: true });
  const [copied, setCopied] = useState(false);

  // Change password state
  const [cpEmail, setCpEmail] = useState(INSTITUTION.contactEmail);
  const [cpOld, setCpOld] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpSubmitting, setCpSubmitting] = useState(false);
  const [cpMsg, setCpMsg] = useState({ type: "", text: "" });

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (cpNew !== cpConfirm) {
      setCpMsg({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (cpNew.length < 8) {
      setCpMsg({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    setCpSubmitting(true);
    setCpMsg({ type: "", text: "" });
    try {
      const res = await fetch("http://localhost:8000/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cpEmail, old_password: cpOld, new_password: cpNew })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to change password");
      setCpMsg({ type: "success", text: "Password changed successfully." });
      setCpOld(""); setCpNew(""); setCpConfirm("");
    } catch (err: any) {
      setCpMsg({ type: "error", text: err.message });
    } finally {
      setCpSubmitting(false);
    }
  }

  function copyKey() {
    navigator.clipboard?.writeText("fbl_live_9c2a77e1b4d0f3a91").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function reset() {
    resetDemo();
    login(); // keep the session signed in after wiping data back to seed
    router.refresh();
  }

  return (
    <>
      <PageHeader title="Settings" description="Institution profile, agent configuration, API access, and billing." />

      {/* Profile */}
      <Card>
        <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Institution profile</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Institution name" value={INSTITUTION.name} />
          <Field label="Type" value={INSTITUTION.type} />
          <Field label="Contact email" value={INSTITUTION.contactEmail} />
          <Field label="Environment" value="Demo / sandbox" />
        </div>
      </Card>

      {/* Theme */}
      <Card>
        <h2 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Theme Configuration</h2>
        <p className="mb-4 text-[13px] text-gray-500 dark:text-white/50">Choose how the dashboard looks. System mode will match your OS settings.</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setTheme("dark")}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-bold transition-all ${
              theme === "dark" ? "bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#7C3AED]" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-white/60 dark:hover:bg-white/[0.05]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            Dark Mode
          </button>
          <button
            onClick={() => setTheme("light")}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-bold transition-all ${
              theme === "light" ? "bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#7C3AED]" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-white/60 dark:hover:bg-white/[0.05]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            Light Mode
          </button>
          <button
            onClick={() => setTheme("system")}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-bold transition-all ${
              theme === "system" ? "bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#7C3AED]" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-white/60 dark:hover:bg-white/[0.05]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            System
          </button>
        </div>
      </Card>

      {/* Agents */}
      <Card>
        <h2 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Agents</h2>
        <p className="mb-4 text-[13px] text-gray-500 dark:text-white/50">Turn add-on agents on or off. Copilot is included on every plan.</p>
        <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04]">
          {AGENTS.map((a) => {
            const Icon = a.icon;
            const on = a.locked ? true : agents[a.name as keyof typeof agents];
            return (
              <div key={a.name} className="flex items-center gap-4 py-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
                  <Icon className="size-5" />
                </span>
                <div className="flex flex-col">
                  <span className="text-[14px] font-bold text-gray-900 dark:text-white">{a.name}</span>
                  <span className="text-[12px] text-gray-500 dark:text-white/50">{a.role}</span>
                </div>
                <LightToggle
                  checked={on}
                  disabled={a.locked}
                  onChange={(next) => !a.locked && setAgents((s) => ({ ...s, [a.name]: next }))}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* API access */}
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">API access</h2>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Live secret key</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/[0.04] bg-gray-50 dark:bg-white/[0.02] px-4 py-3">
            <code className="flex-1 truncate text-[13px] text-gray-700 dark:text-white/70">fbl_live_9c2a•••••••••4a91</code>
            <button
              type="button"
              onClick={copyKey}
              className="rounded-md bg-gray-200 dark:bg-white/[0.04] px-3 py-1.5 text-[12px] font-bold text-gray-600 dark:text-white/70 transition-colors hover:bg-gray-300 dark:hover:bg-white/[0.08]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Webhook endpoint</p>
          <code className="mt-1.5 block truncate rounded-lg bg-gray-50 dark:bg-white/[0.02] px-4 py-3 text-[13px] text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/[0.04]">
            https://risk.meridian.ng/hooks/fable
          </code>
        </Card>

        {/* Billing */}
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Billing</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-gray-900 dark:text-white tracking-tight">₦100,000</span>
            <span className="text-[13px] text-gray-500 dark:text-white/50 font-medium">/ month</span>
          </div>
          <p className="mt-1 text-[13px] text-gray-600 dark:text-white/60 font-medium">Copilot + Shield, up to 50,000 transactions.</p>
          <ul className="mt-4 flex flex-col gap-2 text-[13px] text-gray-600 dark:text-white/70">
            <li>· Ghost billed separately on hold volume</li>
            <li>· Overage at ₦2 per additional transaction</li>
            <li>· Shared fraud-intelligence graph included</li>
          </ul>
        </Card>
      </div>

      {/* Security & Password */}
      <Card>
        <h2 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Security & Authentication</h2>
        <p className="mb-4 text-[13px] text-gray-500 dark:text-white/50">Update your administrator credentials.</p>
        
        {cpMsg.text && (
          <div className={`mb-4 rounded-lg border p-3 text-[13px] ${cpMsg.type === 'error' ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400' : 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
            {cpMsg.text}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Admin Email</label>
            <input type="email" value={cpEmail} onChange={e => setCpEmail(e.target.value)} required className="rounded-lg border border-gray-200 dark:border-white/[0.04] bg-white dark:bg-white/[0.02] px-3 py-2 text-[13px] text-gray-800 dark:text-white outline-none focus:border-[#7C3AED]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Current Password</label>
            <input type="password" value={cpOld} onChange={e => setCpOld(e.target.value)} required className="rounded-lg border border-gray-200 dark:border-white/[0.04] bg-white dark:bg-white/[0.02] px-3 py-2 text-[13px] text-gray-800 dark:text-white outline-none focus:border-[#7C3AED]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">New Password</label>
            <input type="password" value={cpNew} onChange={e => setCpNew(e.target.value)} required className="rounded-lg border border-gray-200 dark:border-white/[0.04] bg-white dark:bg-white/[0.02] px-3 py-2 text-[13px] text-gray-800 dark:text-white outline-none focus:border-[#7C3AED]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Confirm New Password</label>
            <input type="password" value={cpConfirm} onChange={e => setCpConfirm(e.target.value)} required className="rounded-lg border border-gray-200 dark:border-white/[0.04] bg-white dark:bg-white/[0.02] px-3 py-2 text-[13px] text-gray-800 dark:text-white outline-none focus:border-[#7C3AED]" />
          </div>
          <button type="submit" disabled={cpSubmitting} className="mt-2 w-fit rounded-lg bg-[#7C3AED] px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-50">
            {cpSubmitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/[0.02]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-red-600 dark:text-white">Reset demo data</h2>
            <p className="text-[13px] text-red-500/80 dark:text-white/50 mt-1">
              Wipe every transfer back to the seeded state, including anything made in the demo bank.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 rounded-full border border-red-500/50 bg-red-500/10 px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-red-400 transition-colors hover:bg-red-500/20 shadow-sm"
          >
            Reset demo
          </button>
        </div>
      </Card>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">{label}</span>
      <span className="rounded-lg border border-gray-200 dark:border-white/[0.04] bg-gray-50 dark:bg-white/[0.02] px-4 py-2.5 text-[13px] font-medium text-gray-800 dark:text-white/80">
        {value}
      </span>
    </div>
  );
}

function LightToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative ml-auto h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : "bg-gray-200 dark:bg-white/10"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5 border border-gray-200 dark:border-transparent"
        }`}
      />
    </button>
  );
}
