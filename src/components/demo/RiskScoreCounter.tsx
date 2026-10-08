"use client";

import { useEffect, useRef, useState } from "react";
import type { RiskAction } from "@/lib/fable/types";

const TONES: Record<RiskAction, { text: string; bar: string; chip: string; label: string }> = {
  BLOCK: { text: "text-red-500", bar: "#ef4444", chip: "bg-red-500/12 text-red-600 dark:text-red-400", label: "High risk" },
  FLAG: { text: "text-amber-500", bar: "#f59e0b", chip: "bg-amber-500/14 text-amber-600 dark:text-amber-400", label: "Medium risk" },
  PASS: { text: "text-emerald-500", bar: "#10b981", chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", label: "Low risk" },
};

/**
 * A risk score that counts up from 0 to its final value over about 800ms, with
 * a bar filling in step. The motion is what makes a fast decision register.
 */
export function RiskScoreCounter({ score, action }: { score: number; action: RiskAction }) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const tone = TONES[action] ?? TONES.PASS;

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
    // requestAnimationFrame pauses in a background tab, which could strand the
    // counter at 0.00 beside a "High risk" label. A timer still fires, throttled,
    // so it guarantees the final value whatever the animation state.
    const failsafe = setTimeout(() => setValue(score), duration + 150);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(failsafe);
    };
  }, [score]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">Risk score</p>
          <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.chip}`}>
            {tone.label}
          </span>
        </div>
        <span className={`text-[44px] font-bold leading-none tabular-nums ${tone.text}`}>{value.toFixed(2)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-d-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: tone.bar }}
        />
      </div>
    </div>
  );
}
