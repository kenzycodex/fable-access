"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, MagnifyingGlass } from "@phosphor-icons/react";
import { Card, PageHeader, StatCard } from "@/components/dashboard/primitives";
import { apiChannelLabel, resetCustomerPin, type CopilotCustomer } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import { useAgentsOverview, useCopilotCustomers } from "@/lib/fable/useBackend";

export default function CopilotAgentPage() {
  const { data: overview } = useAgentsOverview();
  const { data, mutate } = useCopilotCustomers();
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;
  const [query, setQuery] = useState("");

  const customers = useMemo(() => {
    const all = data?.customers ?? [];
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((c) => c.user_id.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <>
      <PageHeader
        title="Fable Copilot"
        description="The behavioral baseline engine. Everything below is what Copilot has genuinely learned from transaction history — per customer, from the live database."
        actions={
          <Link href="/dashboard/agents" className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white">
            <ArrowLeft size={14} weight="bold" /> All agents
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Customers learned" value={String(overview?.copilot.customers_learned ?? "—")} icon={<Brain size={16} weight="fill" />} />
        <StatCard label="Data points" value={(overview?.copilot.data_points ?? 0).toLocaleString("en-NG")} sub={`${overview?.copilot.live_data_points ?? 0} live`} />
        <StatCard label="Devices tracked" value={String(overview?.copilot.devices_tracked ?? "—")} accent="text-emerald-400" />
        <StatCard label="Locations tracked" value={String(overview?.copilot.locations_tracked ?? "—")} accent="text-amber-400" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">Per-customer baselines</h2>
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/25" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer id…"
              aria-label="Search customer id…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-[12px] text-gray-900 outline-none focus:ring-1 focus:ring-[#7C3AED]/40 dark:border-white/[0.05] dark:bg-[#111] dark:text-white sm:w-56"
            />
          </div>
        </div>

        {customers.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-gray-400 dark:text-white/30">
            {data ? "No customers match." : "Waiting for the Fable API…"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {customers.map((c) => (
              <div key={c.user_id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.04] dark:bg-[#0d0d0d]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-[#7C3AED]/10 text-[12px] font-bold text-[#7C3AED]">
                      {c.user_id.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <p className="font-mono text-[13px] font-semibold text-gray-900 dark:text-white">{c.user_id}</p>
                      <p className="text-[11px] text-gray-500 dark:text-white/35">
                        {c.transactions_analyzed.toLocaleString("en-NG")} transactions analyzed · {c.live_transactions} live
                      </p>
                    </div>
                  </div>
                  {c.has_baseline ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                      Baseline built
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                      Learning ({c.transactions_analyzed}/3 min)
                    </span>
                  )}
                </div>

                {c.has_baseline && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-4">
                    <BaselineFact label="Typical range" value={c.typical_range ?? "—"} />
                    <BaselineFact label="Active hours" value={c.active_hours ?? "—"} />
                    <BaselineFact label="Trusted recipients" value={String(c.trusted_recipients ?? 0)} />
                    <BaselineFact label="Known devices" value={String(c.known_devices ?? 0)} />
                    <BaselineFact label="Preferred channel" value={c.preferred_channel ? apiChannelLabel(c.preferred_channel) : "—"} />
                    <BaselineFact
                      label="Known cities"
                      value={c.known_cities && c.known_cities.length > 0 ? c.known_cities.join(", ") : "None yet"}
                    />
                    <BaselineFact
                      label="Avg session"
                      value={c.avg_session_duration_s != null ? `${Math.round(c.avg_session_duration_s)}s` : "No data yet"}
                    />
                    <BaselineFact
                      label="Avg time-to-submit"
                      value={c.avg_time_to_submit_s != null ? `${c.avg_time_to_submit_s}s` : "No data yet"}
                    />
                  </div>
                )}

                <VerificationRow
                  customer={c}
                  institutionId={institutionId}
                  onChanged={() => void mutate()}
                />

                <p className="mt-3 text-[11px] text-gray-400 dark:text-white/25">
                  Last activity {formatWhen(c.last_activity)} · baseline refreshed {c.last_updated ? formatWhen(c.last_updated) : "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function BaselineFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 dark:bg-[#161616] border border-gray-200 dark:border-white/[0.04]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">{label}</p>
      <p className="truncate font-medium text-gray-800 dark:text-white/80">{value}</p>
    </div>
  );
}

function formatWhen(iso: string): string {
  // The API stores naive UTC timestamps; force UTC unless a zone is present.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
        ok
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-white/40"
      }`}
    >
      {children}
    </span>
  );
}

/** Verification status for one customer, and the institution's PIN reset.
 *
 * Resetting clears the PIN rather than choosing one, so the bank never learns or
 * picks a customer's PIN: the customer sets a new one at their next
 * verification. It is a two-step control because it changes a security factor. */
function VerificationRow({
  customer,
  institutionId,
  onChanged,
}: {
  customer: CopilotCustomer;
  institutionId: string | null;
  onChanged: () => void;
}) {
  const v = customer.verification;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!v) return null;

  async function reset() {
    if (!institutionId) return;
    setBusy(true);
    setError(null);
    try {
      await resetCustomerPin(institutionId, customer.user_id);
      setConfirming(false);
      onChanged();
    } catch {
      setError("Could not reset the PIN. Sign in again and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-white/[0.05]">
      <Chip ok={v.pin_set && !v.pin_locked}>{!v.pin_set ? "No PIN" : v.pin_locked ? "PIN locked" : "PIN set"}</Chip>
      <Chip ok={v.passkeys > 0}>{v.passkeys > 0 ? `${v.passkeys} device${v.passkeys === 1 ? "" : "s"}` : "No passkey"}</Chip>
      <Chip ok={v.contact_set}>{v.contact_set ? "Codes reach them" : "No code contact"}</Chip>
      {customer.balance != null && (
        <span className="text-[12px] font-semibold tabular-nums text-gray-600 dark:text-white/60">
          Balance {formatNaira(customer.balance)}
        </span>
      )}

      {v.pin_set && (
        <span className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[11px] text-gray-500 dark:text-white/40">Clear this customer&apos;s PIN?</span>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {busy ? "Clearing…" : "Yes, reset"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:text-white/40 dark:hover:text-white"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:text-white/55 dark:hover:bg-white/[0.05]"
            >
              Reset PIN
            </button>
          )}
        </span>
      )}
      {error && <p className="w-full text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
