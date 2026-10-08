"use client";

import { CheckIcon, FileCheckIcon } from "@/components/app-icons";
import { Card, PageHeader, StatCard } from "@/components/dashboard/primitives";
import { summarize } from "@/lib/fable/analytics";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useCompliance, useDashboardFeed } from "@/lib/fable/useBackend";

// Regulatory frameworks Fable is built against (real Nigerian/industry
// standards). Presented as posture, nothing here is certified in the demo.
const FRAMEWORKS = [
  { name: "CBN Risk-Based Cybersecurity Framework", note: "Real-time transaction risk scoring" },
  { name: "NDPA 2023 + GAID 2025", note: "Data minimization, hashed signals only" },
  { name: "PCI-DSS", note: "Card fields stripped before any processing" },
  { name: "FATF AML typologies", note: "Mule-account and layering signals" },
];

export default function CompliancePage() {
  const feed = useDashboardFeed();
  const { data: compliance } = useCompliance();
  const events = compliance?.audit_trail ?? [];
  const txns = [...feed.transactions].sort((a, b) => b.timestamp - a.timestamp);
  const s = summarize(txns);
  const incidents = txns.filter((t) => t.action === "BLOCK");

  return (
    <>
      <PageHeader
        title="Compliance"
        description="A full audit trail behind every Fable decision, ready for regulators and the board."
        actions={
          <button
            type="button"
            onClick={() => alert("In production this exports a signed PDF board report. Disabled in the demo.")}
            className="inline-flex items-center gap-2 rounded-full bg-[#7C3AED] px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#6D28D9] shadow-sm"
          >
            <FileCheckIcon className="size-4" />
            Export board report
          </button>
        }
      />

      {/* Board-report summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mt-2">
        <StatCard label="Decisions logged" value={String(s.total)} accent="text-[#7C3AED]" />
        <StatCard label="Amount protected" value={formatNaira(s.amountProtected)} accent="text-emerald-400" />
        <StatCard label="Incidents blocked" value={String(s.blockCount)} accent="text-red-400" />
        <StatCard label="Avg decision" value={`${s.avgLatencyMs}ms`} accent="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mt-4">
        {/* Audit trail: the recorded events themselves, not a re-listing of
            transfers. Containment, verification, security changes and top-ups
            are what a compliance officer reconstructs an incident from. */}
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Audit trail</h2>
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04]">
            {!compliance ? (
              <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]" />
            ) : events.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-gray-400 dark:text-white/40">No events recorded yet.</p>
            ) : (
              events.slice(0, 25).map((e) => {
                const d = describeEvent(e);
                return (
                  <div key={e.id} className="flex items-center gap-4 py-3 text-[13px]">
                    <span className="w-20 shrink-0 tabular-nums text-gray-500 dark:text-white/40">{eventTime(e.created_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-800 dark:text-white/80">{d.label}</span>
                      {e.user_id && (
                        <span className="block truncate font-mono text-[11px] text-gray-400 dark:text-white/35">{e.user_id}</span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${d.tone}`}>
                      {d.tag}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Frameworks */}
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Regulatory posture</h2>
          <div className="flex flex-col gap-4">
            {FRAMEWORKS.map((f) => (
              <div key={f.name} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                  <CheckIcon className="size-3.5" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-bold text-gray-900 dark:text-white">{f.name}</span>
                  <span className="text-[12px] text-gray-500 dark:text-white/50">{f.note}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Incident log */}
      <Card>
        <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Incident log</h2>
        {feed.ready && incidents.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-400 dark:text-white/40">No incidents on record.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04]">
            {incidents.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
                <span className="font-bold text-gray-900 dark:text-white">{t.customerName}</span>
                <span className="text-gray-600 dark:text-white/60">
                  attempted {formatNaira(t.amount)} to {t.recipientName}
                </span>
                <span className="text-gray-400 dark:text-white/40">· {formatRelativeTime(t.timestamp)}</span>
                <span className="ml-auto text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-500/20">{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

const TONE = {
  ok: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  warn: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  bad: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  info: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
};

type AuditEvent = NonNullable<ReturnType<typeof useCompliance>["data"]>["audit_trail"] extends (infer E)[] | undefined ? E : never;

/** Turn a recorded event into a sentence a compliance officer can read. */
function describeEvent(e: AuditEvent): { label: string; tag: string; tone: string } {
  const p = e.payload ?? {};
  const amount = typeof p.amount === "number" ? ` of ${formatNaira(p.amount)}` : "";

  switch (e.event_type) {
    case "containment.created":
      return { label: `Transfer${amount} held in containment`, tag: "Held", tone: TONE.warn };
    case "containment.released":
      return { label: `Held transfer${amount} released by the customer`, tag: "Released", tone: TONE.info };
    case "containment.cancelled":
      return { label: `Held transfer${amount} cancelled, money returned`, tag: "Cancelled", tone: TONE.ok };
    case "containment.expired":
      return { label: "Holds auto-cancelled after their cooling window", tag: "Expired", tone: TONE.ok };
    case "stepup.passed":
      return { label: `Identity check passed (${String(p.level ?? "verified")})`, tag: "Verified", tone: TONE.ok };
    case "stepup.failed":
      return { label: `Failed ${String(p.factor ?? "verification")} check${p.reason ? `: ${String(p.reason).replace(/_/g, " ")}` : ""}`, tag: "Failed", tone: TONE.bad };
    case "transfer.approved":
      return { label: `Flagged transfer${amount} approved after verification`, tag: "Approved", tone: TONE.info };
    case "security.changed": {
      const change = String(p.change ?? "");
      const via = p.via === "institution" ? " by the institution" : p.via === "registered_code" ? " with a code to their registered contact" : "";
      const label =
        change === "pin_set" ? "Transaction PIN set"
        : change === "pin_changed" ? "Transaction PIN changed"
        : change === "pin_reset" ? `Transaction PIN reset${via}`
        : "Security setting changed";
      return { label, tag: "Security", tone: TONE.warn };
    }
    case "account.topup":
      return { label: `Account topped up${amount}${p.method ? ` by ${String(p.method)}` : ""}`, tag: "Top-up", tone: TONE.info };
    case "admin.login":
      return { label: "Console sign-in", tag: "Sign-in", tone: TONE.info };
    case "institution.provisioned":
      return { label: "Institution provisioned", tag: "Setup", tone: TONE.info };
    default:
      return { label: e.event_type, tag: "Event", tone: TONE.info };
  }
}

function eventTime(iso: string): string {
  // The API stores naive UTC timestamps; force UTC unless a zone is present.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(t) ? iso : formatRelativeTime(t);
}
