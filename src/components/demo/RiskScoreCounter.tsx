"use client";

import { useEffect, useRef, useState } from "react";
import type { RiskAction } from "@/lib/fable/types";

/**
 * The money shot: a risk score that counts up from 0 to its final value over
 * ~800ms, with a progress bar filling in sync.
 */
export function RiskScoreCounter({ score, action }: { score: number; action: RiskAction }) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  
  const colors = {
    BLOCK: { text: "text-red-400", hex: "#f87171", chip: "bg-red-500/10 text-red-400 border border-red-500/20", label: "High risk" },
    FLAG: { text: "text-amber-400", hex: "#fbbf24", chip: "bg-amber-500/10 text-amber-400 border border-amber-500/20", label: "Medium risk" },
    PASS: { text: "text-emerald-400", hex: "#34d399", chip: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20", label: "Low risk" },
  };
  
  const active = colors[action] ?? colors.PASS;

  useEffect(() => {
    const duration = 800;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(score * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // requestAnimationFrame is paused while the tab is backgrounded, which
    // could otherwise strand the counter at 0.00 next to a "HIGH RISK" label.
    // A timer still fires (throttled) in the background, so it guarantees the
    // final value regardless of animation state.
    const failsafe = setTimeout(() => setValue(score), duration + 150);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(failsafe);
    };
  }, [score]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/35">Risk score</span>
        <span className={`text-[40px] font-bold leading-none tabular-nums ${active.text}`}>
          {value.toFixed(2)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#111]">
        <div
          className="h-full rounded-full transition-none"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: active.hex }}
        />
      </div>
      <div>
        <span className={`inline-flex rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider ${active.chip}`}>
          {active.label}
        </span>
      </div>
    </div>
  );
}
