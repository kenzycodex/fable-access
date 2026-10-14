"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  Bank,
  ClockCounterClockwise,
  List,
  Moon,
  Plus,
  ShieldCheck,
  SignOut,
  Sparkle,
  SquaresFour,
  Sun,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { Avatar, IconButton } from "@/components/app-kit";
import { useConsoleLayout } from "@/lib/fable/layout";
import { can, operatorSignOut, ROLE_LABEL, useOperatorMe, useOperatorSession } from "@/lib/fable/operator";

const NAV = [
  {
    group: "Platform",
    items: [
      { href: "/operator", label: "Overview", icon: SquaresFour, match: (p: string) => p === "/operator" },
      { href: "/operator/institutions", label: "Institutions", icon: Bank, match: (p: string) => p.startsWith("/operator/institutions") },
      { href: "/operator/assistant", label: "Ask Fable", icon: Sparkle, match: (p: string) => p.startsWith("/operator/assistant") },
    ],
  },
  {
    group: "Fable team",
    items: [
      { href: "/operator/team", label: "Operators", icon: UsersThree, match: (p: string) => p.startsWith("/operator/team") },
      { href: "/operator/audit", label: "Audit log", icon: ClockCounterClockwise, match: (p: string) => p.startsWith("/operator/audit") },
    ],
  },
];

const ALL = NAV.flatMap((g) => g.items);

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
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (session === null) window.location.replace("/operator/login");
  }, [session]);

  if (!session) return <div className="console-shell min-h-dvh bg-d-bg" />;

  const current = ALL.find((i) => i.match(pathname));
  const name = me?.name || session.email;

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
        <div className="nav-brand flex items-center justify-between px-6 pb-2 pt-6">
          <Link href="/operator" className="flex items-center" aria-label="Operator home">
            <span className="nav-wide-only flex items-center">
              <Image src="/images/brand/fable-logo-white.png" alt="Fable" width={1671} height={547} className="hidden h-7 w-auto dark:block" />
              <Image src="/images/brand/fable-logo.png" alt="Fable" width={1671} height={547} className="block h-7 w-auto dark:hidden" />
            </span>
            <Image src="/images/brand/fable-logo-icon.png" alt="Fable" width={1254} height={1254} className="nav-rail-only hidden size-10" />
          </Link>
          <span className="nav-wide-only rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
            Operator
          </span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-xl text-d-muted hover:bg-d-surface-2 lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4 pt-6">
          {NAV.map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              <p className="nav-group-title mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{group.group}</p>
              {group.items.map((item) => {
                const active = item.match(pathname);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} title={item.label} onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                      active ? "bg-brand text-white shadow-sm" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
                    }`}>
                    <Icon size={19} weight={active ? "fill" : "regular"} />
                    <span className="nav-text">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-d-border p-3">
          <div className="nav-account flex items-center gap-3 rounded-xl p-2" title={session.email}>
            <Avatar name={name} size="sm" />
            <span className="nav-text min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-d-text">{name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-d-muted">
                <ShieldCheck size={12} weight="fill" className="text-emerald-500" />
                {ROLE_LABEL[session.role]}
              </span>
            </span>
            <button type="button" onClick={operatorSignOut} aria-label="Sign out" title="Sign out"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-d-muted transition-colors hover:bg-red-500/10 hover:text-red-500">
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="transition-[padding] duration-200 lg:pl-[var(--sidebar-w)]">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-d-border bg-d-bg/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton label="Open menu" onClick={() => setOpen(true)} className="lg:hidden">
              <List size={18} />
            </IconButton>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex">
              <span className="text-d-faint">Operator</span>
              <span className="text-d-faint">/</span>
              <span className="truncate font-semibold text-d-text">{current?.label ?? "Platform"}</span>
            </nav>
            <span className="truncate text-[15px] font-bold text-d-text lg:hidden">{current?.label ?? "Operator"}</span>
          </div>
          <div className="flex items-center gap-2">
            {can(session.role, "platform_admin") && pathname !== "/operator/institutions/new" && (
              <Link href="/operator/institutions/new"
                className="hidden h-10 items-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white transition-all hover:brightness-110 sm:inline-flex">
                <Plus size={15} weight="bold" /> New institution
              </Link>
            )}
            <span className="hidden h-10 items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-[12px] font-semibold text-amber-700 dark:text-amber-300 md:inline-flex">
              <ShieldCheck size={14} weight="fill" /> {ROLE_LABEL[session.role]}
            </span>
            <IconButton label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              <Sun size={18} className="hidden dark:block" />
              <Moon size={18} className="dark:hidden" />
            </IconButton>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
