import {
  SquaresFour,
  List,
  BellRinging,
  ChartLineUp,
  FileMagnifyingGlass,
  GearSix,
  Robot,
  Icon,
} from "@phosphor-icons/react";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: typeof SquaresFour;
  match: (pathname: string) => boolean;
  external?: boolean;
}

export const DASHBOARD_NAV: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview", icon: SquaresFour, match: (p) => p === "/dashboard" },
  { href: "/dashboard/transactions", label: "Transactions", icon: List, match: (p) => p.startsWith("/dashboard/transactions") },
  { href: "/dashboard/agents", label: "Agents", icon: Robot, match: (p) => p.startsWith("/dashboard/agents") },
  { href: "/dashboard/alerts", label: "Watch Alerts", icon: BellRinging, match: (p) => p.startsWith("/dashboard/alerts") },
  { href: "/dashboard/intelligence", label: "Intelligence", icon: ChartLineUp, match: (p) => p.startsWith("/dashboard/intelligence") },
  { href: "/dashboard/compliance", label: "Compliance", icon: FileMagnifyingGlass, match: (p) => p.startsWith("/dashboard/compliance") },
  { href: "/dashboard/settings", label: "Settings", icon: GearSix, match: (p) => p.startsWith("/dashboard/settings") },
];

import { Play, Code } from "@phosphor-icons/react";

export const DASHBOARD_FOOTER_NAV: DashboardNavItem[] = [
  { href: "/demo", label: "Sandbox (Demo Bank)", icon: Play, match: (p) => p === "/demo", external: true },
  { href: "/docs", label: "API Reference", icon: Code, match: (p) => p.startsWith("/docs"), external: true },
];
