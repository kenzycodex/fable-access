"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, CloseIcon, MenuIcon } from "@/components/icons";
import { headerCta, primaryNav } from "@/data/nav";

export function MobileMenu({ transparent = false }: { transparent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const panel = (
    <div
      className={`fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-white transition-transform duration-200 ease-[cubic-bezier(0.79,0.14,0.15,0.86)] ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b border-black/10 px-[var(--gutter)] py-[var(--spacing-s)]">
        <Link href="/" onClick={() => setOpen(false)} aria-label="Fable home" className="flex shrink-0 items-center">
          <Image
            src="/images/brand/fable-logo.png"
            alt="Fable"
            width={1671}
            height={547}
            className="h-[48px] w-auto"
          />
        </Link>
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="inline-flex size-9 cursor-pointer items-center justify-center text-black transition-colors hover:text-secondary"
        >
          <CloseIcon className="size-[24px]" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-[var(--gutter)] py-[var(--spacing-m)]">
        {primaryNav.map((item) => {
          const itemClass =
            "flex items-center justify-between border-b border-black/40 py-[var(--spacing-s)] text-m font-normal transition-colors hover:text-secondary";
          return item.external ? (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              {item.label}
              <ChevronDownIcon className="size-[16px] -rotate-90" />
            </a>
          ) : (
            <Link key={item.label} href={item.href} onClick={() => setOpen(false)} className={itemClass}>
              {item.label}
              <ChevronDownIcon className="size-[16px] -rotate-90" />
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-[var(--spacing-m)] border-t border-black/10 px-[var(--gutter)] py-[var(--spacing-m)]">
        <Link
          href={headerCta.demo.href}
          onClick={() => setOpen(false)}
          className="inline-flex shrink-0 items-center justify-center rounded-pill border-3 border-secondary bg-secondary px-[var(--spacing-m)] py-[var(--spacing-xs)] text-s font-bold uppercase text-black transition-colors hover:bg-black hover:text-white"
        >
          {headerCta.demo.label}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`inline-flex size-9 cursor-pointer items-center justify-center transition-colors hover:text-secondary ${
          transparent ? "text-white" : "text-black"
        }`}
      >
        <MenuIcon className="size-[24px]" />
      </button>

      {mounted && createPortal(panel, document.body)}
    </div>
  );
}
