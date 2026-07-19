"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, ClockCounterClockwise, PaperPlaneTilt, ShieldCheck, ArrowLeft } from "@phosphor-icons/react";
import { useInstitution } from "@/components/demo/InstitutionProvider";

// Paths are relative to the institution root; the provider's href() prefixes
// them with /demo/{institution}.
const NAV = [
  { path: "", label: "Home", icon: House },
  { path: "/history", label: "Activity", icon: ClockCounterClockwise },
  { path: "/transfer", label: "Transfer", icon: PaperPlaneTilt },
  { path: "/transparency", label: "Security", icon: ShieldCheck },
];

function useNavItems() {
  const { href } = useInstitution();
  const pathname = usePathname();
  return NAV.map((item) => {
    const target = href(item.path);
    return {
      ...item,
      href: target,
      active: item.path === "" ? pathname === target : pathname.startsWith(target),
    };
  });
}

export function DemoSidebar() {
  const { name, href } = useInstitution();
  const items = useNavItems();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col justify-between border-r border-gray-200 dark:border-white/[0.06] bg-white dark:bg-black px-4 py-6 lg:flex transition-colors duration-300">
      <div className="flex flex-col gap-8">
        <Link href={href()} className="flex items-center gap-3 px-2 mb-2">
          <div className="relative flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#4c1d95] shadow-lg shadow-[#7C3AED]/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 12l10 10 10-10L12 2z" fill="currentColor" className="text-white/20"/>
              <path d="M12 6L6 12l6 6 6-6-6-6z" fill="currentColor" className="text-white"/>
            </svg>
          </div>
          <span className="truncate text-[18px] font-bold tracking-tight text-gray-900 dark:text-white">{name}</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  item.active ? "bg-[#7C3AED] text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/[0.04] dark:hover:text-white/70"
                }`}
              >
                <Icon size={18} weight={item.active ? "fill" : "regular"} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col gap-2 px-2 pb-1">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/[0.04] dark:hover:text-white/80"
        >
          <ArrowLeft size={18} weight="bold" />
          Exit
        </Link>
        <p className="px-3 text-[10px] text-gray-400 dark:text-white/15">{name} · Demo</p>
      </div>
    </aside>
  );
}

export function DemoBottomNav() {
  const items = useNavItems();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="flex items-center justify-around border-t border-gray-200 dark:border-white/[0.06] bg-white/95 dark:bg-black/95 px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl transition-colors duration-300">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors ${
                item.active ? "text-[#7C3AED]" : "text-gray-400 dark:text-white/30"
              }`}
            >
              <Icon size={22} weight={item.active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
