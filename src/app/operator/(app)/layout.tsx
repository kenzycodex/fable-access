"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { List, Moon, Plus, ShieldCheck, Sun } from "@phosphor-icons/react";
import { IconButton } from "@/components/app-kit";
import { OPERATOR_PAGES, OperatorSidebar } from "@/components/operator/OperatorSidebar";
import { useConsoleLayout } from "@/lib/fable/layout";
import { can, ROLE_LABEL, useOperatorSession } from "@/lib/fable/operator";

/**
 * The operator platform's frame. Fable staff only: without an operator session
 * it sends you to the operator sign-in, never to a bank's console.
 */
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const session = useOperatorSession();
  const layout = useConsoleLayout();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (session === null) window.location.replace("/operator/login");
  }, [session]);

  if (!session) return <div className="console-shell min-h-dvh bg-d-bg" />;

  const current = OPERATOR_PAGES.find((i) => i.match(pathname));
  const crumb = pathname.startsWith("/operator/institutions/") && pathname !== "/operator/institutions/new"
    ? "Institution"
    : pathname === "/operator/institutions/new" ? "New institution" : null;

  return (
    <div data-layout={layout} className="console-shell min-h-dvh bg-d-bg text-d-text">
      <OperatorSidebar open={open} onClose={() => setOpen(false)} />
      <div className="transition-[padding] duration-200 lg:pl-[var(--sidebar-w)]">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-d-border bg-d-bg/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton label="Open menu" onClick={() => setOpen(true)} className="lg:hidden">
              <List size={18} />
            </IconButton>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex">
              <span className="text-d-faint">Operator</span>
              <span className="text-d-faint">/</span>
              {crumb ? (
                <>
                  <Link href="/operator/institutions" className="text-d-muted hover:text-d-text">Institutions</Link>
                  <span className="text-d-faint">/</span>
                  <span className="truncate font-semibold text-d-text">{crumb}</span>
                </>
              ) : (
                <span className="truncate font-semibold text-d-text">{current?.label ?? "Platform"}</span>
              )}
            </nav>
            <span className="truncate text-[15px] font-bold text-d-text lg:hidden">{crumb ?? current?.label ?? "Operator"}</span>
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
