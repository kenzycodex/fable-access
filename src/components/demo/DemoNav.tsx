"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  Bell,
  ClockCounterClockwise,
  CreditCard,
  House,
  PaperPlaneTilt,
  Plus,
  ShieldCheck,
  SignOut,
  UsersThree,
  CaretUp,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { SwitchCustomerSheet } from "@/components/demo/CustomerSwitcher";
import { HeaderActions } from "@/components/demo/HeaderActions";
import { Avatar } from "@/components/demo/kit";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { customerNotifications } from "@/lib/fable/api";

// Paths are relative to the institution root; the provider's href() prefixes
// them with /demo/{institution}.
interface NavItem {
  path: string;
  label: string;
  icon: Icon;
}

const MAIN: NavItem[] = [
  { path: "", label: "Dashboard", icon: House },
  { path: "/transfer", label: "Transfer", icon: PaperPlaneTilt },
  { path: "/add-money", label: "Add money", icon: Plus },
  { path: "/history", label: "Activity", icon: ClockCounterClockwise },
  { path: "/cards", label: "Cards", icon: CreditCard },
];

const OTHERS: NavItem[] = [
  { path: "/notifications", label: "Notifications", icon: Bell },
  { path: "/transparency", label: "Security", icon: ShieldCheck },
];

function useActive() {
  const { href } = useInstitution();
  const pathname = usePathname();
  return (item: NavItem) => {
    const target = href(item.path);
    return item.path === "" ? pathname === target : pathname.startsWith(target);
  };
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const { name, branding } = useInstitution();
  const dim = size === "sm" ? "size-8" : "size-9";
  return branding.logo_url ? (
    // A logo is whatever shape its owner uploaded, so it is contained, not
    // cropped. The space it leaves above and below takes the bank's primary
    // colour rather than white, so a wide wordmark sits in a filled badge.
    <span
      className={`flex ${dim} shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10`}
      style={{ backgroundColor: "var(--brand-primary, #7c3aed)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
      <img src={branding.logo_url} alt={name} className="size-full object-contain" />
    </span>
  ) : (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white shadow-sm`}
      style={{
        background:
          "linear-gradient(135deg, var(--brand-primary, #7c3aed), color-mix(in srgb, var(--brand-primary, #7c3aed) 60%, #000))",
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Sidebar() {
  const { name, href, customer } = useInstitution();
  const isActive = useActive();

  const { data } = useSWR(
    customer ? ["demo:notifications", customer.user_id] : null,
    () => customerNotifications(customer!.user_id, 30),
    { refreshInterval: 10_000, keepPreviousData: true },
  );
  const unread = data?.unread ?? 0;

  const group = (label: string, items: NavItem[]) => (
    <div>
      <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{label}</p>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          const badge = item.path === "/notifications" ? unread : 0;
          return (
            <Link
              key={item.path}
              href={href(item.path)}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                active ? "bg-brand/10 text-brand" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
              }`}
            >
              <Icon size={19} weight={active ? "fill" : "regular"} />
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-[18px] text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[256px] flex-col border-r border-d-border bg-d-surface lg:flex">
      {/* The menu scrolls on a short window; the account row below never does. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pb-4 pt-6">
        <Link href={href()} className="flex items-center gap-3 px-2">
          <BrandMark />
          <span className="truncate text-[17px] font-bold tracking-tight text-d-text">{name}</span>
        </Link>
        {group("Main menu", MAIN)}
        {group("Others", OTHERS)}
      </div>

      <div className="shrink-0 border-t border-d-border p-3">
        <AccountMenu />
      </div>
    </aside>
  );
}

/**
 * The signed-in customer at the foot of the sidebar, with a menu above it: the
 * pattern Claude and ChatGPT use. Switching customer and leaving the demo live
 * here, so neither sits in the navigation as if it were a page.
 */
function AccountMenu() {
  const { customer, customers, name } = useInstitution();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayName = customer?.name ?? name;

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-2xl border border-d-border bg-d-surface shadow-[0_18px_40px_-12px_rgba(0,0,0,0.25)]"
        >
          <p className="border-b border-d-border px-4 py-3 text-[11px] leading-relaxed text-d-faint">
            Demo environment. Balances are simulated and no real money moves.
          </p>
          {customers.length > 1 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setSwitching(true);
              }}
              className="flex h-11 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-d-text transition-colors hover:bg-d-surface-2"
            >
              <UsersThree size={18} className="text-d-muted" />
              Switch customer
            </button>
          )}
          <Link
            href="/"
            role="menuitem"
            className="flex h-11 w-full items-center gap-3 border-t border-d-border px-4 text-[14px] font-medium text-red-600 transition-colors hover:bg-red-500/[0.06] dark:text-red-400"
          >
            <SignOut size={18} />
            Exit demo
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-d-surface-2 ${
          open ? "bg-d-surface-2" : ""
        }`}
      >
        <Avatar name={displayName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-d-text">{displayName}</span>
          <span className="block truncate text-[11px] leading-tight text-d-muted">
            {customer ? customer.persona : "Demo account"}
          </span>
        </span>
        <CaretUp size={14} className={`shrink-0 text-d-faint transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      <SwitchCustomerSheet open={switching} onClose={() => setSwitching(false)} />
    </div>
  );
}

/** Phone top bar: who the bank is, and the shared controls. */
function MobileTopBar() {
  const { name, href } = useInstitution();
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-d-border bg-d-surface/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
      <Link href={href()} className="flex min-w-0 items-center gap-2.5">
        <BrandMark size="sm" />
        <span className="truncate text-[15px] font-bold tracking-tight text-d-text">{name}</span>
      </Link>
      <HeaderActions />
    </div>
  );
}

const TAB_ITEMS: NavItem[] = [
  { path: "", label: "Home", icon: House },
  { path: "/history", label: "Activity", icon: ClockCounterClockwise },
  { path: "/transfer", label: "Transfer", icon: PaperPlaneTilt },
  { path: "/cards", label: "Cards", icon: CreditCard },
  { path: "/transparency", label: "Security", icon: ShieldCheck },
];

function BottomNav() {
  const { href } = useInstitution();
  const isActive = useActive();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-d-border bg-d-surface/95 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-md items-end justify-around px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
        {TAB_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          const primary = item.path === "/transfer";

          if (primary) {
            return (
              <Link
                key={item.path}
                href={href(item.path)}
                aria-label="Transfer"
                className="-mt-6 flex flex-col items-center gap-1"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_10px_24px_-8px_var(--brand-primary,#7c3aed)] ring-4 ring-d-surface">
                  <Icon size={24} weight="fill" />
                </span>
                <span className={`text-[11px] font-semibold ${active ? "text-brand" : "text-d-muted"}`}>{item.label}</span>
              </Link>
            );
          }

          return (
            <Link
              key={item.path}
              href={href(item.path)}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-[56px] flex-col items-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                active ? "text-brand" : "text-d-faint"
              }`}
            >
              <Icon size={22} weight={active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** The demo bank's frame: sidebar on desktop, top bar and tab bar on a phone. */
export function DemoShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="min-h-dvh lg:pl-[256px]">
        <MobileTopBar />
        <main className="pb-28 lg:pb-8">{children}</main>
      </div>
      <BottomNav />
    </>
  );
}
