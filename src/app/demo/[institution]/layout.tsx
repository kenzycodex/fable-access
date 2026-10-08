import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoShell } from "@/components/demo/DemoNav";
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

/** The dark-mode background when a bank has not chosen an accent colour. */
const DEFAULT_ACCENT = "#0B0D12";

/**
 * The demo's dark-mode background, taken from the bank's accent colour.
 *
 * Used as the accent comes, except that its lightness is capped. A bright accent
 * (a cyan, a yellow, a white) would make a background nobody can read light text
 * on, so it is darkened to the same hue and kept deep. A dark accent, such as
 * #262626, is used exactly as chosen. Anything that is not a six-digit hex falls
 * back to the deep default.
 */
function darkBackgroundFor(accent: string | null | undefined): string {
  const MAX_LIGHTNESS = 0.16;
  const match = /^#?([0-9a-f]{6})$/i.exec((accent ?? "").trim());
  if (!match) return DEFAULT_ACCENT;

  const n = parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  l = Math.min(l, MAX_LIGHTNESS);
  s = Math.min(s, 0.7);

  // HSL back to hex.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
}

const DEFAULT_BRANDING: Branding = {
  display_name: null,
  logo_url: null,
  primary_color: "#7C3AED",
  accent_color: DEFAULT_ACCENT,
  slug: "",
  tagline: null,
};

/** A tenant that never customised anything still renders, so failures here
 * fall back to Fable's palette rather than blocking the page. */
async function fetchBranding(id: string): Promise<Branding> {
  try {
    // Not cached. Branding is configuration an operator edits and then
    // immediately reloads the demo to check, so a 120-second revalidate made a
    // successful save look like a failed one for two minutes. It is one small
    // row fetched alongside a page that is dynamic anyway.
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
    // Not cached: this carries the customer roster, so a re-provisioned tenant
    // otherwise showed its previous customers for two minutes.
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

  // Institution detail and branding both key on the resolved id and don't
  // depend on each other, so fetch them together rather than one after the
  // other — halving the round-trips the layout waits on.
  const [detail, branding] = await Promise.all([
    fetchInstitution(institutionId),
    fetchBranding(institutionId),
  ]);

  // A genuinely unknown tenant 404s. This also catches stale links to the old
  // flat routes (/demo/transfer), which would otherwise be read as an
  // institution named "transfer".
  if (detail === null) notFound();

  const offline = detail === "offline";
  const resolved = offline
    ? { institution_id: institutionId, name: institutionId, type: "", customers: [] as DemoCustomer[] }
    : detail;
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
            // Read by the dark theme in globals.css as the page background.
            "--d-bg-dark": darkBackgroundFor(branding.accent_color),
          } as React.CSSProperties
        }
        className="demo-shell min-h-dvh bg-d-bg text-d-text transition-colors duration-300"
      >
        <DemoShell>{children}</DemoShell>
      </div>
    </InstitutionProvider>
  );
}
