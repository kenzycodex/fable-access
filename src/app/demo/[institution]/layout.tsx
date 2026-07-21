import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoBottomNav, DemoSidebar } from "@/components/demo/DemoNav";
import { InstitutionProvider } from "@/components/demo/InstitutionProvider";
import { API_BASE } from "@/lib/fable/api";

export const metadata: Metadata = {
  title: "Demo Bank",
  description: "A working demo of Fable protecting a live transfer, end to end.",
};

export interface DemoCustomer {
  user_id: string;
  key: string;
  name: string;
  persona: string;
  description: string;
  typical_range: string;
  /** Starting float; the home screen derives the live balance from it. */
  opening_balance: number;
  city: string;
}

interface InstitutionDetail {
  institution_id: string;
  name: string;
  type: string;
  customers: DemoCustomer[];
}

export interface Branding {
  display_name: string | null;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  slug: string;
  tagline: string | null;
}

const DEFAULT_BRANDING: Branding = {
  display_name: null,
  logo_url: null,
  primary_color: "var(--brand-primary)",
  accent_color: "#00D4FF",
  slug: "",
  tagline: null,
};

/** A tenant that never customised anything still renders, so failures here
 * fall back to Fable's palette rather than blocking the page. */
async function fetchBranding(id: string): Promise<Branding> {
  try {
    const res = await fetch(`${API_BASE}/v1/branding/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_BRANDING;
    return (await res.json()) as Branding;
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Map whatever is in the URL to an institution_id.
 *
 * The segment may be a vanity slug a bank chose in settings, or the raw
 * institution_id. Resolving the slug first means a renamed tenant's new URL
 * works, and the original id keeps working too — so links already handed out
 * don't break the moment someone customises their URL.
 */
async function resolveSegment(segment: string): Promise<string | null | "offline"> {
  try {
    const res = await fetch(`${API_BASE}/v1/branding/resolve/${encodeURIComponent(segment)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return "offline";
    const body = (await res.json()) as { institution_id: string };
    return body.institution_id;
  } catch {
    return "offline";
  }
}

/** Look the tenant up in the Fable API. Returns null when the API is down so
 * the demo still renders (offline) rather than 404-ing on a transient outage. */
async function fetchInstitution(id: string): Promise<InstitutionDetail | null | "offline"> {
  try {
    const res = await fetch(`${API_BASE}/v1/institutions/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return "offline";
    return (await res.json()) as InstitutionDetail;
  } catch {
    return "offline";
  }
}

export default async function DemoInstitutionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ institution: string }>;
}) {
  const { institution } = await params;

  const resolvedId = await resolveSegment(institution);
  if (resolvedId === null) notFound();
  const institutionId = resolvedId === "offline" ? institution : resolvedId;

  const detail = await fetchInstitution(institutionId);

  // A genuinely unknown tenant 404s. This also catches stale links to the old
  // flat routes (/demo/transfer), which would otherwise be read as an
  // institution named "transfer".
  if (detail === null) notFound();

  const offline = detail === "offline";
  const resolved = offline
    ? { institution_id: institutionId, name: institutionId, type: "", customers: [] as DemoCustomer[] }
    : detail;

  const branding = await fetchBranding(resolved.institution_id);
  // The bank's own name wins over the registry name when it has set one.
  const displayName = branding.display_name || resolved.name;

  return (
    <InstitutionProvider
      institutionId={resolved.institution_id}
      name={displayName}
      customers={resolved.customers}
      offline={offline}
      branding={branding}
    >
      {/* The tenant's palette is injected as CSS variables on the demo shell,
          so every surface inside picks it up without prop-drilling colour. */}
      <div
        data-surface="app"
        style={
          {
            "--brand-primary": branding.primary_color,
            "--brand-accent": branding.accent_color,
          } as React.CSSProperties
        }
        className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-[#111111] dark:text-white transition-colors duration-300"
      >
        <DemoSidebar />
        <main className="min-h-dvh pb-20 lg:pl-[220px] lg:pb-6">{children}</main>
        <DemoBottomNav />
      </div>
    </InstitutionProvider>
  );
}
