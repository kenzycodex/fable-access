"use client";

import Link from "next/link";
import { LinkRow } from "@/components/dashboard/LinkRow";
import { useDeferredValue, useMemo, useState } from "react";
import { Brain, CaretRight, Fingerprint, MagnifyingGlass, Plus, ShieldWarning, Sparkle, UploadSimple, UsersThree } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/dashboard/Dialog";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Segmented,
  Skeleton,
  StatCard,
  StatGrid,
  TextInput,
  inputClass,
  table,
} from "@/components/dashboard/primitives";
import type { BankCustomer, CopilotCustomer } from "@/lib/fable/api";
import { addCustomer, addDemoCustomer } from "@/lib/fable/console";
import { formatNaira } from "@/lib/fable/format";
import { useCopilotCustomers } from "@/lib/fable/useBackend";
import { useBankCustomers, useOnboarding, usePermissions } from "@/lib/fable/useConsole";

type Filter = "all" | "attention" | "learning" | "test";

/** A customer needs attention when their security is weak or locked. */
function needsAttention(c?: CopilotCustomer): boolean {
  const v = c?.verification;
  return Boolean(v && (v.pin_locked || (!v.passkeys && !v.contact_set)));
}

interface Row {
  customer: BankCustomer;
  stats?: CopilotCustomer;
}

