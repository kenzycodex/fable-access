export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
  tag?: string;
}

/** Flat top-level nav for Fable's MVP marketing site. */
export const primaryNav: NavLink[] = [
  { label: "Home", href: "/#home" },
  { label: "Why Fable", href: "/#why-fable" },
  { label: "Platform", href: "/#platform" },
  { label: "Pricing", href: "/#pricing" },
];

/** The dashboard login remains available for institution users. Marketing CTAs
 * use the sandbox destination below. */
export const dashboardCta = { label: "Dashboard", href: "/dashboard/login" };
export const demoCta = { label: "Open the Sandbox", href: "/demo" };

export const headerCta = {
  demo: demoCta,
};
