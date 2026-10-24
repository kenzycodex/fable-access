"use client";

import { useEffect, useState } from "react";
import { Flask } from "@phosphor-icons/react";
import { sandboxInbox } from "@/lib/fable/api";

/**
 * The sandbox inbox: the one-time code a sandbox bank's test customer would
 * have received by email or SMS, shown in the demo app so testing never
 * depends on a real inbox.
 *
 * The server only keeps an inbox for sandbox institutions and refuses the
 * endpoint for live ones, so this box can never show a live customer's code.
 * It renders nothing when there is no code to show.
 */
export function SandboxCode({ userId, since }: { userId: string; since: number }) {
  const [code, setCode] = useState<{ code: string; channel: string; destination: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { items } = await sandboxInbox(userId);
        // The newest code written after this flow asked for one.
        const hit = items.find((i) => i.kind === "code" && i.code && Date.parse(`${i.created_at.replace(" ", "T")}Z`) >= since - 5_000);
        if (alive && hit?.code) setCode({ code: hit.code, channel: hit.channel ?? "email", destination: hit.destination });
      } catch {
        // A live institution, or the API is unreachable: show nothing.
      }
    }
    void load();
    const timer = setInterval(load, 2_500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId, since]);

  if (!code) return null;
  return (
    <div role="status" className="rounded-xl border border-dashed border-amber-500/60 bg-amber-500/10 px-4 py-3 text-[12px] text-d-muted">
      <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
        <Flask size={14} weight="bold" /> Sandbox code
      </p>
      <p className="mt-1">
        This is a sandbox bank, so the code that would go {code.channel === "sms" ? "by SMS" : "by email"}
        {code.destination ? ` to ${code.destination}` : ""} is shown here:{" "}
        <span className="font-mono text-[15px] font-bold tracking-widest text-d-text">{code.code}</span>
      </p>
      <p className="mt-1 text-[11px] text-d-faint">A live bank sends it only to the customer&apos;s own email or phone.</p>
    </div>
  );
}
