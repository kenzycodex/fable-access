"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretDown, CheckCircle, SignOut } from "@phosphor-icons/react";
import { Avatar } from "@/components/app-kit";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/**
 * Who is signed into the demo bank. Lives in the header, where a real banking
 * app puts the profile menu.
 *
 * The choice matters because Shield scores against the selected customer's own
 * baseline: ₦250,000 is routine for the trader and a flag for the student.
 *
 * Defaulting to a customer is the provider's job, done after it restores the
 * saved choice from sessionStorage. Doing it here too raced ahead of that
 * restore and snapped every reload back to the first customer.
 */
/** The customer picker as a sheet, so it can be opened from the header or from
 * the sidebar's account menu. */
export function SwitchCustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { customers, customer, selectCustomer, name } = useInstitution();

  return (
    <DemoSheet open={open} onClose={onClose} title="Switch customer" subtitle={`${name} - each customer has their own baseline`}>
      <div className="flex flex-col gap-2">
        {customers.map((c) => {
          const active = customer?.user_id === c.user_id;
          return (
            <button
              key={c.user_id}
              type="button"
              onClick={() => {
                selectCustomer(c);
                onClose();
              }}
              className={`flex items-center gap-3 rounded-2xl border p-3 text-left sm:items-start sm:p-3.5 transition-colors ${
                active ? "border-brand/40 bg-brand/[0.07]" : "border-d-border hover:bg-d-surface-2"
              }`}
            >
              <Avatar name={c.name} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-semibold text-d-text">{c.name}</span>
                  {active && <CheckCircle size={18} weight="fill" className="shrink-0 text-brand" />}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-d-muted">
                  {c.segment ? `${c.segment} · ` : ""}Ref {c.reference}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 hidden text-[12px] leading-relaxed text-d-muted sm:block">
        Send the same amount as different customers and compare: Shield judges each against their own history.
      </p>

      <Link
        href="/"
        className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500/10 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white dark:text-red-400 dark:hover:text-white"
      >
        <SignOut size={15} weight="bold" />
        Exit demo
      </Link>
    </DemoSheet>
  );
}

export function CustomerSwitcher() {
  const { customers, customer, name } = useInstitution();
  const [open, setOpen] = useState(false);

  const displayName = customer?.name ?? name;
  const switchable = customers.length > 1;

  return (
    <>
      <button
        type="button"
        onClick={() => switchable && setOpen(true)}
        disabled={!switchable}
        aria-label={switchable ? `Signed in as ${displayName}. Switch customer` : displayName}
        className="group flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-d-border bg-d-surface pl-1 pr-2 text-left transition-colors hover:bg-d-surface-2 disabled:cursor-default sm:pr-3"
      >
        <Avatar name={displayName} size="sm" />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[120px] truncate text-[13px] font-semibold leading-tight text-d-text">
            {displayName}
          </span>
          {customer && (
            <span className="block max-w-[120px] truncate text-[11px] leading-tight text-d-muted">
              {customer.segment ?? `Ref ${customer.reference}`}
            </span>
          )}
        </span>
        {switchable && <CaretDown size={12} weight="bold" className="hidden shrink-0 text-d-faint sm:block" />}
      </button>

      <SwitchCustomerSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
