"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Bank, CaretRight, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { LinkRow } from "@/components/dashboard/LinkRow";
import { ButtonLink, Card, EmptyState, PageHeader, Segmented, Skeleton, inputClass, table } from "@/components/dashboard/primitives";
import { ago, compact, fullDate, InstitutionMark, SetupBar, StageBadge, stageOf, type Stage } from "@/components/operator/ui";
import { can, useInstitutions, useOperatorSession, type InstitutionRow } from "@/lib/fable/operator";

type Filter = "all" | Stage;
const FILTERS: Filter[] = ["all", "setting_up", "ready", "live", "suspended"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  setting_up: "Setting up",
  ready: "Ready",
  live: "Live",
  suspended: "Suspended",
};

export default function OperatorInstitutionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Institutions />
    </Suspense>
  );
}

/** Every institution on Fable, filtered by stage, with how far along each one is. */
function Institutions() {
  const session = useOperatorSession();
  const router = useRouter();
  const params = useSearchParams();
  const { data, error, isLoading } = useInstitutions();
  const [q, setQ] = useState("");
  const raw = params.get("stage") as Filter | null;
  const filter: Filter = raw && FILTERS.includes(raw) ? raw : "all";

  const all = useMemo(() => data?.institutions ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, setting_up: 0, ready: 0, live: 0, suspended: 0 };
    all.forEach((i) => c[stageOf(i)]++);
    return c;
  }, [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (i) =>
        (filter === "all" || stageOf(i) === filter) &&
        (!needle || i.name.toLowerCase().includes(needle) || i.institution_id.includes(needle) || (i.contact_email ?? "").includes(needle)),
    );
  }, [all, q, filter]);

  function setFilter(f: Filter) {
    router.replace(f === "all" ? "/operator/institutions" : `/operator/institutions?stage=${f}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Institutions"
        description="Every bank and fintech on Fable."
        actions={
          can(session?.role, "platform_admin") && (
            <ButtonLink href="/operator/institutions/new" icon={<Plus size={16} weight="bold" />}>
              New institution
            </ButtonLink>
          )
        }
      />

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-d-border p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-[220px] flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, id or contact"
              aria-label="Search institutions" className={`${inputClass} !h-10 pl-10 text-[13px]`} />
          </div>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f, label: `${FILTER_LABEL[f]} ${counts[f]}` }))}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : error ? (
          <p className="p-5 text-[13px] text-red-500">{error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bank size={22} />}
            title={all.length ? "No institution matches" : "No institutions yet"}
            body={all.length ? "Try another search or stage." : "Create the first one. It starts empty, in sandbox mode, and its owner is invited by email."}
            action={!all.length && can(session?.role, "platform_admin") ? (
              <ButtonLink href="/operator/institutions/new" icon={<Plus size={16} weight="bold" />}>New institution</ButtonLink>
            ) : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-d-border md:hidden">
              {rows.map((i) => <MobileRow key={i.institution_id} i={i} />)}
            </ul>
            <div className={`${table.wrap} hidden md:block`}>
              <table className={`${table.base} min-w-[880px]`}>
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Institution</th>
                    <th className={table.th}>Stage</th>
                    <th className={`${table.th} w-[180px]`}>Setup</th>
                    <th className={table.th}>Customers</th>
                    <th className={table.th}>Decisions, 30d</th>
                    <th className={table.th}>Team</th>
                    <th className={`${table.th} text-right`}>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <LinkRow key={i.institution_id} href={`/operator/institutions/${encodeURIComponent(i.institution_id)}`} label={`Open ${i.name}`}>
                      <td className={table.td}>
                        <span className="flex items-center gap-3">
                          <InstitutionMark name={i.name} stage={stageOf(i)} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-d-text">{i.name}</span>
                            <span className="block truncate text-[12px] text-d-muted">{i.type ?? i.institution_id}</span>
                          </span>
                        </span>
                      </td>
                      <td className={table.td}><StageBadge stage={stageOf(i)} /></td>
                      <td className={table.td}><SetupBar done={i.setup_done} total={i.setup_total} /></td>
                      <td className={`${table.td} tabular-nums`}>
                        {compact(i.real_customers)}
                        <span className="text-d-faint"> real</span>
                        {i.customers > i.real_customers && <span className="block text-[11px] text-d-faint">{compact(i.customers - i.real_customers)} test</span>}
                      </td>
                      <td className={`${table.td} tabular-nums`}>{compact(i.decisions_30d)}</td>
                      <td className={table.td}>
                        {i.owners ? (
                          <span className="text-[13px] tabular-nums">{i.members} member{i.members === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                            {i.invites_pending ? "Owner invited" : "No owner"}
                          </span>
                        )}
                      </td>
                      <td className={`${table.td} whitespace-nowrap text-right text-d-muted`} title={fullDate(i.last_decision ?? i.created_at)}>
                        {i.last_decision ? ago(i.last_decision) : <span className="text-d-faint">Created {ago(i.created_at)}</span>}
                      </td>
                    </LinkRow>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function MobileRow({ i }: { i: InstitutionRow }) {
  return (
    <li>
      <Link href={`/operator/institutions/${encodeURIComponent(i.institution_id)}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-d-surface-2">
        <InstitutionMark name={i.name} stage={stageOf(i)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-d-text">{i.name}</span>
          </span>
          <span className="mt-1 flex items-center gap-2">
            <StageBadge stage={stageOf(i)} />
            <SetupBar done={i.setup_done} total={i.setup_total} className="flex-1" />
          </span>
        </span>
        <CaretRight size={14} className="shrink-0 text-d-faint" />
      </Link>
    </li>
  );
}
