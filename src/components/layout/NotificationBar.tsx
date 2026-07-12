"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCloseIcon } from "@/components/icons";

const STORAGE_KEY = "fable-notification-dismissed";

export function NotificationBar() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  if (dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="relative flex items-center justify-center bg-accent px-[calc(var(--gutter)+2rem)] py-2.5 text-center text-s font-bold leading-none text-black">
      <Link href="/index-report-q2-2026" className="hover:underline">
        NEW REPORT: THE FRAUD ECONOMY SCALES UP
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="absolute right-[var(--gutter)] top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center opacity-70 transition-opacity hover:opacity-100"
      >
        <CircleCloseIcon className="size-[18px]" />
      </button>
    </div>
  );
}
