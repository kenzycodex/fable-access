"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { SignOut, CaretUp, GearSix } from "@phosphor-icons/react";
import { DASHBOARD_NAV, DASHBOARD_FOOTER_NAV } from "@/components/dashboard/nav";
import { INSTITUTION } from "@/lib/fable/seed";
import { logout } from "@/lib/fable/store";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  function signOut() {
    logout();
  }

  return (
    <aside className="flex shrink-0 flex-col gap-6 border-gray-200 bg-white text-gray-900 dark:border-white/[0.04] dark:bg-black dark:text-white lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:border-r z-50 transition-colors duration-300">
      {/* Brand */}
      <div className="flex items-center justify-between px-6 pt-5 lg:pt-8">
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/images/brand/fable-logo-white.png"
            alt="Fable"
            className="h-7 w-auto hidden dark:block"
          />
          <img
            src="/images/brand/fable-logo.png"
            alt="Fable"
            className="h-7 w-auto block dark:hidden"
          />
        </Link>
        <span className="rounded-full bg-gray-100 border border-gray-200 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:bg-white/[0.04] dark:border-white/[0.05] dark:text-white/50">
          Console
        </span>
      </div>

      {/* Nav */}
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:pb-0 mt-4 custom-scrollbar">
        {DASHBOARD_NAV.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-[13px] font-semibold transition-all ${
                active 
                  ? "bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20 shadow-[inset_0_0_20px_rgba(124,58,237,0.05)]" 
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/[0.02] dark:hover:text-white/80 border border-transparent"
              }`}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Nav (Sandbox, API Docs) */}
      <nav className="hidden lg:flex shrink-0 flex-col gap-0.5 px-4 mt-auto mb-2">
        <div className="h-px w-full bg-gray-100 dark:bg-white/[0.04] mb-1.5" />
        {DASHBOARD_FOOTER_NAV.map((item) => {
          const Icon = item.icon;
          if (item.external) {
            return (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/[0.04] dark:hover:text-white/80"
              >
                <Icon size={16} weight="regular" />
                <span className="whitespace-nowrap">{item.label}</span>
              </a>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/[0.04] dark:hover:text-white/80"
            >
              <Icon size={16} weight="regular" />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Institution Profile Dropdown */}
      <div className="hidden shrink-0 px-4 pb-4 lg:block">
        <div className="relative w-full">
          {/* Dropdown Menu */}
          {isProfileOpen && (
            <div className="absolute bottom-[calc(100%+8px)] left-0 w-full rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#1a1a24] animate-card-entrance origin-bottom z-50">
              <div className="px-2.5 py-1.5 text-[10px] font-bold text-gray-400 dark:text-white/30 uppercase tracking-wider">Account</div>
              <Link 
                href="/dashboard/settings" 
                onClick={() => setIsProfileOpen(false)} 
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-white/80 dark:hover:bg-white/[0.04]"
              >
                <GearSix size={16} />
                Settings
              </Link>
              <div className="my-1 h-px w-full bg-gray-100 dark:bg-white/[0.04]" />
              <button 
                onClick={signOut} 
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <SignOut size={16} />
                Log out
              </button>
            </div>
          )}

          {/* Profile Button */}
          <button
            type="button"
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 transition-all bg-[#7C3AED] text-white dark:bg-[#a78bfa] dark:text-gray-900 hover:bg-gray-900 hover:text-white dark:hover:bg-white dark:hover:text-black group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/20 text-[11px] font-bold text-white dark:bg-black/10 dark:text-gray-900 shadow-sm transition-colors group-hover:bg-white/20 dark:group-hover:bg-black/10">
                {INSTITUTION.name.charAt(0)}
              </div>
              <div className="flex flex-col items-start min-w-0 transition-colors">
                <span className="text-[12px] font-bold truncate max-w-[120px]">{INSTITUTION.name}</span>
              </div>
            </div>
            <CaretUp size={14} weight="bold" className={`transition-transform ${isProfileOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
    </aside>
  );
}
