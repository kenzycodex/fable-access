"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CaretDown, CheckCircle } from "@phosphor-icons/react";
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
/** A greeting that fits the customer's device clock, with a little variety so
 * the header doesn't read like a static label. Computed client-side after mount
 * (the server can't know the device's local hour without a hydration mismatch),
 * with a neutral default until then. */
function useTimeGreeting(): string {
  const [greeting, setGreeting] = useState("Hello 👋");
  useEffect(() => {
    const h = new Date().getHours();
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    if (h >= 5 && h < 12) setGreeting(pick(["Good morning ☀️", "Rise and shine ☀️", "Morning 👋"]));
    else if (h >= 12 && h < 17) setGreeting(pick(["Good afternoon 👋", "Hope your day's going well 👋", "Afternoon 👋"]));
    else if (h >= 17 && h < 22) setGreeting(pick(["Good evening 🌆", "Evening 👋", "Winding down? 🌆"]));
    else setGreeting(pick(["Working late? 🌙", "Burning the midnight oil? 🌙", "Good evening 🌙"]));
  }, []);
  return greeting;
}

export function CustomerSwitcher({ greeting: greetingProp }: { greeting?: string }) {
  const { customers, customer, selectCustomer, name } = useInstitution();
  const [open, setOpen] = useState(false);
  const timeGreeting = useTimeGreeting();
  const greeting = greetingProp ?? timeGreeting;

  // Defaulting to a customer is the provider's job, done *after* it restores
  // the saved choice from sessionStorage. Doing it here too raced ahead of that
  // restore — this child effect runs before the parent's — and overwrote the
  // saved customer with the first one, so every reload snapped back to customer
  // one. Removed; the provider is the single source of the default.

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
        subtitle={`${name} · each has their own baseline`}
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
                    ? "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/[0.07]"
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
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-[var(--brand-primary)]" />
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
          Send the same amount as different people — Shield judges each against their own history.
        </p>

        {/* Leaving the sandbox lives with the account actions, the way sign-out
            does in a real app, so it works on every breakpoint. */}
        <Link
          href="/"
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-white/50 dark:hover:bg-white/[0.04]"
        >
          <ArrowLeft size={15} weight="bold" />
          Exit
        </Link>
      </DemoSheet>
    </>
  );
}
