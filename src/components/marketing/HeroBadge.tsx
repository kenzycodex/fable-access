"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CheckCircle, Eye, LockSimple, ShieldCheck } from "@phosphor-icons/react";

// The same badge as before Phase 0, honestly. It used to show a G2 logo, a
// star rating and "#1" titles that no review site or analyst ever awarded
// Fable. Now: Fable's own shield, four product icons in the same colour and
// rhythm as the stars (not a rating), and lines that are true.
const TITLES = [
  "Built for Nigerian banks and fintechs",
  "Behavioural scoring before every transfer",
  "Scam scripts caught in English and Pidgin",
];

const ICONS = [ShieldCheck, LockSimple, Eye, CheckCircle];

export function HeroBadge() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % TITLES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="flex flex-wrap items-center gap-3 mb-2" data-testid="hero-badge">
        <div className="flex items-center gap-[2px] text-[#FF4E2C]" aria-hidden="true">
          <Image
            src="/images/brand/fable-logo-icon.png"
            alt=""
            width={1254}
            height={1254}
            loading="eager"
            className="h-[18px] w-auto mr-1.5"
          />
          {ICONS.map((Icon, i) => (
            <Icon key={i} weight="fill" className="size-[16px]" />
          ))}
        </div>

        <div className="grid">
          <p
            key={index}
            className="text-[14px] font-bold text-white/90 col-start-1 row-start-1"
            style={{ animation: "slideUpFade 0.4s ease-out forwards" }}
          >
            {TITLES[index]}
          </p>
        </div>
      </div>
    </>
  );
}
