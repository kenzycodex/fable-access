"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { DemoCustomer } from "@/app/demo/[institution]/layout";
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
  children,
}: {
  institutionId: string;
  name: string;
  customers: DemoCustomer[];
  offline: boolean;
  children: React.ReactNode;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);

  useEffect(() => {
    setInstitution(institutionId);
    restoreCustomer();
    setCustomerId(getTenant().customerId);
    return subscribeTenant(() => setCustomerId(getTenant().customerId));
  }, [institutionId]);

  const value = useMemo<InstitutionContextValue>(() => {
    const customer = customers.find((c) => c.user_id === customerId) ?? null;
    return {
      institutionId,
      name,
      customers,
      offline,
      customer,
      selectCustomer: (c) => setTenantCustomer(c.user_id, c.name, institutionId),
      href: (path = "") => `/demo/${institutionId}${path}`,
    };
  }, [institutionId, name, customers, offline, customerId]);

  return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>;
}

export function useInstitution(): InstitutionContextValue {
  const ctx = useContext(InstitutionContext);
  if (!ctx) {
    throw new Error("useInstitution must be used inside the /demo/[institution] layout");
  }
  return ctx;
}
