"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CaretUp, GearSix, SignOut, X } from "@phosphor-icons/react";
import { Avatar } from "@/components/app-kit";
import { DASHBOARD_FOOTER_NAV, DASHBOARD_NAV_GROUPS } from "@/components/dashboard/nav";
import { logout } from "@/lib/fable/store";
import { useBranding, useMe, useReviewCounts } from "@/lib/fable/useConsole";
import { useSignedInInstitution } from "@/lib/fable/useInstitution";

const ROLE_LABEL = { owner: "Owner", analyst: "Analyst", viewer: "Viewer", service: "API key" } as const;

/** Cases still waiting on someone, beside the Review queue link. */
function ReviewBadge({ active }: { active: boolean }) {
  const { data } = useReviewCounts();
  const n = data?.active ?? 0;
  if (!n) return null;
  return (
    <span
      className={`nav-badge ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-[11px] font-bold tabular-nums ${
        active ? "bg-white/25 text-white" : "bg-red-500 text-white"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * The console's left rail: grouped navigation, the links out to the demo bank and
 * the docs, and the signed-in institution at the foot with its menu above it.
 * On a phone it is a drawer, opened from the top bar.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] print:hidden flex-col border-r border-d-border bg-d-surface transition-[transform,width] duration-200 lg:z-40 lg:w-[var(--sidebar-w)] lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="nav-brand flex items-center justify-between px-6 pb-2 pt-6">
          <Link href="/" className="flex items-center" aria-label="Fable home">
            <span className="nav-wide-only flex items-center">
              <Image
                src="/images/brand/fable-logo-white.png"
                alt="Fable"
                width={1671}
                height={547}
                className="hidden h-7 w-auto dark:block"
              />
              <Image
                src="/images/brand/fable-logo.png"
                alt="Fable"
                width={1671}
                height={547}
                className="block h-7 w-auto dark:hidden"
              />
            </span>
            {/* The compact rail is too narrow for the wordmark, so it shows the shield alone. */}
            <Image
              src="/images/brand/fable-logo-icon.png"
              alt="Fable"
              width={1254}
              height={1254}
              className="nav-rail-only hidden size-10"
            />
          </Link>
          <span className="nav-wide-only rounded-full bg-brand/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand">
            Console
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-xl text-d-muted hover:bg-d-surface-2 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrolls on a short window; the account row below never does. */}
        <nav className="nav-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4 pt-6">
          {DASHBOARD_NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="nav-group-title mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-d-faint">{group.label}</p>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const active = item.match(pathname);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onClose}
                      title={item.label}
                      className={`nav-item relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                        active ? "bg-brand text-white shadow-sm" : "text-d-muted hover:bg-d-surface-2 hover:text-d-text"
                      }`}
                    >
                      <Icon size={19} weight={active ? "fill" : "regular"} />
                      <span className="nav-text">{item.label}</span>
                      {item.badge === "review" && <ReviewBadge active={active} />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-1 border-t border-d-border pt-4">
            {DASHBOARD_FOOTER_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.label}
                  className="nav-item flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-d-muted transition-colors hover:bg-d-surface-2 hover:text-d-text"
                >
                  <Icon size={17} />
                  <span className="nav-text">{item.label}</span>
                </a>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-d-border p-3">
          <AccountMenu />
        </div>
      </aside>
    </>
  );
}

function AccountMenu() {
  const { institution } = useSignedInInstitution();
  const { data: who } = useMe();
  const { data: branding } = useBranding();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = institution?.name ?? "Loading...";

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className="nav-menu absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-2xl border border-d-border bg-d-surface shadow-[0_18px_40px_-12px_rgba(0,0,0,0.25)]"
        >
          {who && (
            <div className="border-b border-d-border px-4 py-3">
              <p className="truncate text-[13px] font-semibold text-d-text">{who.name || who.email}</p>
              {who.name && <p className="truncate text-[12px] text-d-muted">{who.email}</p>}
              <p className="mt-1.5">
                <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {ROLE_LABEL[who.role]}
                </span>
              </p>
            </div>
          )}
          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex h-11 items-center gap-3 px-4 text-[14px] font-medium text-d-text transition-colors hover:bg-d-surface-2"
          >
            <GearSix size={18} className="text-d-muted" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => logout()}
            className="flex h-11 w-full items-center gap-3 border-t border-d-border px-4 text-left text-[14px] font-medium text-red-600 transition-colors hover:bg-red-500/[0.06] dark:text-red-400"
          >
            <SignOut size={18} />
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        className={`nav-item flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-d-surface-2 ${open ? "bg-d-surface-2" : ""}`}
      >
        {branding?.logo_url ? (
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-d-border bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URI from Branding settings */}
            <img src={branding.logo_url} alt={`${name} logo`} className="size-full object-contain" />
          </span>
        ) : (
          <Avatar name={name} size="sm" />
        )}
        <span className="nav-text min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-d-text">{name}</span>
          <span className="block truncate text-[11px] leading-tight text-d-muted">{who ? who.name || who.email : "Console"}</span>
        </span>
        <CaretUp size={14} className={`nav-wide-only shrink-0 text-d-faint transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
