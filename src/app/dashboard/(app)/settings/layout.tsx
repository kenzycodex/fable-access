"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code, GearSix, Key, Palette, Sliders, UsersThree } from "@phosphor-icons/react";
import { PageHeader } from "@/components/dashboard/primitives";

const TABS = [
  { href: "/dashboard/settings", label: "General", icon: GearSix },
  { href: "/dashboard/settings/branding", label: "Branding", icon: Palette },
  { href: "/dashboard/settings/policy", label: "Risk policy", icon: Sliders },
  { href: "/dashboard/settings/team", label: "Team", icon: UsersThree },
  { href: "/dashboard/settings/developers", label: "API & webhooks", icon: Code },
  { href: "/dashboard/settings/security", label: "Security", icon: Key },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Settings" description="Your institution, its people, policy and integrations." />
      <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex min-w-full gap-1 rounded-2xl border border-d-border bg-d-surface p-1.5 sm:min-w-0">
          {TABS.map((t) => {
            const active = t.href === "/dashboard/settings" ? pathname === t.href : pathname.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors ${
                  active ? "bg-brand text-white shadow-sm" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
                }`}
              >
                <Icon size={16} weight={active ? "fill" : "regular"} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}
