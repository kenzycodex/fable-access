"use client";

import Image from "next/image";
import { useId, useState, type ReactNode } from "react";

export interface TabItem {
  label: string;
  icon?: { src: string; alt: string; width: number; height: number };
  panel: ReactNode;
}

export function Tabs({ tabs }: { tabs: TabItem[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();

  return (
    <div>
      <div role="tablist" aria-label="Content tabs" className="flex flex-wrap gap-[var(--spacing-xs)] border-b border-black/10 pb-[var(--spacing-xs)]">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            id={`${baseId}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={active === i}
            aria-controls={`${baseId}-panel-${i}`}
            onClick={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-2 rounded-pill px-[var(--spacing-s)] py-[var(--spacing-xs)] text-s font-bold transition-colors ${
              active === i ? "bg-black text-white" : "bg-light text-black hover:bg-tertiary"
            }`}
          >
            {tab.icon && <Image src={tab.icon.src} alt="" width={tab.icon.width} height={tab.icon.height} className="h-5 w-auto" />}
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab, i) => (
        <div
          key={tab.label}
          id={`${baseId}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={active !== i}
          className="pt-[var(--spacing-l)]"
        >
          {active === i && tab.panel}
        </div>
      ))}
    </div>
  );
}
