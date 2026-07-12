"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { headerCta } from "@/data/nav";
import { Nav } from "./Nav";
import { MobileMenu } from "./MobileMenu";
// Notification bar disabled for now -- see NotificationBar.tsx to re-enable.
// import { NotificationBar } from "./NotificationBar";

export function Header() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);
  const [atTop, setAtTop] = useState(true);
  const [hidden, setHidden] = useState(false);

  // Pages that open on a full-bleed dark hero get a transparent floating
  // header with white text. Pages with a white standard hero (e.g.
  // why-fable) use the solid header plus the spacer below.
  const transparentCapable = pathname === "/" || pathname === "/platform" || pathname === "/pricing";

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      setAtTop(y < 40);
      // Hide while scrolling down (past the top), reveal while scrolling up.
      setHidden(y > lastScrollY.current && y > 120);
      lastScrollY.current = y;
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Publish the header's real (fluid, responsive) height as a CSS variable
  // so non-home pages can reserve space for it below.
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const update = () => document.documentElement.style.setProperty("--header-height", `${node.scrollHeight}px`);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);

  const isTransparent = transparentCapable && atTop;
  const solidBg = transparentCapable ? "bg-black" : "bg-white";
  const useWhiteText = isTransparent || transparentCapable;

  // Transparent pages (home/TFO/services) float the header over a dark hero
  // and hide/reveal it on scroll. Standard pages (why-fable) match the
  // source's Standard header: normal flow, scrolls away, letting the sticky
  // sub-nav own the top of the viewport.
  const positionClasses = transparentCapable
    ? `fixed inset-x-0 top-0 z-50 transition-transform duration-300 ease-in-out ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`
    : "relative z-50";

  return (
    <>
      <header ref={headerRef} className={`flex flex-col ${positionClasses}`}>
        <div
          className={`flex items-center justify-between gap-[var(--spacing-m)] px-[var(--gutter)] py-[var(--spacing-s)] transition-[background-color,box-shadow] duration-300 ease-in-out ${
            isTransparent ? "bg-transparent" : `${solidBg} shadow-[0_1px_0_rgba(0,0,0,0.08)]`
          }`}
        >
          <Link href="/" className="flex shrink-0 items-center" aria-label="Fable home">
            {useWhiteText ? (
              <Image
                src="/images/brand/fable-logo-white.png"
                alt="Fable"
                width={1671}
                height={547}
                priority
                className="h-[48px] w-auto transition-opacity duration-300"
              />
            ) : (
              <Image
                src="/images/brand/fable-logo.png"
                alt="Fable"
                width={1671}
                height={547}
                priority
                className="h-[48px] w-auto transition-opacity duration-300"
              />
            )}
          </Link>

          <Nav transparent={useWhiteText} />

          <div className="hidden items-center gap-[var(--content-gap)] lg:flex">
            <Link
              href={headerCta.demo.href}
              className="group relative isolate inline-flex items-center justify-center overflow-hidden whitespace-nowrap rounded-pill border-3 border-secondary bg-secondary px-[var(--spacing-s)] py-[var(--spacing-xs)] text-xs font-bold uppercase text-black"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 origin-left scale-x-0 bg-black transition-transform duration-300 ease-out group-hover:scale-x-100"
              />
              <span className="relative z-10 transition-colors duration-300 group-hover:text-white">
                {headerCta.demo.label}
              </span>
            </Link>
          </div>

          <MobileMenu transparent={useWhiteText} />
        </div>
      </header>
    </>
  );
}
