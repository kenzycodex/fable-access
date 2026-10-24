"use client";

import { useInstitution } from "@/components/demo/InstitutionProvider";
import { groupDigits } from "@/lib/fable/format";

/**
 * The customer's debit card, drawn in the institution's own colour.
 *
 * The number, expiry and holder are derived from the customer (see `cardFor`),
 * so a given customer always sees the same card. It is a demo card: there is no
 * card network behind it, and no CVV is shown because none exists.
 */
export function BankCard({
  holder,
  number,
  expiry,
  reveal = false,
  className = "",
}: {
  holder: string;
  number: string;
  expiry: string;
  reveal?: boolean;
  className?: string;
}) {
  const { name, branding } = useInstitution();
  const shown = reveal ? groupDigits(number) : `•••• •••• •••• ${number.slice(-4)}`;

  return (
    <div
      className={`relative aspect-[1.586/1] w-full overflow-hidden rounded-[22px] p-5 text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)] sm:p-6 ${className}`}
      style={{
        background:
          "linear-gradient(135deg, var(--brand-primary, #7c3aed) 0%, color-mix(in srgb, var(--brand-primary, #7c3aed) 55%, #000) 100%)",
      }}
    >
      {/* Soft shapes give the surface depth without a photo or pattern asset. */}
      <div className="pointer-events-none absolute -right-10 -top-12 size-44 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 size-40 rounded-full bg-black/10" />
      <div className="pointer-events-none absolute right-10 top-16 size-24 rounded-full bg-white/[0.06]" />

      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {branding.logo_url ? (
              <span
                className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--brand-primary, #7c3aed)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
                <img src={branding.logo_url} alt="" className="size-full object-contain" />
              </span>
            ) : null}
            <span className="truncate text-[15px] font-bold tracking-tight">{name}</span>
          </div>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Debit</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Chip */}
          <svg width="36" height="28" viewBox="0 0 36 28" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="35" height="27" rx="5" fill="rgba(255,255,255,0.28)" stroke="rgba(255,255,255,0.45)" />
            <path d="M0 10h36M0 18h36M13 0v28M23 0v28" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          </svg>
          {/* Contactless */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="opacity-80">
            <path d="M8 6.5a8 8 0 0 1 0 11M12 4a12 12 0 0 1 0 16M16 1.5a16 16 0 0 1 0 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <div>
          <p className="font-mono text-[15px] tracking-[0.14em] sm:text-[17px]">{shown}</p>
          <div className="mt-2.5 flex items-end justify-between gap-3 text-[11px]">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-white/55">Card holder</p>
              <p className="truncate font-semibold uppercase tracking-wide">{holder}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wider text-white/55">Valid thru</p>
              <p className="font-semibold tabular-nums">{expiry}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
