"use client";

import { useEffect, useState } from "react";
import { AskFable } from "@/components/dashboard/AskFable";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { useFableStore } from "@/lib/fable/store";

/**
 * The authenticated console shell: a left rail, a top bar and the page.
 *
 * It guards every screen. Without a signed-in session it goes to the login page.
 */
export default function DashboardAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const store = useFableStore();
  const [menuOpen, setMenuOpen] = useState(false);

  // Backstop for arriving here without a session (expired token, direct URL,
  // a tab left open overnight). logout() navigates by itself, so this normally
  // does not fire on the sign-out path.
  //
  // Hard navigation for the same reason logout() uses one: the router cache can
  // still hold the authed RSC payload for this tree, and a client-side replace
  // out of a layout that is mid-render is exactly where that stalls.
  useEffect(() => {
    if (store !== null && !store.session.loggedIn && typeof window !== "undefined") {
      window.location.replace("/dashboard/login");
    }
  }, [store]);

  // While hydrating, or when not logged in (about to redirect), show a minimal
  // splash so we never flash authed content.
  if (store === null || !store.session.loggedIn) {
    return (
      <div className="console-shell flex min-h-dvh flex-col items-center justify-center bg-d-bg text-[13px] text-d-muted">
        <div className="flex flex-col items-center gap-4">
          <svg className="size-8 animate-spin text-brand" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="animate-pulse font-medium">Starting console...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="console-shell min-h-dvh bg-d-bg text-d-text transition-colors duration-300">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-[272px] print:!pl-0">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>
      <div className="print:hidden">
        <AskFable />
      </div>
    </div>
  );
}
