"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { HeaderActions } from "@/components/demo/HeaderActions";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/**
 * Title row for every screen. On desktop the shared header controls sit at its
 * right edge; on a phone they live in the shell's top bar instead, so this row
 * is just a back arrow and the title.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  /** Show a back arrow. `true` goes to the institution home, a string goes there. */
  back?: boolean | string;
  right?: ReactNode;
}) {
  const { href } = useInstitution();
  const backHref = typeof back === "string" ? back : href();

  return (
    <header className="mb-6 flex items-center gap-3">
      {back && (
        <Link
          href={backHref}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-muted transition-colors hover:text-d-text"
        >
          <ArrowLeft size={18} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[22px] font-bold tracking-tight text-d-text lg:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-[13px] text-d-muted">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
      <div className="hidden shrink-0 lg:block">
        <HeaderActions />
      </div>
    </header>
  );
}
