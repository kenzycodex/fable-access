import {
  ChartLineUp,
  Code,
  FileMagnifyingGlass,
  GearSix,
  List,
  Play,
  Robot,
  SquaresFour,
  Tray,
  UsersThree,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: Icon;
  match: (pathname: string) => boolean;
  external?: boolean;
  /** A live count shown beside the label. */
  badge?: "review";
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
      {
        href: "/dashboard/review",
        label: "Review queue",
        icon: Tray,
        badge: "review",
        match: (p) => p.startsWith("/dashboard/review") || p.startsWith("/dashboard/alerts"),
      },
      { href: "/dashboard/transactions", label: "Transactions", icon: List, match: (p) => p.startsWith("/dashboard/transactions") },
      { href: "/dashboard/customers", label: "Customers", icon: UsersThree, match: (p) => p.startsWith("/dashboard/customers") },
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
      {
        href: "/dashboard/compliance",
        label: "Compliance",
        icon: FileMagnifyingGlass,
        match: (p) => p.startsWith("/dashboard/compliance") || p.startsWith("/dashboard/report"),
      },
      { href: "/dashboard/settings", label: "Settings", icon: GearSix, match: (p) => p.startsWith("/dashboard/settings") },
    ],
  },
];

/** Every item in one list, for finding the current page's name. */
export const DASHBOARD_NAV: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((g) => g.items);

export const DASHBOARD_FOOTER_NAV: DashboardNavItem[] = [
  { href: "/demo", label: "Open the sandbox", icon: Play, match: (p) => p === "/demo", external: true },
  { href: "/docs", label: "API reference", icon: Code, match: (p) => p.startsWith("/docs"), external: true },
];
