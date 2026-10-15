"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  Bank,
  BookOpen,
  CaretUp,
  ClockCounterClockwise,
  Desktop,
  GearSix,
  House,
  Key,
  Moon,
  ShieldCheck,
  SignOut,
  Sparkle,
  SquaresFour,
  Sun,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Avatar } from "@/components/app-kit";
import { operatorSignOut, ROLE_LABEL, useOperatorMe, useOperatorSession, usePlatformOverview } from "@/lib/fable/operator";
import { useApiStatus } from "@/lib/fable/useBackend";

interface Item {
  href: string;
  label: string;
  icon: Icon;
  match: (p: string) => boolean;
  badge?: "attention" | "security";
}

export const OPERATOR_NAV: { group: string; items: Item[] }[] = [
  {
    group: "Platform",
    items: [
      { href: "/operator", label: "Overview", icon: SquaresFour, match: (p) => p === "/operator" },
      { href: "/operator/institutions", label: "Institutions", icon: Bank, match: (p) => p.startsWith("/operator/institutions"), badge: "attention" },
      { href: "/operator/assistant", label: "Ask Fable", icon: Sparkle, match: (p) => p.startsWith("/operator/assistant") },
      { href: "/operator/secrets", label: "Secrets", icon: Key, match: (p) => p.startsWith("/operator/secrets") },
    ],
  },
  {
    group: "Governance",
    items: [
      { href: "/operator/audit", label: "Audit log", icon: ClockCounterClockwise, match: (p) => p.startsWith("/operator/audit"), badge: "security" },
      { href: "/operator/team", label: "Operators", icon: UsersThree, match: (p) => p.startsWith("/operator/team") },
    ],
  },
];

export const OPERATOR_PAGES = OPERATOR_NAV.flatMap((g) => g.items);

function Badge({ kind, active }: { kind: "attention" | "security"; active: boolean }) {
  const { data } = usePlatformOverview();
  const n = kind === "attention" ? data?.attention.length ?? 0 : data?.security.access_denied_24h ?? 0;
  if (!n) return null;
  const tone = active ? "bg-white/25 text-white" : kind === "security" ? "bg-red-500 text-white" : "bg-amber-500 text-white";
  return (
    <span className={`nav-badge ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-[11px] font-bold tabular-nums ${tone}`}
      title={kind === "attention" ? `${n} institution(s) need attention` : `${n} blocked cross-bank attempt(s) in 24 hours`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * The operator platform's left rail, built like the console's: grouped
 * navigation with live counts, links out at the foot, and the signed-in
 * operator with their menu. A drawer on a phone.
 */
export function OperatorSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const api = useApiStatus();

  return (
    <>
      {open && (
        <button type="button" aria-label="Close menu" onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-d-border bg-d-surface transition-[transform,width] duration-200 print:hidden lg:z-40 lg:w-[var(--sidebar-w)] lg:translate-x-0 ${
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
          <button type="button" onClick={onClose} aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-xl text-d-muted hover:bg-d-surface-2 lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4 pt-6">
          {OPERATOR_NAV.map((group) => (
            <div key={group.group}>
              <p className="nav-group-title mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{group.group}</p>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const active = item.match(pathname);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} title={item.label} onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`nav-item relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                        active ? "bg-brand text-white shadow-sm" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
                      }`}>
                      <Icon size={19} weight={active ? "fill" : "regular"} />
                      <span className="nav-text">{item.label}</span>
                      {item.badge && <Badge kind={item.badge} active={active} />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-1 border-t border-d-border pt-4">
            <span className="nav-item flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-d-muted"
              title={api === "api" ? "The Fable API is answering" : api === "checking" ? "Checking the API" : "The Fable API is not answering"}>
              <span className="flex size-[17px] items-center justify-center">
                <span className={`size-2 rounded-full ${api === "api" ? "bg-emerald-500" : api === "checking" ? "bg-d-faint" : "bg-red-500"}`} />
              </span>
              <span className="nav-text">{api === "api" ? "API healthy" : api === "checking" ? "Checking API" : "API not answering"}</span>
            </span>
            <a href="/docs" target="_blank" rel="noopener noreferrer" title="Documentation"
              className="nav-item flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-d-muted transition-colors hover:bg-d-surface-2 hover:text-d-text">
              <BookOpen size={17} />
              <span className="nav-text">Documentation</span>
            </a>
          </div>
        </nav>

        <div className="shrink-0 border-t border-d-border p-3">
          <AccountMenu />
        </div>
      </aside>
    </>
  );
}

function AccountMenu() {
  const session = useOperatorSession();
  const { data: me } = useOperatorMe();
  const { theme, setTheme } = useTheme();
  const api = useApiStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session) return null;
  const name = me?.name || session.email;
  const item = "flex h-10 w-full items-center justify-between gap-3 px-4 text-left text-[13px] font-medium text-d-text transition-colors hover:bg-d-surface-2";

  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="menu" className="nav-menu absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-2xl border border-d-border bg-d-surface shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-2 border-b border-d-border px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-d-text">{name}</span>
              <span className="block truncate text-[12px] text-d-muted">{session.email}</span>
            </span>
            <Link href="/operator/account" onClick={() => setOpen(false)} aria-label="Account settings" title="Account settings"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-d-muted hover:bg-d-surface-2 hover:text-d-text">
              <GearSix size={17} />
            </Link>
          </div>
          <div className="py-1">
            <div className={`${item} cursor-default hover:bg-transparent`}>
              <span>Theme</span>
              <span className="flex items-center gap-0.5 rounded-lg border border-d-border p-0.5">
                {([["system", Desktop, "System"], ["light", Sun, "Light"], ["dark", Moon, "Dark"]] as const).map(([value, Icon, label]) => (
                  <button key={value} type="button" onClick={() => setTheme(value)} aria-label={`${label} theme`} title={label}
                    className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                      (theme ?? "system") === value ? "bg-d-surface-2 text-d-text" : "text-d-faint hover:text-d-text"
                    }`}>
                    <Icon size={14} />
                  </button>
                ))}
              </span>
            </div>
            <Link href="/operator/account" role="menuitem" onClick={() => setOpen(false)} className={item}>
              Account and security <ShieldCheck size={16} className="text-d-muted" />
            </Link>
            <Link href="/" role="menuitem" className={item}>Home page <House size={16} className="text-d-muted" /></Link>
            <a href="/docs" target="_blank" rel="noopener noreferrer" role="menuitem" className={item}>
              Docs <BookOpen size={16} className="text-d-muted" />
            </a>
            <button type="button" role="menuitem" onClick={operatorSignOut} className={item}>
              Log out <SignOut size={16} className="text-d-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-d-border px-4 py-2.5 text-[12px]">
            <span className={api === "api" ? "text-brand" : api === "checking" ? "text-d-muted" : "text-red-500"}>
              {api === "api" ? "All systems normal." : api === "checking" ? "Checking status..." : "The API is not answering."}
            </span>
            <span className={`size-2 rounded-full ${api === "api" ? "bg-brand" : api === "checking" ? "bg-d-faint" : "bg-red-500"}`} />
          </div>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={name}
        className={`nav-item flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-d-surface-2 ${open ? "bg-d-surface-2" : ""}`}>
        <span className="relative shrink-0">
          <Avatar name={name} size="sm" />
          <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-d-surface bg-emerald-500" aria-hidden />
        </span>
        <span className="nav-text min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-d-text">{name}</span>
          <span className="block truncate text-[11px] leading-tight text-d-muted">{ROLE_LABEL[session.role]}</span>
        </span>
        <CaretUp size={14} className={`nav-wide-only shrink-0 text-d-faint transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
