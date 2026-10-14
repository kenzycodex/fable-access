"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKey } from "@phosphor-icons/react";
import { AuthShell, authButton } from "@/components/dashboard/AuthShell";
import { useFableStore } from "@/lib/fable/store";

/**
 * `/demo`, the entry point the site's "See the sandbox" links use.
 *
 * The sandbox belongs to a bank and opens for that bank's signed-in team, so
 * this sends a signed-in member to their own bank's sandbox and asks anyone
 * else to sign in. It used to pick a bank from a public list of every
 * institution, which no longer exists.
 */
export default function DemoIndexPage() {
  const store = useFableStore();
  const router = useRouter();
  const institutionId = store?.session.loggedIn ? store.session.institutionId : null;

  useEffect(() => {
    if (institutionId) router.replace(`/demo/${encodeURIComponent(institutionId)}`);
  }, [institutionId, router]);

  if (store === null || institutionId) return <div className="min-h-dvh bg-black" />;

  return (
    <AuthShell title="Open the sandbox" description="The sandbox is your institution's test banking app. Sign in to the console to open it.">
      <div className="flex w-full flex-col items-center gap-6">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#7C3AED]/15 text-[#a78bfa] ring-1 ring-[#7C3AED]/30">
          <LockKey size={26} weight="duotone" />
        </span>
        <a href="/dashboard/login?next=/demo" className={authButton}>
          Sign in to the console
        </a>
      </div>
    </AuthShell>
  );
}
