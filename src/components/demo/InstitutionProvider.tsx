"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Branding, DemoCustomer } from "@/app/demo/[institution]/layout";
import {
  getTenant,
  restoreCustomer,
  setCustomer as setTenantCustomer,
  setInstitution,
  subscribeTenant,
} from "@/lib/fable/tenant";

interface InstitutionContextValue {
  institutionId: string;
  name: string;
  customers: DemoCustomer[];
  offline: boolean;
  /** The tenant's own logo, palette and tagline. */
  branding: Branding;
  /** Currently selected customer, or null before one is chosen. */
  customer: DemoCustomer | null;
  selectCustomer: (c: DemoCustomer) => void;
  /** Prefix every in-app link with the tenant, e.g. href("/transfer"). */
  href: (path?: string) => string;
}

const InstitutionContext = createContext<InstitutionContextValue | null>(null);

export function InstitutionProvider({
  institutionId,
  name,
  customers,
  offline,
  branding,
  children,
}: {
  institutionId: string;
  name: string;
  customers: DemoCustomer[];
  offline: boolean;
  branding: Branding;
  children: React.ReactNode;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);

  useEffect(() => {
    setInstitution(institutionId);
    restoreCustomer();
    // Default to the first customer when none is selected. Selection lives in
    // sessionStorage, so a fresh session (or landing straight on /transfer
    // rather than the home screen) would otherwise leave `customer` null —
    // which surfaced as an empty user id in the verification dialog, e.g.
    // GET /v1/accounts//security. Every screen now resolves a real customer.
    let cid = getTenant().customerId;
    if (!cid && customers.length > 0) {
      setTenantCustomer(customers[0].user_id, customers[0].name, institutionId);
      cid = customers[0].user_id;
    }
    setCustomerId(cid);
    return subscribeTenant(() => setCustomerId(getTenant().customerId));
  }, [institutionId, customers]);

  const value = useMemo<InstitutionContextValue>(() => {
    const customer = customers.find((c) => c.user_id === customerId) ?? null;
    return {
      institutionId,
      name,
      customers,
      offline,
      branding,
      customer,
      selectCustomer: (c) => setTenantCustomer(c.user_id, c.name, institutionId),
      href: (path = "") => `/demo/${institutionId}${path}`,
    };
  }, [institutionId, name, customers, offline, branding, customerId]);

  return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>;
}

export function useInstitution(): InstitutionContextValue {
  const ctx = useContext(InstitutionContext);
  if (!ctx) {
    throw new Error("useInstitution must be used inside the /demo/[institution] layout");
  }
  return ctx;
}
