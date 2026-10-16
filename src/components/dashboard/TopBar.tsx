"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { List, Moon, Sun } from "@phosphor-icons/react";
import { IconButton } from "@/components/app-kit";
import { DASHBOARD_NAV } from "@/components/dashboard/nav";
import { useApiStatus } from "@/lib/fable/useBackend";

/** Whether the console is talking to the real API, or running on its fallback. */
function ApiStatus() {
  const status = useApiStatus();
  const live = status === "api";
  const checking = status === "checking";

  return (
    <span
      className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-[12px] font-semibold ${
        checking
          ? "border-d-border bg-d-surface text-d-muted"
          : live
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}
      title={
        live
          ? "Connected to the Fable API: real Shield scoring and persistence"
          : checking
            ? "Checking the connection to the Fable API"
            : "The Fable API can't be reached, so console data can't load and no transfers are scored"
      }
    >
      <span className={`size-2 rounded-full ${checking ? "bg-d-faint" : live ? "bg-emerald-500" : "bg-amber-500"}`} />
      <span className="hidden sm:inline">{checking ? "Checking" : live ? "Fable API live" : "API offline"}</span>
    </span>
  );
}

/** The strip along the top of every console page. */
export function TopBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const current = DASHBOARD_NAV.find((i) => i.match(pathname))?.label ?? "Console";

  return (
    <div className="sticky top-0 z-30 flex print:hidden items-center justify-between gap-3 border-b border-d-border bg-d-bg/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <IconButton label="Open menu" onClick={onMenu} className="lg:hidden">
          <List size={18} />
        </IconButton>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex">
          <span className="text-d-faint">Console</span>
          <span className="text-d-faint">/</span>
          <span className="truncate font-semibold text-d-text">{current}</span>
        </nav>
        <span className="truncate text-[15px] font-bold text-d-text lg:hidden">{current}</span>
      </div>

      <div className="flex items-center gap-2">
        <ApiStatus />
        {/* Both icons are rendered and CSS shows the right one, so there is no
            flash before the theme is known. */}
        <IconButton label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <Sun size={18} className="hidden dark:block" />
          <Moon size={18} className="dark:hidden" />
        </IconButton>
      </div>
    </div>
  );
}
