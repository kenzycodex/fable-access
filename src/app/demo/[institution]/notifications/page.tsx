"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowDown, Ghost, ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { customerNotifications, markNotificationsRead, type FableNotification } from "@/lib/fable/api";
import { formatRelativeTime } from "@/lib/fable/format";

/**
 * Notifications: what this customer was actually told.
 *
 * Two iterations of this screen were wrong in different ways. It began as two
 * hardcoded cards, one of which announced that Fable had "blocked a suspicious
 * login attempt from an unknown device in Lagos" — an event that never
 * happened, describing a capability the product does not have.
 *
 * Replacing that with a view derived from transaction history was closer, but
 * still wrong: it surfaced the seeded 90-day threat backfill as notifications,
 * so a brand-new customer opened the app to eleven alerts about blocked
 * transfers they had never made and were never told about. Seeded history
 * exists to give the console's charts something to draw.
 *
 * A notification is a record of something the customer was told, so it reads a
 * table of exactly that. The feed is empty on a fresh account and fills as
 * decisions are made, which is the honest behaviour.
 */

const STYLES: Record<string, { icon: React.ReactNode; wrap: string; badge: string }> = {
  containment: {
    icon: <Ghost size={20} weight="fill" />,
    wrap: "border bg-purple-50 border-purple-100 dark:bg-[var(--brand-primary)]/10 dark:border-[var(--brand-primary)]/20",
    badge: "bg-purple-100 text-purple-600 dark:bg-[var(--brand-primary)]/20 dark:text-[var(--brand-primary)]",
  },
  block: {
    icon: <ShieldWarning size={20} weight="fill" />,
    wrap: "border bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20",
    badge: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
  },
  flag: {
    icon: <ShieldWarning size={20} weight="fill" />,
    wrap: "border bg-amber-50 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20",
    badge: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
  },
  credit: {
    icon: <ArrowDown size={20} />,
    wrap: "",
    badge: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
};

function parseTs(iso: string): number {
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, which
  // Safari refuses outright and Chrome reads as local time.
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? Date.now() : t;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { customer, href } = useInstitution();

  const { data } = useSWR(
    customer ? ["demo:notifications", customer.user_id] : null,
    () => customerNotifications(customer!.user_id, 30),
    { refreshInterval: 10_000, keepPreviousData: true },
  );

  // Opening the screen is what marks them read; there is no separate action.
  useEffect(() => {
    if (customer && (data?.unread ?? 0) > 0) void markNotificationsRead(customer.user_id);
  }, [customer, data?.unread]);

  const items: FableNotification[] = data?.notifications ?? [];

  return (
    <Screen>
      <ScreenHeader title="Notifications" />

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <ShieldCheck size={24} weight="fill" />
          </span>
          <span className="text-[14px] font-semibold text-gray-900 dark:text-white">
            Nothing needs your attention
          </span>
          <span className="max-w-[260px] text-[13px] leading-relaxed text-gray-500 dark:text-white/45">
            You&rsquo;ll see a message here if Fable ever holds or questions a transfer.
          </span>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((n) => {
            const s = STYLES[n.kind] ?? STYLES.credit;
            const clickable = Boolean(n.reference);
            const Wrapper = s.wrap ? "div" : Card;
            return (
              <Wrapper
                key={n.id}
                onClick={clickable ? () => router.push(href(`/tx/${n.reference}`)) : undefined}
                className={`flex items-start gap-4 rounded-2xl p-4 ${s.wrap} ${
                  clickable ? "cursor-pointer transition-opacity hover:opacity-80" : ""
                }`}
              >
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${s.badge}`}>
                  {s.icon}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[14px] font-semibold text-gray-900 dark:text-white">{n.title}</span>
                  <span className="whitespace-pre-line text-[13px] leading-relaxed text-gray-600 dark:text-white/60">
                    {n.body}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] font-medium text-gray-400 dark:text-white/30">
                    {formatRelativeTime(parseTs(n.created_at))}
                    {n.channel !== "in_app" && (
                      <span className={n.delivered ? "text-emerald-500" : "text-amber-500"}>
                        · {n.delivered ? `sent by ${n.channel}` : `${n.channel} not delivered`}
                      </span>
                    )}
                  </span>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
