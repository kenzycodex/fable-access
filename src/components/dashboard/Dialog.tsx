"use client";

import { useEffect, useId, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/app-kit";

/**
 * The console's dialog. Every confirmation and message goes through this, never
 * the browser's alert/confirm, which look foreign, can't be styled and block
 * the whole tab.
 *
 * A bottom sheet on phones and a centred card from `sm` up. Closes on Escape
 * and on a backdrop click, and locks page scroll while open. It renders inside
 * the console shell, so it picks up the console palette and theme.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === "sm" ? "sm:max-w-[400px]" : size === "lg" ? "sm:max-w-[640px]" : "sm:max-w-[500px]";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[#0b0718]/60 backdrop-blur-sm animate-fade-in-up"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-sheet relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[26px] border border-d-border bg-d-surface text-d-text shadow-[0_30px_80px_-20px_rgba(10,5,40,0.55)] sm:rounded-[24px] ${width}`}
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-d-border" />
        </div>
        <header className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-bold text-d-text">
              {title}
            </h2>
            {description && <div className="mt-1 text-[13px] leading-relaxed text-d-muted">{description}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-d-faint transition-colors hover:bg-d-surface-2 hover:text-d-text"
          >
            <X size={17} weight="bold" />
          </button>
        </header>
        {children && <div className="overflow-y-auto px-6 py-3">{children}</div>}
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-d-border px-6 py-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A yes/no question with a clear consequence. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = "primary",
  busy = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
