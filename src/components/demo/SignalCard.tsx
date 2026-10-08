"use client";

import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import type { Signal } from "@/lib/fable/types";

/**
 * One detected Shield signal. Enters with a staggered slide-up, starting after
 * the risk score has settled.
 */
export function SignalCard({ signal, index }: { signal: Signal; index: number }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 850 + index * 90);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl bg-d-surface-2 p-3.5 transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/14 text-amber-500">
        <WarningCircle size={18} weight="fill" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-d-text">{signal.label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-d-muted">{signal.detail}</p>
      </div>
    </div>
  );
}
