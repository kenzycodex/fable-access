"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClockCounterClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { Card, EmptyState, PageHeader, Segmented, Skeleton, inputClass } from "@/components/dashboard/primitives";
import { ago, EventIcon, eventDetail, eventLabel, fullDate } from "@/components/operator/ui";
import { usePlatformAudit, type PlatformEvent } from "@/lib/fable/operator";

type Kind = "all" | "institutions" | "team" | "assistant";

const KIND_OF = (type: string): Kind =>
  type.startsWith("operator.") ? "team" : type.includes("assistant") ? "assistant" : "institutions";

/** What Fable's operators have done, newest first. */
export default function OperatorAuditPage() {
  const { data, isLoading } = usePlatformAudit();
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");

  const events = useMemo(() => data?.events ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (kind !== "all" && KIND_OF(e.event_type) !== kind) return false;
      if (!needle) return true;
      return [eventLabel(e.event_type), e.institution_id ?? "", String(e.payload.operator ?? ""), eventDetail(e.payload)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [events, kind, q]);

  const groups = useMemo(() => groupByDay(rows), [rows]);

  return (
    <>
      <PageHeader title="Audit log" description="Every operator action, newest first. Kept permanently, and shown to the institution it touched." />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-d-border p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-[220px] flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search operator, institution or detail"
              aria-label="Search the audit log" className={`${inputClass} !h-10 pl-10 text-[13px]`} />
          </div>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <Segmented<Kind> value={kind} onChange={setKind} options={[
              { value: "all", label: "All" },
              { value: "institutions", label: "Institutions" },
              { value: "team", label: "Operators" },
              { value: "assistant", label: "Ask Fable" },
            ]} />
          </div>
        </div>

        {isLoading ? (
          <div className="p-5"><Skeleton className="h-48" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClockCounterClockwise size={22} />} title={events.length ? "Nothing matches" : "Nothing yet"}
            body={events.length ? "Try another search or filter." : "Operator actions appear here as they happen."} />
        ) : (
          groups.map(([day, items]) => (
            <section key={day}>
              <h2 className="sticky top-[61px] z-[1] border-b border-d-border bg-d-surface/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint backdrop-blur">
                {day}
              </h2>
              <ul className="divide-y divide-d-border">
                {items.map((e) => <Row key={e.id} e={e} />)}
              </ul>
            </section>
          ))
        )}
      </Card>
    </>
  );
}

function Row({ e }: { e: PlatformEvent }) {
  const detail = eventDetail(e.payload);
  return (
    <li className="flex items-start gap-3 px-5 py-3 sm:items-center">
      <EventIcon type={e.event_type} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-d-text">
          <span className="font-semibold">{String(e.payload.operator ?? "Fable")}</span>{" "}
          <span className="text-d-muted">{lowerFirst(eventLabel(e.event_type))}</span>
          {e.institution_id && (
            <>
              {" "}
              <Link href={`/operator/institutions/${encodeURIComponent(e.institution_id)}`} className="font-medium text-brand hover:underline">
                {e.institution_id}
              </Link>
            </>
          )}
        </p>
        {detail && <p className="mt-0.5 break-words text-[12px] text-d-muted">{detail}</p>}
      </div>
      <span className="shrink-0 text-[12px] text-d-faint" title={fullDate(e.created_at)}>{ago(e.created_at)}</span>
    </li>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function groupByDay(rows: PlatformEvent[]): [string, PlatformEvent[]][] {
  const out = new Map<string, PlatformEvent[]>();
  for (const e of rows) {
    const day = fullDate(e.created_at).split(",")[0] || "Earlier";
    out.set(day, [...(out.get(day) ?? []), e]);
  }
  return [...out.entries()];
}
