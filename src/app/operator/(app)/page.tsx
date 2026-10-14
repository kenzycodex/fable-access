"use client";

import { useMemo, useState } from "react";
import { Bank, CheckCircle, Lightning, MagnifyingGlass, Pause, Plus } from "@phosphor-icons/react";
import { LinkRow } from "@/components/dashboard/LinkRow";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  StatGrid,
  table,
} from "@/components/dashboard/primitives";
import { formatRelativeTime } from "@/lib/fable/format";
import { can, useInstitutions, useOperatorSession } from "@/lib/fable/operator";

/** Every institution on Fable, with how far along it is. */
export default function OperatorInstitutionsPage() {
  const session = useOperatorSession();
  const { data, error, isLoading } = useInstitutions();
  const [q, setQ] = useState("");

  const all = useMemo(() => data?.institutions ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.institution_id.includes(needle)) : all;
  }, [all, q]);

  const live = all.filter((i) => i.mode === "live").length;
  const suspended = all.filter((i) => i.status === "suspended").length;

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

      <StatGrid>
        <StatCard label="Institutions" value={String(all.length)} icon={<Bank size={18} />} featured />
        <StatCard label="Live" value={String(live)} icon={<Lightning size={18} />} tone="success" sub="Serving real customers" />
        <StatCard label="In sandbox" value={String(all.length - live)} icon={<CheckCircle size={18} />} sub="Still setting up" />
        <StatCard label="Suspended" value={String(suspended)} icon={<Pause size={18} />} tone={suspended ? "danger" : "brand"} />
      </StatGrid>

      <Card padded={false}>
        <div className="border-b border-d-border p-4">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-d-border bg-d-surface-2 px-3">
            <MagnifyingGlass size={16} className="text-d-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or id"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-d-text outline-none placeholder:text-d-faint" />
          </label>
        </div>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : error ? (
          <p className="p-5 text-[13px] text-red-500">{error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bank size={22} />}
            title={all.length ? "No institution matches" : "No institutions yet"}
            body={all.length ? "Try another name." : "Create the first one. It starts empty, in sandbox mode, and its owner is invited by email."}
          />
        ) : (
          <div className={table.wrap}>
            <table className={`${table.base} min-w-[820px]`}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Institution</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Customers</th>
                  <th className={table.th}>History</th>
                  <th className={table.th}>Decisions, 30 days</th>
                  <th className={`${table.th} text-right`}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <LinkRow key={i.institution_id} href={`/operator/institutions/${encodeURIComponent(i.institution_id)}`} label={`Open ${i.name}`}>
                    <td className={table.td}>
                      <p className="font-semibold text-d-text">{i.name}</p>
                      <p className="text-[12px] text-d-muted">{i.institution_id}{i.type ? ` · ${i.type}` : ""}</p>
                    </td>
                    <td className={table.td}>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={i.mode === "live" ? "success" : "neutral"}>{i.mode === "live" ? "Live" : "Sandbox"}</Badge>
                        {i.status === "suspended" && <Badge tone="danger">Suspended</Badge>}
                      </div>
                    </td>
                    <td className={`${table.td} tabular-nums`}>
                      {i.customers.toLocaleString("en-NG")}
                      <span className="text-d-faint"> ({i.real_customers.toLocaleString("en-NG")} real)</span>
                    </td>
                    <td className={`${table.td} tabular-nums`}>{i.history.toLocaleString("en-NG")}</td>
                    <td className={`${table.td} tabular-nums`}>{i.decisions_30d.toLocaleString("en-NG")}</td>
                    <td className={`${table.td} whitespace-nowrap text-right text-d-muted`}>
                      {i.last_decision ? formatRelativeTime(new Date(i.last_decision + (i.last_decision.endsWith("Z") ? "" : "Z")).getTime()) : "-"}
                    </td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
