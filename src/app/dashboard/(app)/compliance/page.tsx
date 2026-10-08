"use client";

import { useState } from "react";
import { Check, FileText, ShieldCheck } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  table,
} from "@/components/dashboard/primitives";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useCompliance, useDashboardFeed } from "@/lib/fable/useBackend";
import { useCustomerNames } from "@/lib/fable/useInstitution";

// Regulatory frameworks Fable is built against (real Nigerian/industry
// standards). Presented as posture, nothing here is certified in the demo.
const FRAMEWORKS = [
  { name: "CBN Risk-Based Cybersecurity Framework", note: "Real-time transaction risk scoring" },
  { name: "NDPA 2023 + GAID 2025", note: "Data minimization, hashed signals only" },
  { name: "PCI-DSS", note: "Card fields stripped before any processing" },
  { name: "FATF AML typologies", note: "Mule-account and layering signals" },
];

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";
type AuditEvent = NonNullable<ReturnType<typeof useCompliance>["data"]>["audit_trail"] extends (infer E)[] | undefined ? E : never;

/**
 * Compliance is the record, not the live view. The Overview answers "what is
 * happening now"; this page answers "what was done, by whom, and can we show it",
 * so its figures are counted from the audit events themselves rather than
 * repeating the Overview's totals.
 */
