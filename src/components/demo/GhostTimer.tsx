"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/fable/format";

/**
 * Real-time cooling-window countdown. Ticks every second; the color shifts
 * cyan -> amber -> red as time runs out, with a progress bar depleting in sync.
 */
export function GhostTimer({
  expiresAt,
  windowSeconds,
  onExpire,
}: {
  expiresAt: number;
  windowSeconds: number;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, (expiresAt - Date.now()) / 1000));

  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.max(0, (expiresAt - Date.now()) / 1000);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 250);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  // cyan by default, amber under 5 minutes, red under 60 seconds.
  const color = remaining <= 60 ? "#ff3b5c" : remaining <= 300 ? "#ffb547" : "var(--brand-accent)";
  const pct = Math.max(0, Math.min(100, (remaining / windowSeconds) * 100));

  return (
    <div className="flex flex-col items-center gap-3">
      <span
        className="font-heading text-[52px] font-bold leading-none tabular-nums"
        style={{ color, fontVariantNumeric: "tabular-nums" }}
      >
        {formatCountdown(remaining)}
      </span>
      <div className="h-2 w-full overflow-hidden rounded-pill bg-white/10">
        <div className="h-full rounded-pill transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-white/40">Time remaining to cancel</span>
    </div>
  );
}
