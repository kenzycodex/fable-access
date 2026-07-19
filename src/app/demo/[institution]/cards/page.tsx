"use client";

import { CreditCard, Eye, Nut } from "@phosphor-icons/react";
import { Screen, ScreenHeader, Card } from "@/components/demo/kit";
import { DEMO_USER } from "@/lib/fable/seed";

export default function CardsPage() {
  return (
    <Screen>
      <ScreenHeader title="My Cards" />
      
      <div className="flex flex-col gap-6">
        <div className="w-full h-56 rounded-2xl bg-gradient-to-br from-[#1a1a1a] to-[#222] border border-white/[0.05] p-6 flex flex-col justify-between shadow-xl">
          <div className="flex justify-between items-center">
            <span className="text-[16px] font-bold text-white tracking-tight">Meridian</span>
            <CreditCard size={28} className="text-white/40" />
          </div>
          <div>
            <p className="text-[20px] font-mono tracking-widest text-white/90 mb-3">**** **** **** 4092</p>
            <div className="flex justify-between text-[12px] text-white/50 uppercase tracking-wider font-semibold">
              <span className="text-white/80">{DEMO_USER.name}</span>
              <span>12/28</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/[0.04] p-4 text-gray-600 dark:text-white/60 transition-colors hover:bg-gray-200 dark:hover:bg-white/[0.08]">
            <Eye size={20} />
            <span className="text-[12px] font-semibold text-gray-900 dark:text-white">Show Details</span>
          </button>
          <button className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/[0.04] p-4 text-gray-600 dark:text-white/60 transition-colors hover:bg-gray-200 dark:hover:bg-white/[0.08]">
            <Nut size={20} />
            <span className="text-[12px] font-semibold text-gray-900 dark:text-white">Settings</span>
          </button>
        </div>

        <Card>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[14px] font-bold text-gray-900 dark:text-white">Secured by Fable</h3>
            <p className="text-[13px] text-gray-600 dark:text-white/50">
              Your virtual card uses Fable Dynamic CVV. Every online transaction is actively scored, and the CVV rotates automatically to prevent card-not-present fraud.
            </p>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
