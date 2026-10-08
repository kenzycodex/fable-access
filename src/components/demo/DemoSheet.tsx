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
        className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in-up"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="demo-shell animate-sheet relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-d-border bg-d-surface text-d-text shadow-2xl sm:max-w-[440px] sm:rounded-[28px]"
      >
        {/* Grab handle — mobile affordance only */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-d-border" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-d-text">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-d-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-d-faint transition-colors hover:bg-d-surface-2 hover:text-d-text"
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
