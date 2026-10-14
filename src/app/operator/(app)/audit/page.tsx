"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { CaretDown, ClockCounterClockwise, DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button, Card, EmptyState, PageHeader, Skeleton, inputClass } from "@/components/dashboard/primitives";
import { ago, EventIcon, eventDetail, eventLabel, fullDate } from "@/components/operator/ui";
import {
  can,
  downloadAuditCsv,
  fetchAuditPage,
  useAuditPage,
  useInstitutions,
  useOperatorSession,
  type AuditQuery,
  type AuditScope,
  type PlatformEvent,
} from "@/lib/fable/operator";

const SCOPES: { value: AuditScope; label: string; body: string; min: "support" | "platform_admin" }[] = [
  { value: "operators", label: "Operator actions", body: "Everything Fable staff did: sign-ins, provisioning, suspensions, settings.", min: "support" },
  { value: "all", label: "All events", body: "Every event from every institution, as each bank sees it in its own log.", min: "platform_admin" },
  { value: "security", label: "Security", body: "Refused cross-bank access, failed step-ups, key and password changes, suspensions.", min: "platform_admin" },
];

const PERIODS = [
  { value: "", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export default function OperatorAuditPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AuditLog />
    </Suspense>
  );
}

function sinceFor(days: string): string | undefined {
  if (!days) return undefined;
  return new Date(Date.now() - Number(days) * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
}

/** The audit log: operator actions, every institution's events, and the security view. */
function AuditLog() {
  const session = useOperatorSession();
  const router = useRouter();
  const params = useSearchParams();
  const allowed = SCOPES.filter((s) => can(session?.role, s.min));
  const raw = params.get("scope") as AuditScope | null;
  const scope: AuditScope = raw && allowed.some((s) => s.value === raw) ? raw : "operators";

  const [institution, setInstitution] = useState(params.get("institution") ?? "");
  const [type, setType] = useState("");
  const [period, setPeriod] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [since] = useMemo(() => [sinceFor(period)], [period]);

  const query: AuditQuery = { scope, institution: institution || undefined, type: type || undefined, q: q || undefined, since };
  const { data, isLoading, error } = useAuditPage(query);
  const { data: institutions } = useInstitutions();

  // Further pages, appended below the first. Reset whenever the view changes.
  const key = JSON.stringify(query);
  const [more, setMore] = useState<{ key: string; events: PlatformEvent[]; next: number | null } | null>(null);
  const extra = more?.key === key ? more : null;
  const events = useMemo(() => [...(data?.events ?? []), ...(extra?.events ?? [])], [data, extra]);
  const next = extra ? extra.next : data?.next_before ?? null;
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuditPage(query, next);
      setMore({ key, events: [...(extra?.events ?? []), ...page.events], next: page.next_before });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  function setScope(s: AuditScope) {
    setType("");
    router.replace(s === "operators" ? "/operator/audit" : `/operator/audit?scope=${s}`, { scroll: false });
  }

  const groups = useMemo(() => groupByDay(events), [events]);
  const current = SCOPES.find((s) => s.value === scope)!;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, when, and to which institution. Kept permanently. Every export is itself recorded."
        actions={
          <Button variant="secondary" icon={<DownloadSimple size={16} />}
            onClick={() => downloadAuditCsv({ ...query, q: q || undefined }).catch((e) => toast.error(e.message))}>
            Export CSV
          </Button>
        }
      />

      <div role="tablist" aria-label="Audit views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-d-border px-4 sm:mx-0 sm:px-0">
        {allowed.map((s) => (
          <button key={s.value} type="button" role="tab" aria-selected={scope === s.value} onClick={() => setScope(s.value)}
            className={`-mb-px shrink-0 border-b-2 px-3.5 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${
              scope === s.value ? "border-brand text-d-text" : "border-transparent text-d-muted hover:text-d-text"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-d-border p-4">
          <p className="text-[13px] text-d-muted">{current.body}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_0.8fr]">
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, references or details"
                aria-label="Search the audit log" className={`${inputClass} !h-10 pl-10 text-[13px]`} />
            </div>
            <select value={institution} onChange={(e) => setInstitution(e.target.value)} aria-label="Institution"
              className={`${inputClass} !h-10 text-[13px]`}>
              <option value="">All institutions</option>
              {(institutions?.institutions ?? []).map((i) => <option key={i.institution_id} value={i.institution_id}>{i.name}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event" className={`${inputClass} !h-10 text-[13px]`}>
              <option value="">Every event</option>
              {(data?.types ?? []).map((t) => <option key={t.event_type} value={t.event_type}>{eventLabel(t.event_type)} ({t.n})</option>)}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" className={`${inputClass} !h-10 text-[13px]`}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {error ? (
          <p className="p-5 text-[13px] text-red-500">{error.message}</p>
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : events.length === 0 ? (
          <EmptyState icon={<ClockCounterClockwise size={22} />} title="Nothing here"
            body={institution || type || q || period ? "No event matches these filters." : "Events appear here as they happen."} />
        ) : (
          <>
            {groups.map(([day, items]) => (
              <section key={day}>
                <h2 className="border-b border-d-border bg-d-surface-2/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">
                  {day} <span className="ml-1 font-medium normal-case tracking-normal">· {items.length}</span>
                </h2>
                <ul className="divide-y divide-d-border">
                  {items.map((e) => <Row key={e.id} e={e} />)}
                </ul>
              </section>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-d-border px-5 py-3">
              <span className="text-[12px] text-d-muted">{events.length} shown</span>
              {next ? <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>Load more</Button>
                : <span className="text-[12px] text-d-faint">That&apos;s everything</span>}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function Row({ e }: { e: PlatformEvent }) {
  const [open, setOpen] = useState(false);
  const detail = eventDetail(e.payload);
  const fields = Object.entries(e.payload).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-d-surface-2 sm:items-center">
        <EventIcon type={e.event_type} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-d-text">
            <span className="font-semibold">{e.actor ?? String(e.payload.operator ?? "Fable")}</span>{" "}
            <span className="text-d-muted">{lowerFirst(eventLabel(e.event_type))}</span>
            {e.institution_id && <span className="font-medium text-brand"> {e.institution_id}</span>}
          </span>
          {detail && <span className="mt-0.5 block truncate text-[12px] text-d-muted">{detail}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[12px] text-d-faint" title={fullDate(e.created_at)}>{ago(e.created_at)}</span>
        </span>
        <CaretDown size={14} className={`mt-1 shrink-0 text-d-faint transition-transform sm:mt-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-dashed border-d-border bg-d-surface-2/40 px-5 py-3 pl-16">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-[auto_1fr]">
            <dt className="text-d-faint">When</dt>
            <dd className="text-d-text">{fullDate(e.created_at)} <span className="text-d-faint">({e.created_at} UTC)</span></dd>
            <dt className="text-d-faint">Event</dt>
            <dd className="font-mono text-d-text">{e.event_type} <span className="text-d-faint">#{e.id}</span></dd>
            {e.institution_id && (
              <>
                <dt className="text-d-faint">Institution</dt>
                <dd><Link href={`/operator/institutions/${encodeURIComponent(e.institution_id)}`} className="text-brand hover:underline">{e.institution_id}</Link></dd>
              </>
            )}
            {e.user_id && (
              <>
                <dt className="text-d-faint">Subject</dt>
                <dd className="font-mono text-d-text">{e.user_id}</dd>
              </>
            )}
            {fields.map(([k, v]) => (
              <FieldRow key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

function FieldRow({ k, v }: { k: string; v: unknown }) {
  const text = typeof v === "object" ? JSON.stringify(v, null, 1) : String(v);
  return (
    <>
      <dt className="text-d-faint">{k.replace(/_/g, " ")}</dt>
      <dd className="break-words font-mono text-d-text">{text}</dd>
    </>
  );
}

function groupByDay(rows: PlatformEvent[]): [string, PlatformEvent[]][] {
  const out = new Map<string, PlatformEvent[]>();
  for (const e of rows) {
    const day = fullDate(e.created_at).split(",")[0] || "Earlier";
    out.set(day, [...(out.get(day) ?? []), e]);
  }
  return [...out.entries()];
}
