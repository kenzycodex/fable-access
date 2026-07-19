"use client";

import { useEffect } from "react";
import { X } from "@phosphor-icons/react";

/**
 * Responsive dialog: a bottom sheet on phones (thumb-reachable, the pattern
 * every banking app uses) and a centred modal from `sm` up. Locks body scroll,
 * closes on Escape and on backdrop click.
 */
export function DemoSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in-up"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-[#0b0b0b] sm:max-w-md sm:rounded-3xl"
      >
        {/* Grab handle — mobile affordance only */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-gray-300 dark:bg-white/15" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-gray-500 dark:text-white/40">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-white/30 dark:hover:bg-white/[0.06] dark:hover:text-white/70"
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
