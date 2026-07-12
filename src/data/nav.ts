export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
  tag?: string;
}

/** Flat top-level nav for Fable's MVP marketing site. */
export const primaryNav: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Why Fable", href: "/why-fable" },
  { label: "Platform", href: "/platform" },
  { label: "Pricing", href: "/pricing" },
  { label: "API Docs", href: "http://localhost:8000/docs", external: true },
];

/** Every CTA sitewide funnels into exactly one of two destinations: the
 * institution dashboard (log in, get access) or the interactive demo bank
 * (try the product yourself). Both are built inside this same app as
 * routes, not external subdomains, so these are internal paths. They
 * 404 until /dashboard and /demo are actually built, same as any other
 * route that hasn't shipped yet. */
export const dashboardCta = { label: "Dashboard", href: "/dashboard/login" };
export const demoCta = { label: "See Live Demo", href: "/demo" };

export const headerCta = {
  demo: dashboardCta,
};