export default function CustomersPage() {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const { canReview, canManage } = usePermissions();
  const { data: onboarding } = useOnboarding();
  const sandbox = onboarding ? onboarding.mode !== "live" : false;
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const { data: roster, isLoading, mutate } = useBankCustomers({ q });

  // A clean customer for a demo, in one click: Shield has learned nothing
  // about them, so the first transfers score the way a new customer's would.
  async function newDemoCustomer() {
    setMaking(true);
    try {
      const made = await addDemoCustomer();
      toast.success(`${made.name} is ready with ${formatNaira(1_000_000)}. Pick them in the sandbox app.`);
      await mutate();
      router.push(`/dashboard/customers/${encodeURIComponent(made.id)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the demo customer.");
    } finally {
      setMaking(false);
    }
  }
  const { data: copilot } = useCopilotCustomers();

  const stats = useMemo(() => new Map((copilot?.customers ?? []).map((c) => [c.user_id, c])), [copilot]);
  const all: Row[] = useMemo(
    () => (roster?.customers ?? []).map((customer) => ({ customer, stats: stats.get(customer.id) })),
    [roster, stats],
  );
  const rows = all.filter(({ customer, stats: s }) => {
    if (filter === "attention") return needsAttention(s);
    if (filter === "learning") return !s?.has_baseline;
    if (filter === "test") return customer.kind === "test";
    return true;
  });

  const attention = all.filter((r) => needsAttention(r.stats)).length;
  const learning = all.filter((r) => !r.stats?.has_baseline).length;
  const tests = all.filter((r) => r.customer.kind === "test").length;
  const withPasskey = all.filter((r) => (r.stats?.verification?.passkeys ?? 0) > 0).length;
  const loaded = Boolean(roster);
  const total = roster?.total ?? 0;
  const empty = loaded && total === 0 && !q;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone Fable protects at your institution, by your own reference."
        actions={
          <div className="flex gap-2">
            {canManage && (
              <ButtonLink href="/dashboard/settings/data" variant="secondary" icon={<UploadSimple size={16} />}>
                Import
              </ButtonLink>
            )}
            {canReview && sandbox && (
              <Button variant="secondary" icon={<Sparkle size={16} />} loading={making} onClick={newDemoCustomer}>
                New demo customer
              </Button>
            )}
            {canReview && <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Add customer</Button>}
          </div>
        }
      />

      <StatGrid>
        <StatCard label="Customers" value={loaded ? total.toLocaleString("en-NG") : "-"} sub={loaded ? `${tests} test` : "Loading"} icon={<UsersThree size={17} weight="fill" />} featured />
        <StatCard label="Baselines built" value={loaded ? String(all.length - learning) : "-"} sub={loaded ? `${learning} still learning` : "Loading"} tone="success" icon={<Brain size={17} weight="fill" />} />
        <StatCard label="With a passkey" value={loaded ? String(withPasskey) : "-"} sub="Strongest verification" tone="warning" icon={<Fingerprint size={17} weight="fill" />} />
        <StatCard label="Needs attention" value={loaded ? String(attention) : "-"} sub="Locked PIN or weak security" tone="danger" icon={<ShieldWarning size={17} weight="fill" />} />
      </StatGrid>

      <Card padded={false}>
        {!empty && (
          <div className="flex flex-wrap items-center gap-3 border-b border-d-border p-4">
            <div className="relative min-w-[220px] flex-1">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, reference, phone or email"
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
                ...(tests ? [{ value: "test" as const, label: `Test ${tests}` }] : []),
              ]}
            />
          </div>
        )}

        {isLoading && !roster ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            icon={<UsersThree size={22} />}
            title="No customers yet"
            body="Import your customers and their past transfers so Fable starts with a baseline, or add one by hand."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {canManage && <ButtonLink href="/dashboard/settings/data" icon={<UploadSimple size={16} />}>Import customers</ButtonLink>}
                {canReview && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Add one</Button>}
              </div>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<UsersThree size={22} />} title="Nobody matches" body="Try a different search or filter." />
        ) : (
          <>
            <ul className="divide-y divide-d-border md:hidden">
              {rows.map(({ customer: c, stats: s }) => {
                const v = s?.verification;
                const name = c.name || c.reference;
                return (
                  <li key={c.id}>
                    <Link href={`/dashboard/customers/${encodeURIComponent(c.id)}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-d-surface-2">
                      <Avatar name={name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-d-text">{name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-d-muted">
                          <span className="font-mono">{c.reference}</span>
                          {c.kind === "test" && <Badge tone="brand">Test</Badge>}
                          {c.status === "closed" && <Badge tone="neutral">Closed</Badge>}
                          {v?.pin_locked ? <Badge tone="danger">PIN locked</Badge> : needsAttention(s) ? <Badge tone="warning">Weak</Badge> : null}
                          {!s?.has_baseline && <Badge tone="warning">Learning</Badge>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold tabular-nums text-d-text">{s?.balance != null ? formatNaira(s.balance) : "-"}</span>
                        <CaretRight size={14} className="ml-auto mt-1 text-d-faint" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className={`${table.wrap} hidden md:block`}>
              <table className={`${table.base} min-w-[820px]`}>
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
                  {rows.map(({ customer: c, stats: s }) => {
                    const v = s?.verification;
                    const name = c.name || c.reference;
                    const href = `/dashboard/customers/${encodeURIComponent(c.id)}`;
                    return (
                      <LinkRow key={c.id} href={href} label={`Open ${name}`}>
                        <td className={table.td}>
                          <Link href={href} className="flex items-center gap-3">
                            <Avatar name={name} size="sm" />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="truncate font-semibold text-d-text hover:text-brand">{name}</span>
                                {c.kind === "test" && <Badge tone="brand">Test</Badge>}
                                {c.status === "closed" && <Badge tone="neutral">Closed</Badge>}
                              </span>
                              {c.name && <span className="block truncate font-mono text-[12px] text-d-muted">{c.reference}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className={`${table.td} tabular-nums`}>
                          {(s?.transactions_analyzed ?? 0).toLocaleString("en-NG")}
                          {!s?.has_baseline && (
                            <span className="ml-2">
                              <Badge tone="warning">Learning</Badge>
                            </span>
                          )}
                        </td>
                        <td className={`${table.td} text-d-muted`}>{s?.typical_range ?? "-"}</td>
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
                          {s?.balance != null ? formatNaira(s.balance) : "-"}
                        </td>
                        <td className="pr-4">
                          <CaretRight size={14} className="text-d-faint" aria-hidden />
                        </td>
                      </LinkRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > all.length && (
              <p className="border-t border-d-border px-5 py-3 text-[12px] text-d-muted">
                Showing {all.length.toLocaleString("en-NG")} of {total.toLocaleString("en-NG")}. Search to find anyone else.
              </p>
            )}
          </>
        )}
      </Card>

      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} onDone={() => mutate()} />
    </>
  );
}

/** Add one customer by hand. Test customers (sandbox only) can start with a balance. */
function AddCustomerDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { data: onboarding } = useOnboarding();
  const sandbox = onboarding?.mode !== "live";
  const [form, setForm] = useState({ reference: "", name: "", phone: "", email: "", segment: "", kind: "test" as "test" | "real", balance: "" });
  const [busy, setBusy] = useState(false);
  const kind = sandbox ? form.kind : "real";
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function go() {
    setBusy(true);
    try {
      const made = await addCustomer({
        reference: form.reference.trim(),
        name: form.name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        segment: form.segment.trim() || undefined,
        kind,
        opening_balance: kind === "test" && form.balance ? Number(form.balance) : undefined,
      });
      toast.success(`${made.name || made.reference} added`);
      setForm({ reference: "", name: "", phone: "", email: "", segment: "", kind: "test", balance: "" });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the customer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a customer"
      description="Use the reference your own systems know them by, such as an account or CIF number. To add many at once, import a CSV."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!form.reference.trim()} onClick={go}>Add customer</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Your reference">
          <TextInput value={form.reference} onChange={set("reference")} placeholder="CIF-000123" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} placeholder="Optional" />
        </Field>
        <Field label="Phone">
          <TextInput value={form.phone} onChange={set("phone")} placeholder="+234..." inputMode="tel" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={set("email")} placeholder="Optional" />
        </Field>
        <Field label="Segment">
          <TextInput value={form.segment} onChange={set("segment")} placeholder="e.g. Salaried, SME" />
        </Field>
        {sandbox && (
          <Field label="Kind">
            <select value={form.kind} onChange={set("kind")} className={inputClass}>
              <option value="test">Test (sandbox app only)</option>
              <option value="real">Real customer</option>
            </select>
          </Field>
        )}
        {kind === "test" && (
          <Field label="Opening balance (₦)">
            <TextInput value={form.balance} onChange={set("balance")} placeholder="250000" inputMode="decimal" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
