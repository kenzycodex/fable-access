"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AskFable } from "@/components/dashboard/AskFable";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useFableStore } from "@/lib/fable/store";

/**
 * Authenticated dashboard shell: dark left sidebar + light content canvas.
 * Guards every screen, if the seeded institution isn't signed in, it bounces
 * to /dashboard/login. Desktop-first; the sidebar becomes a top strip on mobile.
 */
export default function DashboardAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const store = useFableStore();

  useEffect(() => {
    if (store !== null && !store.session.loggedIn) router.replace("/dashboard/login");
  }, [store, router]);

  // While hydrating, or when not logged in (about to redirect), show a minimal
  // splash so we never flash authed content.
  if (store === null || !store.session.loggedIn) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gray-50 dark:bg-black text-[13px] text-gray-500 dark:text-white/50">
        <div className="flex flex-col items-center gap-4">
          <svg className="size-8 animate-spin text-[#7C3AED]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="animate-pulse font-medium">Starting console...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-gray-50 text-gray-900 dark:bg-black dark:text-white lg:flex-row font-sans overflow-hidden transition-colors duration-300">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 lg:px-8 lg:py-8">{children}</div>
      </main>
      <AskFable />
    </div>
  );
}
