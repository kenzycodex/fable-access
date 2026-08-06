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
