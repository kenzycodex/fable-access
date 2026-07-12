"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { demoCta } from "@/data/nav";
import type { IndustryTab } from "@/data/why-fable";

/**
 * The "Industries We Serve" widget from why-fable, matching the source's
 * dark treatment: white-bordered slider cards (icon + Titillium title),
 * active card highlighted with a pink border + 1px pink outline, and a
 * panel below with the copy and (when there are any) related case studies.
 */
export function IndustryTabs({ tabs }: { tabs: IndustryTab[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tab = tabs[active];
  const hasCaseStudies = tab.caseStudies.length > 0;

  return (
    <div className="flex flex-col text-white">
      {/* Card strip -- all 6 fit across on desktop (2/3/6 responsive) */}
      <div
        role="tablist"
        aria-label="Industries we serve"
        className="grid grid-cols-2 gap-[13px] py-[20px] sm:grid-cols-3 lg:grid-cols-6"
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            id={`${baseId}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={active === i}
            aria-controls={`${baseId}-panel-${i}`}
            onClick={() => setActive(i)}
            className={`flex h-[150px] cursor-pointer flex-col items-start justify-between rounded-[var(--radius)] border-2 px-[var(--spacing-m)] py-[var(--spacing-s)] text-left transition-all duration-200 lg:h-[170px] ${
              active === i ? "border-secondary outline outline-1 outline-secondary" : "border-white"
            }`}
          >
            <Image src={t.icon.src} alt="" width={t.icon.width} height={t.icon.height} className="w-[50px]" />
            <span className="font-heading text-h4 font-semibold leading-tight text-white">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Panel */}
      <div
        id={`${baseId}-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active}`}
        className={`grid grid-cols-1 gap-[var(--spacing-l)] pt-[var(--spacing-l)] ${
          hasCaseStudies ? "lg:grid-cols-2 lg:gap-[var(--spacing-xxl)]" : ""
        }`}
      >
        <div className="flex flex-col items-start gap-[var(--content-gap-s)]">
          <p className="font-heading text-h4 font-bold">{tab.panelTitle}</p>
          <p className={`text-m text-white/90 ${hasCaseStudies ? "" : "max-w-[640px]"}`}>{tab.body}</p>
          <div className="mt-[var(--spacing-s)]">
            <Link
              href={demoCta.href}
              className="group relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-pill border-2 border-secondary px-7 py-3.5 text-s font-bold uppercase text-white"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 origin-left scale-x-0 bg-secondary transition-transform duration-300 ease-out group-hover:scale-x-100"
              />
              <span className="relative z-10">{demoCta.label}</span>
            </Link>
          </div>
        </div>

        {hasCaseStudies && (
          <div className="flex flex-col gap-[var(--content-gap-s)]">
            <p className="font-sans text-l font-bold uppercase text-accent">Related Case Studies</p>
            {tab.caseStudies.map((cs) => (
              <a
                key={cs.name}
                href={cs.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full flex-col gap-1 text-white no-underline lg:w-4/5"
              >
                <span className="inline-flex items-center gap-2 font-heading text-h4 font-bold">
                  {cs.name}
                  <ArrowRightIcon className="size-[15px] text-secondary opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </span>
                <span className="text-s text-white/85">{cs.blurb}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
