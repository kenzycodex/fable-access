"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowDown, Ghost, ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import { Card, EmptyState, Screen } from "@/components/demo/kit";
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

const STYLES: Record<string, { icon: React.ReactNode; badge: string }> = {
  containment: { icon: <Ghost size={20} weight="fill" />, badge: "bg-brand/12 text-brand" },
  block: { icon: <ShieldWarning size={20} weight="fill" />, badge: "bg-red-500/12 text-red-600 dark:text-red-400" },
  flag: { icon: <ShieldWarning size={20} weight="fill" />, badge: "bg-amber-500/14 text-amber-600 dark:text-amber-400" },
  credit: { icon: <ArrowDown size={20} />, badge: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
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
      <PageHeader title="Notifications" subtitle="What Fable has told you about your account" back />

      {items.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={<ShieldCheck size={24} weight="fill" />}
            title="Nothing needs your attention"
            body="You'll see a message here if Fable ever holds or questions a transfer."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-d-border">
            {items.map((n) => {
              const s = STYLES[n.kind] ?? STYLES.credit;
              const clickable = Boolean(n.reference);
              return (
                <li key={n.id}>
                  <div
                    onClick={clickable ? () => router.push(href(`/tx/${n.reference}`)) : undefined}
                    className={`flex items-start gap-4 p-5 ${clickable ? "cursor-pointer transition-colors hover:bg-d-surface-2" : ""}`}
                  >
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${s.badge}`}>{s.icon}</span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[14px] font-semibold text-d-text">{n.title}</span>
                      <span className="whitespace-pre-line text-[13px] leading-relaxed text-d-muted">{n.body}</span>
                      <span className="mt-1 flex items-center gap-2 text-[12px] font-medium text-d-faint">
                        {formatRelativeTime(parseTs(n.created_at))}
                        {n.channel !== "in_app" && (
                          <span className={n.delivered ? "text-emerald-500" : "text-amber-500"}>
                            · {n.delivered ? `sent by ${n.channel}` : `${n.channel} not delivered`}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Screen>
  );
}
