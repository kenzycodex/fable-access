"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { Branding } from "@/app/demo/[institution]/layout";
import { sandboxCustomers, SandboxUnavailable, type SandboxCustomer } from "@/lib/fable/api";
import {
  getTenant,
  restoreCustomer,
  setCustomer as setTenantCustomer,
  setInstitution,
  subscribeTenant,
} from "@/lib/fable/tenant";

/**
 * Whether the sandbox can show this bank's test customers.
 *
 * - `signed-out`: the sandbox needs a console sign-in to this bank.
 * - `other-bank`: signed in, but to a different bank.
 * - `live`: the bank is live, so the sandbox app is switched off.
 * - `empty`: signed in, but the bank has no test customers yet.
 */
export type RosterState = "loading" | "ready" | "empty" | "signed-out" | "other-bank" | "live" | "unavailable";

interface InstitutionContextValue {
  institutionId: string;
  name: string;
  /** "sandbox" or "live". */
  mode: string;
  customers: SandboxCustomer[];
  roster: RosterState;
  offline: boolean;
  /** The tenant's own logo, palette and tagline. */
  branding: Branding;
  /** Currently selected customer, or null before one is chosen. */
  customer: SandboxCustomer | null;
  selectCustomer: (c: SandboxCustomer) => void;
  /** Prefix every in-app link with the tenant, e.g. href("/transfer"). */
  href: (path?: string) => string;
}

const InstitutionContext = createContext<InstitutionContextValue | null>(null);

const NO_CUSTOMERS: SandboxCustomer[] = [];

export function InstitutionProvider({
  institutionId,
  name,
  mode,
  offline,
  branding,
  children,
}: {
  institutionId: string;
  name: string;
  mode: string;
  offline: boolean;
  branding: Branding;
  children: React.ReactNode;
}) {
  // Read straight from the tenant store, which the demo and the non-React API
  // layer share, instead of copying it into state from an effect.
  const customerId = useSyncExternalStore(
    subscribeTenant,
    () => getTenant().customerId,
    () => null,
  );
  const pathname = usePathname();
  const router = useRouter();

  // The test customers come from the API with the console session, so only
  // this bank's own team ever sees them. They used to come back from a public
  // endpoint to anyone who knew the bank's address.
  const { data, error, isLoading } = useSWR(
    mode === "live" || offline ? null : ["sandbox:customers", institutionId],
    sandboxCustomers,
    { revalidateOnFocus: true, shouldRetryOnError: false },
  );

  const roster: RosterState = useMemo(() => {
    if (mode === "live") return "live";
    if (offline) return "unavailable";
    if (error instanceof SandboxUnavailable) {
      if (error.status === 401 || error.status === 403) return "signed-out";
      if (error.status === 409) return "live";
      return "unavailable";
    }
    if (error) return "unavailable";
    if (isLoading || !data) return "loading";
    if (data.institution_id !== institutionId) return "other-bank";
    return data.customers.length ? "ready" : "empty";
  }, [mode, offline, error, isLoading, data, institutionId]);

  const customers = roster === "ready" && data ? data.customers : NO_CUSTOMERS;

  // The URL a bank chose in Settings, falling back to its id. Every in-app link
  // and the address bar use it, so renaming the URL actually changes what people
  // see. Links built from the id alone kept showing the old name after a rename.
  const urlSegment = branding.slug || institutionId;

  // Someone arriving on the old id-based address is moved to the bank's own URL.
  // Both keep working, so links already handed out do not break.
  useEffect(() => {
    if (urlSegment === institutionId) return;
    const current = pathname.split("/")[2];
    if (current === institutionId) {
      router.replace(`/demo/${urlSegment}${pathname.slice(`/demo/${current}`.length)}`);
    }
  }, [pathname, urlSegment, institutionId, router]);

  useEffect(() => {
    setInstitution(institutionId);
    restoreCustomer();
    // Default to the first test customer when none is selected, or when the
    // stored one is no longer on the bank's list.
    const stored = getTenant().customerId;
    if ((!stored || !customers.some((c) => c.user_id === stored)) && customers.length > 0) {
      setTenantCustomer(customers[0].user_id, customers[0].name, institutionId);
    }
  }, [institutionId, customers]);

  const value = useMemo<InstitutionContextValue>(() => {
    const customer = customers.find((c) => c.user_id === customerId) ?? null;
    return {
      institutionId,
      name,
      mode,
      customers,
      roster,
      offline,
      branding,
      customer,
      selectCustomer: (c) => setTenantCustomer(c.user_id, c.name, institutionId),
      href: (path = "") => `/demo/${urlSegment}${path}`,
    };
  }, [institutionId, name, mode, customers, roster, offline, branding, customerId, urlSegment]);

  return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>;
}

export function useInstitution(): InstitutionContextValue {
  const ctx = useContext(InstitutionContext);
  if (!ctx) {
    throw new Error("useInstitution must be used inside the /demo/[institution] layout");
  }
  return ctx;
}
