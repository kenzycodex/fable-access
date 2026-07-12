"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { TrendDown, Lightning, Hourglass, Sparkle } from "@phosphor-icons/react";

interface Stat {
  value: string;
  label: string;
  description?: string;
}

/* ── Count-up hook ─────────────────────────────────────────────── */

function useCountUp(target: number, duration = 1800, start = false) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) return;
    let raf: number;
    const t0 = performance.now();

    function tick(now: number) {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutExpo for a satisfying deceleration
      const eased = 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);

  return value;
}

/* ── Parse a stat value string into numeric + prefix/suffix ──── */

function parseStatValue(raw: string): {
  prefix: string;
  number: number;
  suffix: string;
  decimals: number;
} {
  // e.g. "₦25.85bn" → prefix="₦", number=25.85, suffix="bn", decimals=2
  // e.g. "<200ms"    → prefix="<", number=200, suffix="ms", decimals=0
  // e.g. "10s"       → prefix="", number=10, suffix="s", decimals=0
  const match = raw.match(/^([^\d]*?)([\d,.]+)(.*)$/);
  if (!match) return { prefix: "", number: 0, suffix: raw, decimals: 0 };

  const prefix = match[1];
  const numStr = match[2].replace(/,/g, "");
  const number = parseFloat(numStr);
  const suffix = match[3];
  const dotIdx = numStr.indexOf(".");
  const decimals = dotIdx >= 0 ? numStr.length - dotIdx - 1 : 0;

  return { prefix, number, suffix, decimals };
}

/* ── Animated stat value ─────────────────────────────────────── */

function AnimatedStatValue({ raw }: { raw: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const { prefix, number, suffix, decimals } = parseStatValue(raw);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = useCountUp(number * Math.pow(10, decimals), 2000, visible);
  const display = (count / Math.pow(10, decimals)).toFixed(decimals);

  return (
    <span ref={ref} className="inline-block tabular-nums">
      {prefix}{display}{suffix}
    </span>
  );
}

/* ── StatGrid — Fable-style bold stats with count-up ──────────── */

export function StatGrid({ stats, tone = "dark" }: { stats: Stat[]; tone?: "dark" | "light" }) {

  return (
    <div className="mx-auto grid w-full grid-cols-2 gap-[12px] sm:gap-[16px] lg:grid-cols-4 lg:gap-[24px] lg:max-w-[1200px]">
      {stats.map((stat, i) => {
        let cardBg, valueColor, labelColor, descColor, iconWrapperBg, iconColor;

        if (i === 0) {
          // Always Light
          cardBg = "bg-[#E0D9F6] text-[#4C1D95]";
          valueColor = "text-[#6D28D9]";
          labelColor = "text-[#4C1D95]";
          descColor = "text-[#4C1D95]/70";
          iconWrapperBg = "bg-white/70";
          iconColor = "text-[#6D28D9]";
        } else if (i === 1) {
          // Always Purple
          cardBg = "bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] text-white shadow-xl shadow-[#8B5CF6]/20";
          valueColor = "text-white";
          labelColor = "text-white";
          descColor = "text-white/80";
          iconWrapperBg = "bg-white/20";
          iconColor = "text-white";
        } else if (i === 2) {
          // Mobile Purple, Desktop Light
          cardBg = "bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] shadow-xl shadow-[#8B5CF6]/20 text-white lg:bg-none lg:bg-[#E0D9F6] lg:shadow-none lg:text-[#4C1D95]";
          valueColor = "text-white lg:text-[#6D28D9]";
          labelColor = "text-white lg:text-[#4C1D95]";
          descColor = "text-white/80 lg:text-[#4C1D95]/70";
          iconWrapperBg = "bg-white/20 lg:bg-white/70";
          iconColor = "text-white lg:text-[#6D28D9]";
        } else {
          // Mobile Light, Desktop Purple
          cardBg = "bg-[#E0D9F6] text-[#4C1D95] lg:bg-gradient-to-br lg:from-[#8B5CF6] lg:to-[#6D28D9] lg:shadow-xl lg:shadow-[#8B5CF6]/20 lg:text-white";
          valueColor = "text-[#6D28D9] lg:text-white";
          labelColor = "text-[#4C1D95] lg:text-white";
          descColor = "text-[#4C1D95]/70 lg:text-white/80";
          iconWrapperBg = "bg-white/70 lg:bg-white/20";
          iconColor = "text-[#6D28D9] lg:text-white";
        }

        // Use 20% for the chamfer cuts so it leaves enough room for text on mobile
        const clipPath = "polygon(0 0, calc(100% - 20%) 0, 100% 20%, 100% 100%, 20% 100%, 0 calc(100% - 20%))";

        return (
          <div key={stat.label} className="w-full">
            <Reveal delay={i * 120}>
              <div 
                className={`relative flex w-full flex-col items-center justify-center aspect-square p-4 sm:p-5 lg:p-8 transition-transform duration-300 hover:-translate-y-1 ${cardBg}`}
                style={{ clipPath }}
              >
                <div className={`absolute top-4 left-4 lg:top-6 lg:left-6 flex items-center justify-center w-10 h-10 lg:w-14 lg:h-14 rounded-[10px] lg:rounded-[16px] ${iconWrapperBg} ${iconColor}`}>
                  {i === 0 && <TrendDown weight="fill" className="w-6 h-6 lg:w-8 lg:h-8" />}
                  {i === 1 && <Lightning weight="fill" className="w-6 h-6 lg:w-8 lg:h-8" />}
                  {i === 2 && <Hourglass weight="fill" className="w-6 h-6 lg:w-8 lg:h-8" />}
                  {i === 3 && <Sparkle weight="fill" className="w-6 h-6 lg:w-8 lg:h-8" />}
                </div>
                
                <div className="flex flex-col items-center text-center gap-1">
                  <p className={`font-heading text-[3.25rem] sm:text-[4.5rem] lg:text-[6rem] font-bold leading-[0.8] tracking-tighter ${valueColor}`}>
                    <AnimatedStatValue raw={stat.value} />
                  </p>
                  <p className={`text-[1.2rem] sm:text-[1.5rem] lg:text-[2rem] font-medium leading-[1.1] tracking-tight ${labelColor} mt-2 lg:mt-3`}>
                    {stat.label}
                  </p>
                </div>

                <div className="absolute bottom-4 right-3 lg:bottom-6 lg:right-6">
                  <p className={`max-w-[140px] sm:max-w-[180px] lg:max-w-[210px] text-right text-[9px] sm:text-[10px] lg:text-[13px] leading-[1.3] lg:leading-[1.4] whitespace-pre-line ${descColor}`}>
                    {stat.description}
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        );
      })}
    </div>
  );
}

/* ── StatCallout ─────────────────────────────────────────────── */

export function StatCallout({
  value,
  label,
  sourceHref,
  sourceLabel = "*Source",
}: {
  value: string;
  label: string;
  sourceHref?: string;
  sourceLabel?: string;
}) {
  return (
    <Reveal className="flex flex-col items-start gap-[var(--spacing-xs)]">
      <p
        className="font-heading font-bold leading-none tracking-tight"
        style={{ fontSize: "clamp(3.4rem, 5vw, 6rem)", color: "var(--color-secondary)" }}
      >
        <AnimatedStatValue raw={value} />
      </p>
      <p className="text-h5 font-bold">{label}</p>
      {sourceHref && (
        <Link href={sourceHref} className="text-s underline opacity-70 hover:opacity-100">
          {sourceLabel}
        </Link>
      )}
    </Reveal>
  );
}
