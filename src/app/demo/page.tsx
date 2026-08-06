import { notFound, redirect } from "next/navigation";
import { API_BASE } from "@/lib/fable/api";

/** `/demo` is the un-scoped entry point that the marketing CTA points at.
 *
 * It used to redirect to a tenant id compiled into the bundle, which silently
 * broke the "See Live Demo" button the moment the deployment's institutions
 * changed: after re-provisioning it pointed at a bank that no longer existed.
 *
 * Resolution order, most explicit first:
 *
 *   1. `FABLE_DEMO_INSTITUTION` — read at request time (this is a server
 *      component, so it needs no NEXT_PUBLIC_ prefix and no rebuild to
 *      change). This is the setting to use in production: it is deterministic
 *      and does not depend on what the database happens to return first.
 *   2. The API's institution list — a sensible default for a single-tenant
 *      deployment, and for local development where nobody has configured
 *      anything.
 *   3. `notFound()` — better than redirecting into a 404 or an error page,
 *      because the failure is legible.
 *
 * The tenant route itself already resolves vanity slugs and 404s on unknown
 * institutions, so all this has to produce is a segment.
 */
export const dynamic = "force-dynamic";

async function resolveLandingInstitution(): Promise<string | null> {
  const configured = process.env.FABLE_DEMO_INSTITUTION?.trim();
  if (configured) return configured;

  try {
    const res = await fetch(`${API_BASE}/v1/institutions`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { institutions?: { institution_id: string }[] };
    const institutions = body.institutions ?? [];
    // Only auto-pick when there is no ambiguity. With several tenants the
    // "first" one is just whichever was created earliest, which is not a
    // decision this page should be making on the operator's behalf.
    return institutions.length === 1 ? institutions[0].institution_id : null;
  } catch {
    return null;
  }
}

export default async function DemoIndexPage() {
  const institution = await resolveLandingInstitution();
  if (!institution) notFound();
  redirect(`/demo/${institution}`);
}
