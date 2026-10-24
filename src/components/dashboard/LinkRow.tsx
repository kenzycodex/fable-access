"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { table } from "@/components/dashboard/primitives";

/**
 * A table row that opens its detail page when clicked anywhere on it, not only
 * on a small arrow. Enter opens it from the keyboard, and Ctrl, Cmd or a middle
 * click opens it in a new tab, like a link. A click on a link or button inside
 * the row still does its own thing.
 */
export function LinkRow({
  href,
  label,
  className = "",
  children,
}: {
  href: string | null;
  /** Read out by screen readers, e.g. "Open Ada Obi". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  if (!href) return <tr className={`${table.row} ${className}`}>{children}</tr>;

  const fromInside = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest("a, button, input, select, textarea, label") !== null;

  function open(e: MouseEvent<HTMLTableRowElement>) {
    if (fromInside(e.target) || !href) return;
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  }

  function onKey(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === "Enter" && !fromInside(e.target) && href) router.push(href);
  }

  return (
    <tr
      tabIndex={0}
      role="link"
      aria-label={label}
      onClick={open}
      onAuxClick={open}
      onKeyDown={onKey}
      className={`${table.row} cursor-pointer outline-none focus-visible:bg-d-surface-2 ${className}`}
    >
      {children}
    </tr>
  );
}