export default function CompliancePage() {
  const nameFor = useCustomerNames();
  const [showAll, setShowAll] = useState(false);
  const feed = useDashboardFeed();
  const { data: compliance } = useCompliance();

  const events = compliance?.audit_trail ?? [];
  const incidents = [...feed.transactions].filter((t) => t.action === "BLOCK").sort((a, b) => b.timestamp - a.timestamp);

  const count = (...types: string[]) => events.filter((e) => types.includes(e.event_type)).length;
  const loaded = Boolean(compliance);

  return (
    <>
      <PageHeader
        title="Compliance"
        description="The audit record behind every Fable decision: who was held, verified or changed, and when."
        actions={
          <Button
            variant="secondary"
            icon={<FileText size={16} />}
            onClick={() => alert("In production this exports a signed PDF board report. Disabled in the demo.")}
          >
            Export board report
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events on record" value={loaded ? String(events.length) : "-"} sub="In the recent audit trail" icon={<FileText size={17} weight="fill" />} />
        <StatCard
          label="Transfers held"
          value={loaded ? String(count("containment.created")) : "-"}
          sub={loaded ? `${count("containment.cancelled", "containment.expired")} returned to the customer` : "Loading"}
          tone="warning"
        />
        <StatCard
          label="Identity checks"
          value={loaded ? String(count("stepup.passed", "stepup.failed")) : "-"}
          sub={loaded ? `${count("stepup.failed")} failed` : "Loading"}
          icon={<ShieldCheck size={17} weight="fill" />}
          tone="success"
        />
        <StatCard
          label="Security changes"
          value={loaded ? String(count("security.changed")) : "-"}
          sub="PIN set, changed or reset"
          tone="danger"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* The recorded events themselves, not a re-listing of transfers.
            Containment, verification, security changes and top-ups are what a
            compliance officer reconstructs an incident from. */}
        <Card padded={false} className="lg:col-span-2">
          <div className="px-5 pt-5">
            <CardHeader title="Audit trail" subtitle="Most recent first" />
          </div>
          {!loaded ? (
            <div className="space-y-3 p-5 pt-0">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState icon={<FileText size={22} />} title="No events yet" body="Holds, verifications and security changes are recorded here." />
          ) : (
            <ul className="divide-y divide-d-border">
              {events.slice(0, showAll ? 25 : 8).map((e) => {
                const d = describeEvent(e);
                return (
                  <li key={e.id} className="flex items-center gap-4 px-5 py-3.5 text-[13px]">
                    <span className="w-20 shrink-0 tabular-nums text-d-muted">{eventTime(e.created_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-d-text">{d.label}</span>
                      {e.user_id && (
                        <span className="block truncate text-[12px] text-d-faint" title={e.user_id}>
                          {nameFor(e.user_id)}
                        </span>
                      )}
                    </span>
                    <Badge tone={d.tone}>{d.tag}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {events.length > 8 && (
            <div className="border-t border-d-border px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show ${Math.min(events.length, 25) - 8} more`}
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Regulatory posture" subtitle="What Fable is built against" />
          <ul className="flex flex-col gap-4">
            {FRAMEWORKS.map((f) => (
              <li key={f.name} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <Check size={13} weight="bold" />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-d-text">{f.name}</span>
                  <span className="block text-[12px] text-d-muted">{f.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Incident log" subtitle="Transfers Shield blocked" />
        </div>
        {feed.ready && incidents.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={22} />} title="No incidents on record" body="Blocked transfers will be listed here." />
        ) : (
          <div className={table.wrap}>
            <table className={table.base}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Customer</th>
                  <th className={table.th}>Attempted</th>
                  <th className={table.th}>Outcome</th>
                  <th className={`${table.th} text-right`}>When</th>
                </tr>
              </thead>
              <tbody>
                {incidents.slice(0, 20).map((t) => (
                  <tr key={t.id} className={table.row}>
                    <td className={`${table.td} font-semibold text-d-text`}>{t.customerName}</td>
                    <td className={table.td}>
                      <span className="font-semibold tabular-nums">{formatNaira(t.amount)}</span>
                      <span className="text-d-muted"> to {t.recipientName}</span>
                    </td>
                    <td className={table.td}>
                      <Badge tone="danger">{t.status}</Badge>
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-right text-d-muted`}>{formatRelativeTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Turn a recorded event into a sentence a compliance officer can read. */
function describeEvent(e: AuditEvent): { label: string; tag: string; tone: Tone } {
  const p = e.payload ?? {};
  const amount = typeof p.amount === "number" ? ` of ${formatNaira(p.amount)}` : "";

  switch (e.event_type) {
    case "containment.created":
      return { label: `Transfer${amount} held in containment`, tag: "Held", tone: "warning" };
    case "containment.released":
      return { label: `Held transfer${amount} released by the customer`, tag: "Released", tone: "brand" };
    case "containment.cancelled":
      return { label: `Held transfer${amount} cancelled, money returned`, tag: "Cancelled", tone: "success" };
    case "containment.expired":
      return { label: "Holds auto-cancelled after their cooling window", tag: "Expired", tone: "success" };
    case "stepup.passed":
      return { label: `Identity check passed (${String(p.level ?? "verified")})`, tag: "Verified", tone: "success" };
    case "stepup.failed":
      return {
        label: `Failed ${String(p.factor ?? "verification")} check${p.reason ? `: ${String(p.reason).replace(/_/g, " ")}` : ""}`,
        tag: "Failed",
        tone: "danger",
      };
    case "transfer.approved":
      return { label: `Flagged transfer${amount} approved after verification`, tag: "Approved", tone: "brand" };
    case "security.changed": {
      const change = String(p.change ?? "");
      const via = p.via === "institution" ? " by the institution" : p.via === "registered_code" ? " with a code to their registered contact" : "";
      const label =
        change === "pin_set" ? "Transaction PIN set"
        : change === "pin_changed" ? "Transaction PIN changed"
        : change === "pin_reset" ? `Transaction PIN reset${via}`
        : "Security setting changed";
      return { label, tag: "Security", tone: "warning" };
    }
    case "account.topup":
      return { label: `Account topped up${amount}${p.method ? ` by ${String(p.method)}` : ""}`, tag: "Top-up", tone: "brand" };
    case "admin.login":
      return { label: "Console sign-in", tag: "Sign-in", tone: "neutral" };
    case "institution.provisioned":
      return { label: "Institution provisioned", tag: "Setup", tone: "neutral" };
    default:
      return { label: e.event_type, tag: "Event", tone: "neutral" };
  }
}

function eventTime(iso: string): string {
  // The API stores naive UTC timestamps; force UTC unless a zone is present.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(t) ? iso : formatRelativeTime(t);
}
