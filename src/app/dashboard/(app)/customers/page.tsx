"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CaretRight, Fingerprint, MagnifyingGlass, ShieldWarning, UsersThree, Brain } from "@phosphor-icons/react";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Skeleton,
  StatCard,
  StatGrid,
  inputClass,
  table,
} from "@/components/dashboard/primitives";
import type { CopilotCustomer } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { useCopilotCustomers } from "@/lib/fable/useBackend";
import { useCustomerNames } from "@/lib/fable/useInstitution";

type Filter = "all" | "attention" | "learning";

/** A customer needs attention when their security is weak or locked. */
function needsAttention(c: CopilotCustomer): boolean {
  const v = c.verification;
  return Boolean(v && (v.pin_locked || (!v.passkeys && !v.contact_set)));
}

export default function CustomersPage() {
  const nameFor = useCustomerNames();
  const { data, isLoading } = useCopilotCustomers();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const all = useMemo(() => data?.customers ?? [], [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === "attention" && !needsAttention(c)) return false;
      if (filter === "learning" && c.has_baseline) return false;
      if (!q) return true;
      return c.user_id.toLowerCase().includes(q) || nameFor(c.user_id).toLowerCase().includes(q);
    });
  }, [all, query, filter, nameFor]);

  const attention = all.filter(needsAttention).length;
  const learning = all.filter((c) => !c.has_baseline).length;
  const withPasskey = all.filter((c) => (c.verification?.passkeys ?? 0) > 0).length;
  const loaded = Boolean(data);

  return (
    <>
      <PageHeader title="Customers" description="Everyone Fable protects at your bank." />

      <StatGrid>
        <StatCard label="Customers" value={loaded ? String(all.length) : "-"} sub="With activity at your bank" icon={<UsersThree size={17} weight="fill" />} featured />
        <StatCard label="Baselines built" value={loaded ? String(all.length - learning) : "-"} sub={loaded ? `${learning} still learning` : "Loading"} tone="success" icon={<Brain size={17} weight="fill" />} />
        <StatCard label="With a passkey" value={loaded ? String(withPasskey) : "-"} sub="Strongest verification" tone="warning" icon={<Fingerprint size={17} weight="fill" />} />
        <StatCard label="Needs attention" value={loaded ? String(attention) : "-"} sub="Locked PIN or weak security" tone="danger" icon={<ShieldWarning size={17} weight="fill" />} />
      </StatGrid>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-d-border p-4">
          <div className="relative min-w-[220px] flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or id"
              aria-label="Search customers"
              className={`${inputClass} !h-10 pl-10 text-[13px]`}
            />
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All ${all.length}` },
              { value: "attention", label: `Needs attention ${attention}` },
              { value: "learning", label: `Still learning ${learning}` },
            ]}
          />
        </div>

        {isLoading && !data ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<UsersThree size={22} />}
            title={all.length ? "Nobody matches" : "No customers yet"}
            body={all.length ? "Try a different search or filter." : "Customers appear once they make a transfer."}
          />
        ) : (
          <>
          <ul className="divide-y divide-d-border md:hidden">
            {rows.map((c) => {
              const v = c.verification;
              return (
                <li key={c.user_id}>
                  <Link href={`/dashboard/customers/${encodeURIComponent(c.user_id)}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-d-surface-2">
                    <Avatar name={nameFor(c.user_id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-d-text">{nameFor(c.user_id)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-d-muted">
                        {c.transactions_analyzed.toLocaleString("en-NG")} transfers
                        {v?.pin_locked ? <Badge tone="danger">PIN locked</Badge> : v && !v.passkeys && !v.contact_set ? <Badge tone="warning">Weak</Badge> : null}
                        {!c.has_baseline && <Badge tone="warning">Learning</Badge>}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold tabular-nums text-d-text">{c.balance != null ? formatNaira(c.balance) : "-"}</span>
                      <CaretRight size={14} className="ml-auto mt-1 text-d-faint" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className={`${table.wrap} hidden md:block`}>
            <table className={`${table.base} min-w-[760px]`}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Customer</th>
                  <th className={table.th}>Transfers</th>
                  <th className={table.th}>Typical amount</th>
                  <th className={table.th}>Security</th>
                  <th className={table.th}>Balance</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const v = c.verification;
                  return (
                    <tr key={c.user_id} className={table.row}>
                      <td className={table.td}>
                        <Link href={`/dashboard/customers/${encodeURIComponent(c.user_id)}`} className="flex items-center gap-3">
                          <Avatar name={nameFor(c.user_id)} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-d-text hover:text-brand">{nameFor(c.user_id)}</span>
                            <span className="block truncate font-mono text-[11px] text-d-faint">{c.user_id}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={`${table.td} tabular-nums`}>
                        {c.transactions_analyzed.toLocaleString("en-NG")}
                        {!c.has_baseline && (
                          <span className="ml-2">
                            <Badge tone="warning">Learning</Badge>
                          </span>
                        )}
                      </td>
                      <td className={`${table.td} text-d-muted`}>{c.typical_range ?? "-"}</td>
                      <td className={table.td}>
                        {v ? (
                          <div className="flex flex-wrap gap-1">
                            {v.pin_locked ? (
                              <Badge tone="danger">PIN locked</Badge>
                            ) : (
                              <Badge tone={v.pin_set ? "success" : "neutral"}>{v.pin_set ? "PIN" : "No PIN"}</Badge>
                            )}
                            {v.passkeys > 0 && <Badge tone="success">Passkey</Badge>}
                            {!v.passkeys && !v.contact_set && <Badge tone="warning">Weak</Badge>}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className={`${table.td} whitespace-nowrap tabular-nums`}>
                        {c.balance != null ? formatNaira(c.balance) : "-"}
                      </td>
                      <td className="pr-4">
                        <Link href={`/dashboard/customers/${encodeURIComponent(c.user_id)}`} aria-label={`Open ${nameFor(c.user_id)}`}>
                          <CaretRight size={14} className="text-d-faint" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}
