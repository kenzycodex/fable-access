"use client";

import { useState } from "react";
import { CreditCard, Eye, EyeClosed, Nut } from "@phosphor-icons/react";
import { Screen, ScreenHeader, Card } from "@/components/demo/kit";
import { DEMO_USER } from "@/lib/fable/seed";

export default function CardsPage() {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Screen>
      <ScreenHeader title="My Cards" />
      
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full lg:w-[380px] shrink-0 h-48 rounded-2xl bg-gradient-to-br from-[#1a1a1a] to-[#222] border border-white/[0.05] p-6 flex flex-col justify-between shadow-xl">
          <div className="flex justify-between items-center">
            <span className="text-[16px] font-bold text-white tracking-tight">Meridian</span>
            <CreditCard size={28} className="text-white/40" />
          </div>
          <div>
            <p className="text-[20px] font-mono tracking-widest text-white/90 mb-3">
              {showDetails ? "4532 1109 8765 4092" : "**** **** **** 4092"}
            </p>
            <div className="flex justify-between text-[12px] text-white/50 uppercase tracking-wider font-semibold">
              <span className="text-white/80">{DEMO_USER.name}</span>
              <span className="flex gap-4">
                <span>12/28</span>
                {showDetails && <span className="animate-in fade-in duration-300">CVV 812</span>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 w-full">
          <div className="grid grid-cols-2 gap-3 lg:h-24">
            <button 
              onClick={() => setShowDetails(!showDetails)}
              className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/[0.04] py-4 px-2 text-gray-600 dark:text-white/60 transition-colors hover:bg-gray-200 dark:hover:bg-white/[0.08]"
            >
              {showDetails ? <EyeClosed size={20} /> : <Eye size={20} />}
              <span className="text-[12px] font-semibold text-gray-900 dark:text-white">
                {showDetails ? "Hide Details" : "Show Details"}
              </span>
            </button>
            <button 
              disabled
              className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-gray-50 dark:bg-white/[0.02] py-4 px-2 text-gray-400 dark:text-white/30 cursor-default"
            >
              <Nut size={20} className="opacity-50" />
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-gray-500 dark:text-white/40">Settings</span>
                <span className="rounded bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Soon</span>
              </div>
            </button>
          </div>

          <Card>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[14px] font-bold text-gray-900 dark:text-white">Secured by Fable</h3>
              <p className="text-[13px] text-gray-600 dark:text-white/50 leading-relaxed">
                Your virtual card uses Fable Dynamic CVV. Every online transaction is actively scored, and the CVV rotates automatically to prevent card-not-present fraud.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </Screen>
  );
}
