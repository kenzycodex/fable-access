import {
  BellRinging,
  ChartLineUp,
  Code,
  FileMagnifyingGlass,
  GearSix,
  List,
  Play,
  Robot,
  SquaresFour,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: Icon;
  match: (pathname: string) => boolean;
  external?: boolean;
}

export interface DashboardNavGroup {
  label: string;
  items: DashboardNavItem[];
}

/** The console's navigation, grouped by what each page is for. */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: SquaresFour, match: (p) => p === "/dashboard" },
      { href: "/dashboard/transactions", label: "Transactions", icon: List, match: (p) => p.startsWith("/dashboard/transactions") },
      { href: "/dashboard/alerts", label: "Alerts", icon: BellRinging, match: (p) => p.startsWith("/dashboard/alerts") },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/dashboard/agents", label: "Agents", icon: Robot, match: (p) => p.startsWith("/dashboard/agents") },
      { href: "/dashboard/intelligence", label: "Insights", icon: ChartLineUp, match: (p) => p.startsWith("/dashboard/intelligence") },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/dashboard/compliance", label: "Compliance", icon: FileMagnifyingGlass, match: (p) => p.startsWith("/dashboard/compliance") },
      { href: "/dashboard/settings", label: "Settings", icon: GearSix, match: (p) => p.startsWith("/dashboard/settings") },
    ],
  },
];

/** Every item in one list, for finding the current page's name. */
export const DASHBOARD_NAV: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((g) => g.items);

export const DASHBOARD_FOOTER_NAV: DashboardNavItem[] = [
  { href: "/demo", label: "Open the demo bank", icon: Play, match: (p) => p === "/demo", external: true },
  { href: "/docs", label: "API reference", icon: Code, match: (p) => p.startsWith("/docs"), external: true },
];
