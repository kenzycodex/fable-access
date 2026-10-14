"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bank, ClockCounterClockwise, List, ShieldCheck, SignOut, UsersThree, X } from "@phosphor-icons/react";
import { Avatar } from "@/components/app-kit";
import { useConsoleLayout } from "@/lib/fable/layout";
import { operatorSignOut, ROLE_LABEL, useOperatorMe, useOperatorSession } from "@/lib/fable/operator";

const NAV = [
  { href: "/operator", label: "Institutions", icon: Bank, match: (p: string) => p === "/operator" || p.startsWith("/operator/institutions") },
  { href: "/operator/team", label: "Operators", icon: UsersThree, match: (p: string) => p.startsWith("/operator/team") },
  { href: "/operator/audit", label: "Audit", icon: ClockCounterClockwise, match: (p: string) => p.startsWith("/operator/audit") },
];

/**
 * The operator platform's frame. Fable staff only: without an operator session
 * it sends you to the operator sign-in, never to a bank's console.
 */
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const session = useOperatorSession();
  const layout = useConsoleLayout();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data: me } = useOperatorMe();

  useEffect(() => {
    if (session === null) window.location.replace("/operator/login");
  }, [session]);

  if (!session) return <div className="console-shell min-h-dvh bg-d-bg" />;

  return (
    <div data-layout={layout} className="console-shell min-h-dvh bg-d-bg text-d-text">
      {open && (
        <button type="button" aria-label="Close menu" onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-d-border bg-d-surface transition-[transform,width] duration-200 lg:z-40 lg:w-[var(--sidebar-w)] lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <Link href="/operator" className="flex items-center" aria-label="Operator home">
            <Image src="/images/brand/fable-logo-white.png" alt="Fable" width={1671} height={547} className="hidden h-7 w-auto dark:block" />
            <Image src="/images/brand/fable-logo.png" alt="Fable" width={1671} height={547} className="block h-7 w-auto dark:hidden" />
          </Link>
          <span className="nav-wide-only rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
            Operator
          </span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-xl text-d-muted hover:bg-d-surface-2 lg:hidden">
            <X size={18} />
          </button>
        </div>
        <nav className="nav-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-4 pt-6">
          <p className="nav-group-title mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">Platform</p>
          {NAV.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} title={item.label} onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`nav-item flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                  active ? "bg-brand text-white shadow-sm" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
                }`}>
                <Icon size={19} weight={active ? "fill" : "regular"} />
                <span className="nav-text">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-d-border p-3">
          <div className="nav-item flex items-center gap-3 rounded-xl p-2.5" title={session.email}>
            <Avatar name={me?.name || session.email} size="sm" />
            <span className="nav-text min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-d-text">{me?.name || session.email}</span>
              <span className="flex items-center gap-1 text-[11px] leading-tight text-d-muted">
                <ShieldCheck size={12} weight="fill" className="text-emerald-500" />
                {ROLE_LABEL[session.role]}
              </span>
            </span>
            <button type="button" onClick={operatorSignOut} aria-label="Sign out" title="Sign out"
              className="nav-wide-only flex size-8 items-center justify-center rounded-lg text-d-muted transition-colors hover:bg-red-500/10 hover:text-red-500">
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="transition-[padding] duration-200 lg:pl-[var(--sidebar-w)]">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-d-border bg-d-surface/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu"
            className="flex size-10 items-center justify-center rounded-xl border border-d-border text-d-muted">
            <List size={18} />
          </button>
          <span className="text-[14px] font-bold">Fable operator</span>
          <button type="button" onClick={operatorSignOut} aria-label="Sign out"
            className="flex size-10 items-center justify-center rounded-xl border border-d-border text-d-muted">
            <SignOut size={16} />
          </button>
        </div>
        <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
