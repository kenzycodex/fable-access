"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/fable/format";

/**
 * The cooling-window countdown. Ticks every quarter second; the colour moves
 * from the brand colour to amber to red as time runs out, with a bar depleting
 * in step.
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

  const color = remaining <= 60 ? "#ef4444" : remaining <= 300 ? "#f59e0b" : "var(--brand-primary, #7c3aed)";
  const pct = Math.max(0, Math.min(100, (remaining / windowSeconds) * 100));

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-[56px] font-bold leading-none tabular-nums" style={{ color }}>
        {formatCountdown(remaining)}
      </span>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-d-surface-2">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[12px] text-d-muted">Time left to cancel</span>
    </div>
  );
}
