"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Circle, DownloadSimple, FileText, ShieldCheck } from "@phosphor-icons/react";
import { Dialog } from "@/components/dashboard/Dialog";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  TextInput,
  table,
} from "@/components/dashboard/primitives";
import { daysAgo, downloadCsv } from "@/lib/fable/console";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useCompliance, useDashboardFeed } from "@/lib/fable/useBackend";
import { useOnboarding } from "@/lib/fable/useConsole";
import { useCustomerNames } from "@/lib/fable/useInstitution";

// Readiness, not certification. Your own steps come from the go-live
// checklist; Fable's controls say plainly whether each is live or still being
// built. Nothing here is a certification, and Fable holds none today.
type ControlStatus = "Live" | "In progress";
const FABLE_CONTROLS: { name: string; status: ControlStatus; note: string }[] = [
  { name: "Audit trail", status: "Live", note: "Decisions, holds, identity checks and staff actions are recorded" },
  { name: "No credentials in logs", status: "Live", note: "PINs, codes, passwords and keys are never written to the audit log" },
  { name: "AI provider redaction", status: "Live", note: "Names and account numbers are removed before any AI provider sees text" },
  { name: "Tenant isolation", status: "Live", note: "Your customers and decisions are never visible to another institution" },
  { name: "Customer data export and erasure", status: "Live", note: "From a customer's page: download a copy, or erase" },
  { name: "Automatic retention", status: "Live", note: "Decisions kept 5 years, device and location detail 2 years" },
  { name: "Location kept coarse", status: "Live", note: "About 1 km; IP addresses without the last part" },
];
const OWN_STEPS = ["agreements", "api_key", "webhook", "policy", "team"];

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";
type AuditEvent = NonNullable<ReturnType<typeof useCompliance>["data"]>["audit_trail"] extends (infer E)[] | undefined ? E : never;

/** What an officer filters the trail by. Sign-ins are kept but off the default
 * view, because they bury the events that actually need reading. */
type Kind = "decisions" | "holds" | "identity" | "admin" | "signins" | "all";

function kindOf(eventType: string): Exclude<Kind, "all" | "decisions"> {
  if (eventType.startsWith("containment.")) return "holds";
  if (eventType.startsWith("stepup.") || eventType === "transfer.approved" || eventType === "security.changed") return "identity";
  if (eventType === "admin.login") return "signins";
  return "admin";
}

const PAGE = 12;

