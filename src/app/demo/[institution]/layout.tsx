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
  const detail = await fetchInstitution(institution);

  // A genuinely unknown tenant 404s. This also catches stale links to the old
  // flat routes (/demo/transfer), which would otherwise be read as an
  // institution named "transfer".
  if (detail === null) notFound();

  const offline = detail === "offline";
  const resolved = offline
    ? { institution_id: institution, name: institution, type: "", customers: [] as DemoCustomer[] }
    : detail;

  return (
    <InstitutionProvider
      institutionId={resolved.institution_id}
      name={resolved.name}
      customers={resolved.customers}
      offline={offline}
    >
      <div
        data-surface="app"
        className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-[#111111] dark:text-white transition-colors duration-300"
      >
        <DemoSidebar />
        <main className="min-h-dvh pb-20 lg:pl-[220px] lg:pb-6">{children}</main>
        <DemoBottomNav />
      </div>
    </InstitutionProvider>
  );
}
