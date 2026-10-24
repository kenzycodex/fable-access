"use client";

import { useEffect, useState } from "react";

interface SubNavItem {
  label: string;
  href: string;
}

export function StickySubNav({ items }: { items: SubNavItem[] }) {
  const [active, setActive] = useState(items[0]?.href ?? "");

  useEffect(() => {
    const ids = items.map((item) => item.href.replace("#", ""));
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActive(`#${visible[0].target.id}`);
        }
      },
      { rootMargin: "-40% 0px -50% 0px" },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="sticky top-0 z-40 overflow-x-auto bg-white shadow-[0_4px_8px_rgba(0,0,0,0.16)]">
      <ul className="mx-auto flex w-max min-w-full items-center gap-[var(--spacing-l)] px-[var(--gutter)] py-[var(--spacing-xs)]">
        {items.map((item) => (
          <li key={item.href}>
            {/* Source: .careers-float-nav__nav-link -- normal case, text-m,
                weight 500, black; the active item gets a 4px pink bar sitting
                on the nav's bottom edge (the :after at bottom -31px). */}
            <a
              href={item.href}
              className={`relative block whitespace-nowrap py-[var(--spacing-xs)] text-m font-medium text-black transition-colors after:absolute after:-bottom-[calc(var(--spacing-xs)+1px)] after:left-0 after:h-[4px] after:w-full after:bg-secondary after:opacity-0 after:transition-opacity after:duration-300 hover:text-secondary ${
                active === item.href ? "after:opacity-100" : ""
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