export default function CompliancePage() {
  const nameFor = useCustomerNames();
  const feed = useDashboardFeed();
  const { data: compliance } = useCompliance();
  const [kind, setKind] = useState<Kind>("decisions");
  const [shown, setShown] = useState(PAGE);
  const [exportOpen, setExportOpen] = useState(false);

  const events = useMemo(() => compliance?.audit_trail ?? [], [compliance]);
  const filtered = useMemo(
    () =>
      events.filter((e) => {
        const k = kindOf(e.event_type);
        if (kind === "all") return true;
        if (kind === "decisions") return k !== "signins";
        return k === kind;
      }),
    [events, kind],
  );
  const incidents = [...feed.transactions].filter((t) => t.action === "BLOCK").sort((a, b) => b.timestamp - a.timestamp);

  return (
    <>
      <PageHeader
        title="Compliance"
        description="The audit record behind every decision."
        actions={
          <>
            <Button variant="secondary" icon={<DownloadSimple size={16} />} onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <ButtonLink href="/dashboard/report" icon={<FileText size={16} />}>
              Board report
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-d-border px-5 py-4">
            <CardHeader title="Audit trail" subtitle="Most recent first" />
            <Segmented<Kind>
              value={kind}
              onChange={(k) => {
                setKind(k);
                setShown(PAGE);
              }}
              options={[
                { value: "decisions", label: "Activity" },
                { value: "holds", label: "Holds" },
                { value: "identity", label: "Identity" },
                { value: "admin", label: "Admin" },
                { value: "signins", label: "Sign-ins" },
              ]}
            />
          </div>
          {!compliance ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<FileText size={22} />} title="Nothing recorded here yet" body="Events of this kind will appear as they happen." />
          ) : (
            <ul className="divide-y divide-d-border">
              {filtered.slice(0, shown).map((e) => {
                const d = describeEvent(e);
                return (
                  <li key={e.id} className="flex items-center gap-4 px-5 py-3.5 text-[13px]">
                    <span className="w-20 shrink-0 tabular-nums text-d-muted">{eventTime(e.created_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-d-text">{d.label}</span>
                      {(e.user_id || d.by) && (
                        <span className="block truncate text-[12px] text-d-faint">
                          {e.user_id ? nameFor(e.user_id) : ""}
                          {d.by && e.user_id !== d.by ? `${e.user_id ? " · " : ""}by ${d.by}` : ""}
                        </span>
                      )}
                    </span>
                    <Badge tone={d.tone}>{d.tag}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length > shown && (
            <div className="border-t border-d-border px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </Card>

        <Readiness />
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
                {incidents.slice(0, 15).map((t) => (
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

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

/** Choose what and which period to export, then download it as a CSV. */
/** Readiness from real state: the institution's own steps and Fable's controls. */
function Readiness() {
  const { data } = useOnboarding();
  const steps = (data?.items ?? []).filter((i) => OWN_STEPS.includes(i.key));
  return (
    <Card>
      <CardHeader title="Readiness" subtitle="Readiness, not certification" />
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-d-faint">Your steps</p>
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="mb-5 flex flex-col gap-2.5">
          {steps.map((i) => (
            <li key={i.key} className="flex items-start gap-2.5 text-[13px]">
              {i.done ? (
                <CheckCircle size={18} weight="fill" className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle size={18} className="mt-px shrink-0 text-d-faint" />
              )}
              <span className={i.done ? "text-d-text" : "text-d-muted"}>{i.label}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-d-faint">Fable&apos;s controls</p>
      <ul className="flex flex-col gap-3">
        {FABLE_CONTROLS.map((c) => (
          <li key={c.name} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-d-text">{c.name}</span>
              <span className="block text-[12px] text-d-muted">{c.note}</span>
            </span>
            <Badge tone={c.status === "Live" ? "success" : "warning"}>{c.status}</Badge>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] text-d-faint">
        Fable is not certified against PCI-DSS, ISO 27001 or SOC 2. Use this list with your own review against the CBN
        Risk-Based Cybersecurity Framework and the NDPA 2023.
      </p>
    </Card>
  );
}

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [what, setWhat] = useState<"transactions" | "audit">("transactions");
  const [range, setRange] = useState<"7" | "30" | "90" | "custom">("30");
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => daysAgo(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const period = range === "custom" ? { from, to } : { from: daysAgo(Number(range)), to: daysAgo(0) };
      await downloadCsv(what, period);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export to CSV"
      description="Opens in Excel, Sheets or any audit tool. Only your institution's records are included."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={<DownloadSimple size={16} />} loading={busy} onClick={run}>
            Download
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What to export">
          <Segmented
            value={what}
            onChange={setWhat}
            options={[
              { value: "transactions", label: "Transactions" },
              { value: "audit", label: "Audit trail" },
            ]}
          />
        </Field>
        <Field label="Period">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </Field>
        {range === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {done && <Notice tone="success">Downloaded. Check your browser&apos;s downloads.</Notice>}
      </div>
    </Dialog>
  );
}

/** Turn a recorded event into a sentence a compliance officer can read. */
function describeEvent(e: AuditEvent): { label: string; tag: string; tone: Tone; by?: string } {
  const p = e.payload ?? {};
  const amount = typeof p.amount === "number" ? ` of ${formatNaira(p.amount)}` : "";
  const by = typeof p.by === "string" ? p.by : typeof p.admin === "string" ? p.admin : undefined;

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
      return { label, tag: "Security", tone: "warning", by };
    }
    case "account.topup":
      return { label: `Account topped up${amount}${p.method ? ` by ${String(p.method)}` : ""}`, tag: "Top-up", tone: "brand" };
    case "admin.login":
      return { label: "Console sign-in", tag: "Sign-in", tone: "neutral" };
    case "admin.password_changed":
      return { label: "Console password changed", tag: "Security", tone: "warning" };
    case "institution.provisioned":
      return { label: "Institution provisioned", tag: "Setup", tone: "neutral" };
    case "institution.updated":
      return { label: p.area === "branding" ? "Branding updated" : "Institution profile updated", tag: "Settings", tone: "neutral", by };
    case "institution.mode_changed":
      return { label: `Switched to ${String(p.mode ?? "")} mode`, tag: "Settings", tone: "warning", by };
    case "case.assigned":
      return { label: p.assignee ? `Case assigned to ${String(p.assignee)}` : "Case unassigned", tag: "Case", tone: "brand", by };
    case "case.escalated":
      return { label: "Case escalated", tag: "Escalated", tone: "danger", by };
    case "case.noted":
      return { label: "Note added to a case", tag: "Case", tone: "neutral", by };
    case "case.resolved":
      return {
        label: `Case resolved as ${p.outcome === "fraud" ? "fraud" : "legitimate"}${amount}`,
        tag: p.outcome === "fraud" ? "Fraud" : "Legitimate",
        tone: p.outcome === "fraud" ? "danger" : "success",
        by,
      };
    case "case.reopened":
      return { label: "Case reopened", tag: "Case", tone: "warning", by };
    case "feedback.recorded":
      return { label: `Outcome reported by API: ${String(p.outcome ?? "")}`, tag: "Feedback", tone: "brand", by };
    case "policy.changed":
      return { label: "Risk policy changed", tag: "Policy", tone: "warning", by };
    case "team.invited":
      return { label: `${String(p.member ?? "Someone")} invited as ${String(p.role ?? "member")}`, tag: "Team", tone: "brand", by };
    case "team.role_changed":
      return { label: `${String(p.member ?? "A member")} is now ${String(p.role ?? "")}`, tag: "Team", tone: "warning", by };
    case "team.removed":
      return { label: `${String(p.member ?? "A member")} removed from the console`, tag: "Team", tone: "danger", by };
    case "apikey.rotated":
      return { label: "API key rotated", tag: "Keys", tone: "warning", by };
    case "webhook.created":
      return { label: `Webhook added: ${String(p.url ?? "")}`, tag: "Webhook", tone: "brand", by };
    case "webhook.deleted":
      return { label: `Webhook removed: ${String(p.url ?? "")}`, tag: "Webhook", tone: "neutral", by };
    default:
      return { label: e.event_type, tag: "Event", tone: "neutral", by };
  }
}

function eventTime(iso: string): string {
  // The API stores naive UTC timestamps; force UTC unless a zone is present.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(t) ? iso : formatRelativeTime(t);
}
