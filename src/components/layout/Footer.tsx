import Image from "next/image";
import Link from "next/link";
import { footerBottomLink, footerCopyrightSuffix, footerDescription } from "@/data/footer";
import { dashboardCta } from "@/data/nav";

export function Footer() {
  return (
    <footer className="bg-black py-[var(--spacing-l)] text-white">
      <div className="mx-auto flex w-full max-w-[var(--container-width)] flex-col gap-[var(--spacing-m)] px-[var(--gutter)] sm:gap-[var(--spacing-l)]">
        <div className="flex flex-col items-start gap-[var(--spacing-s)] lg:flex-row lg:items-center lg:justify-between lg:gap-[var(--spacing-m)]">
          <Link href="/" aria-label="Fable home" className="shrink-0">
            <Image
              src="/images/brand/fable-logo-white.png"
              alt="Fable"
              width={1671}
              height={547}
              className="h-[32px] w-auto sm:h-[42px]"
            />
          </Link>
          <p className="max-w-[440px] text-xs text-white/80 sm:text-s lg:text-left">{footerDescription}</p>
          <Link
            href={dashboardCta.href}
            className="group relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-pill border-2 border-secondary px-5 py-2.5 text-xs font-bold uppercase text-white sm:px-7 sm:py-3 sm:text-s"
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 origin-left scale-x-0 bg-secondary transition-transform duration-300 ease-out group-hover:scale-x-100"
            />
            <span className="relative z-10">{dashboardCta.label}</span>
          </Link>
        </div>

        <div className="flex flex-row items-center justify-between gap-2 border-t border-white/20 pt-[var(--spacing-s)]">
          <p className="text-[11px] text-white/80 sm:text-xs">
            &copy; {new Date().getFullYear()} {footerCopyrightSuffix}
          </p>
          <Link href={footerBottomLink.href} className="shrink-0 text-[11px] text-white/80 hover:text-secondary sm:text-xs">
            {footerBottomLink.label}
          </Link>
        </div>
      </div>
    </footer>
  );
}
