"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@/components/app-icons";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/** Page wrapper — consistent padding across breakpoints. */
export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-2xl px-4 pb-6 pt-4 sm:px-5 lg:max-w-none lg:px-8 lg:pt-6 ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Page header with back arrow on mobile. Back defaults to the current
 * institution's home, so callers never hardcode a tenant-less /demo link. */
export function ScreenHeader({
  title,
  subtitle,
  backHref,
  right,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  right?: ReactNode;
}) {
  const { href } = useInstitution();
  const target = backHref ?? href();
  return (
    <header className="mb-5 flex items-center gap-3">
      {target && (
        <Link
          href={target}
          aria-label="Back"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-[#1a1a1a] dark:text-white/60 dark:hover:bg-[#222] lg:hidden"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
      )}
      <div className="flex min-w-0 flex-col">
        <p className="truncate text-[16px] font-semibold text-gray-900 dark:text-white">{title}</p>
        {subtitle && <p className="truncate text-[12px] text-gray-500 dark:text-white/40">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </header>
  );
}

/** Solid card — white in light mode, #1a1a1a in dark mode. */
export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`rounded-2xl bg-white shadow-sm border border-gray-100 dark:border-transparent dark:bg-[#1a1a1a] dark:shadow-none p-4 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

const AVATAR_TINTS = [
  "bg-purple-100 text-purple-600 dark:bg-[var(--brand-primary)]/20 dark:text-[#A78BFA]",
  "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  // Simpler hash that distributes better across short strings
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_TINTS.length;
  const dim = size === "lg" ? "size-11 text-[15px]" : size === "sm" ? "size-8 text-[11px]" : "size-9 text-[13px]";
  return (
    <span className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-bold ${AVATAR_TINTS[idx]}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
