"use client";

/**
 * The signed-in institution, from the API.
 *
 * The console rendered a hardcoded constant for this: the sidebar, the
 * dashboard greeting and the whole Settings profile card all showed one
 * fictional bank no matter who was signed in. It kept showing that bank after
 * the institution had been deleted from the database, which is how a console
 * can look completely healthy while displaying nothing real.
 *
 * `institutionId` comes from the login response, so this follows whoever is
 * actually signed in. While it loads, callers get null rather than a
 * placeholder name, because a wrong name rendered confidently is worse than a
 * brief empty state.
 */
import { useMemo } from "react";
import useSWR from "swr";
import { institutionProfile, type InstitutionProfile } from "./api";
import { useFableStore } from "./store";

export function useSignedInInstitution(): {
  institution: InstitutionProfile | null;
  institutionId: string | null;
  loading: boolean;
} {
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;

  const { data, isLoading } = useSWR(
    institutionId ? ["institution:profile", institutionId] : null,
    () => institutionProfile(institutionId!),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return { institution: data ?? null, institutionId, loading: Boolean(institutionId) && isLoading };
}

/**
 * Turn an internal customer id into the customer's name.
 *
 * Ids like `union_bank_chioma` are keys: they are built from the institution's
 * name when it is provisioned and never change, because every transaction, hold
 * and API key hangs off them. They are meant for machines. The console shows the
 * customer's name instead, and falls back to the id for anyone not on the roster.
 */
export function useCustomerNames(): (userId: string | null | undefined) => string {
  const { institution } = useSignedInInstitution();
  const names = useMemo(
    () => new Map((institution?.customers ?? []).map((c) => [c.user_id, c.name])),
    [institution],
  );
  return (userId) => (userId ? (names.get(userId) ?? userId) : "-");
}
