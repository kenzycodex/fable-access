"use client";

import { useState, useEffect } from "react";

const TITLES = [
  "Built for Nigerian Banks & Fintechs",
  "#1 in Payment Fraud Prevention",
  "#1 in Account Takeover Protection",
  "Leading AML Compliance Engine"
];

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
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <div className="flex items-center gap-[2px] text-[#FF4E2C]">
          {/* G2 Logo */}
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-auto mr-1.5">
            <path d="M12.3 3c-5 0-9.1 4-9.1 9s4.1 9 9.1 9c4.2 0 7.8-2.8 8.8-6.6H13v-3.4h11.2c.1.6.2 1.3.2 2 0 6.6-5.4 12-12.1 12C5.5 25 0 19.6 0 13S5.5 1 12.3 1c3.1 0 5.9 1.1 8.1 3l-2.4 2.5C16.5 5 14.5 4 12.3 4z" />
            <path d="M21 7V5h-1.5V7h-2v1.5h2v2H21v-2h2V7h-2z" />
          </svg>

          {/* 3 Full Stars */}
          {[...Array(3)].map((_, i) => (
            <svg key={i} viewBox="0 0 24 24" fill="currentColor" className="size-[16px]">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          ))}
          {/* 1 Half Star */}
          <svg viewBox="0 0 24 24" className="size-[16px]">
            <defs>
              <linearGradient id="halfGrad">
                <stop offset="50%" stopColor="currentColor" />
                <stop offset="50%" stopColor="currentColor" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path fill="url(#halfGrad)" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
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
