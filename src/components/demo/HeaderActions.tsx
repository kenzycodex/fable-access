"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import useSWR from "swr";
import { Bell, Moon, Sun } from "@phosphor-icons/react";
import { CustomerSwitcher } from "@/components/demo/CustomerSwitcher";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PowerConnect } from "@/components/demo/PowerConnect";
import { IconButton } from "@/components/app-kit";
import { customerNotifications } from "@/lib/fable/api";

/**
 * The controls every screen shares: connection status, theme, notifications and
 * the customer menu. One component, so the header cannot drift between pages.
 */
export function HeaderActions() {
  const { href, customer } = useInstitution();
  const { resolvedTheme, setTheme } = useTheme();

  // Same key and fetcher as the notifications screen, so the two share a cache
  // and the badge always agrees with what that screen will show.
  const { data } = useSWR(
    customer ? ["demo:notifications", customer.user_id] : null,
    () => customerNotifications(customer!.user_id, 30),
    { refreshInterval: 10_000, keepPreviousData: true },
  );
  const unread = data?.unread ?? 0;

  return (
    <div className="flex items-center gap-2">
      <PowerConnect />
      {/* Both icons are rendered and CSS shows the right one, so there is no
          "mounted" state and no flash before the theme is known. */}
      <IconButton
        label="Toggle dark mode"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        <Sun size={18} className="hidden dark:block" />
        <Moon size={18} className="dark:hidden" />
      </IconButton>
      <Link
        href={href("/notifications")}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-muted transition-colors hover:text-d-text"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
      <CustomerSwitcher />
    </div>
  );
}
