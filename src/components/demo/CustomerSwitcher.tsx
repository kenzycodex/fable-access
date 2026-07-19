"use client";

import { useEffect, useState } from "react";
import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import { Avatar } from "@/components/demo/kit";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/**
 * Who is signed into the demo bank, rendered as the account row it replaces —
 * avatar, greeting, name — so switching lives exactly where a real banking app
 * puts profile switching instead of in a separate block above the page.
 *
 * The choice matters because Shield scores against the selected customer's own
 * baseline: ₦250,000 is routine for the trader and a flag for the student.
 */
export function CustomerSwitcher({ greeting = "Good morning 👋" }: { greeting?: string }) {
  const { customers, customer, selectCustomer, name } = useInstitution();
  const [open, setOpen] = useState(false);

  // Default to the first customer so a transfer is never attributed to nobody.
  useEffect(() => {
    if (!customer && customers.length > 0) selectCustomer(customers[0]);
  }, [customer, customers, selectCustomer]);

  const displayName = customer?.name ?? name;
  const firstName = displayName.split(" ")[0];
  const switchable = customers.length > 1;

  return (
    <>
      <button
        type="button"
        onClick={() => switchable && setOpen(true)}
        disabled={!switchable}
        aria-label={switchable ? `Signed in as ${displayName}. Switch customer` : displayName}
        className={`group -ml-1 flex min-w-0 items-center gap-3 rounded-2xl p-1 pr-2.5 text-left transition-colors ${
          switchable ? "hover:bg-gray-100 dark:hover:bg-white/[0.04]" : "cursor-default"
        }`}
      >
        <Avatar name={firstName} size="lg" />
        <span className="min-w-0">
          <span className="block text-[12px] text-gray-500 dark:text-white/40">{greeting}</span>
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">
              {displayName}
            </span>
            {switchable && (
              <CaretDown
                size={12}
                weight="bold"
                className="shrink-0 text-gray-400 transition-transform group-hover:translate-y-0.5 dark:text-white/30"
              />
            )}
          </span>
        </span>
      </button>

      <DemoSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Switch customer"
        subtitle={`${name} · each person has their own learned baseline`}
      >
        <div className="flex flex-col gap-2">
          {customers.map((c) => {
            const active = customer?.user_id === c.user_id;
            return (
              <button
                key={c.user_id}
                type="button"
                onClick={() => {
                  selectCustomer(c);
                  setOpen(false);
                }}
                className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                  active
                    ? "border-[#7C3AED]/40 bg-[#7C3AED]/[0.07]"
                    : "border-gray-200 hover:bg-gray-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
                }`}
              >
                <Avatar name={c.name.split(" ")[0]} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold text-gray-900 dark:text-white">
                      {c.name}
                    </span>
                    {active && (
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-[#7C3AED]" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-gray-500 dark:text-white/40">
                    {c.description}
                  </span>
                  <span className="mt-1.5 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-white/[0.06] dark:text-white/50">
                    {c.persona} · typically {c.typical_range}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-gray-500 dark:text-white/35">
          Send the same amount as different people to see Shield judge it against each
          customer&apos;s own history rather than a global threshold.
        </p>
      </DemoSheet>
    </>
  );
}
