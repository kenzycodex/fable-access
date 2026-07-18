"use client";

import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import type { Signal } from "@/lib/fable/types";

/**
 * One detected Shield signal. Enters with a staggered slide-up (60ms * index
 * after the risk score settles).
 */
export function SignalCard({ signal, index }: { signal: Signal; index: number }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Start staggering after the ~800ms risk-score animation.
    const delay = 850 + index * 90;
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl bg-[#111] border border-white/[0.04] p-3 transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
        <WarningCircle size={16} weight="fill" />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-white">{signal.label}</span>
        <span className="text-[11px] text-white/40">{signal.detail}</span>
      </div>
    </div>
  );
}
