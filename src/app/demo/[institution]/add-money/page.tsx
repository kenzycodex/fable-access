"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Bank, CreditCard, SpinnerGap } from "@phosphor-icons/react";
import { Screen, ScreenHeader, Card } from "@/components/demo/kit";
import { useInstitution } from "@/components/demo/InstitutionProvider";

export default function AddMoneyPage() {
  const { href } = useInstitution();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<"card" | "transfer">("card");

  function handleAdd() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      router.push(href());
    }, 1500);
  }

  return (
    <Screen>
      <ScreenHeader title="Add Money" />
      
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center text-center py-6">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 mb-4 shadow-sm">
            <ArrowDown size={28} weight="bold" />
          </div>
          <h2 className="text-[24px] font-bold text-gray-900 dark:text-white mb-2">Fund Account</h2>
          <p className="text-[13px] text-gray-600 dark:text-white/50 max-w-[260px] mx-auto">
            Fable's intelligent 3D Secure actively analyzes deposit risk without friction.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Card 
            onClick={() => setMethod("card")}
            className={`flex items-center gap-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#222] transition-colors border-2 ${
              method === "card" 
                ? "border-[#7C3AED] dark:border-[#7C3AED]/50" 
                : "border-transparent"
            }`}
          >
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
              method === "card"
                ? "bg-purple-100 text-purple-600 dark:bg-[#7C3AED]/20 dark:text-[#7C3AED]"
                : "bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-white/40"
            }`}>
              <CreditCard size={20} weight={method === "card" ? "fill" : "regular"} />
            </span>
            <div className="flex flex-col flex-1">
              <span className="text-[14px] font-bold text-gray-900 dark:text-white">Bank Card</span>
              <span className="text-[12px] text-gray-500 dark:text-white/40">Fund instantly with debit card</span>
            </div>
            <div className={`size-4 rounded-full border-[5px] bg-white dark:bg-[#111111] transition-colors ${
              method === "card" ? "border-[#7C3AED]" : "border-gray-300 dark:border-white/20 border-2"
            }`} />
          </Card>

          <Card 
            onClick={() => setMethod("transfer")}
            className={`flex items-center gap-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#222] transition-colors border-2 ${
              method === "transfer" 
                ? "border-[#7C3AED] dark:border-[#7C3AED]/50" 
                : "border-transparent"
            }`}
          >
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
              method === "transfer"
                ? "bg-purple-100 text-purple-600 dark:bg-[#7C3AED]/20 dark:text-[#7C3AED]"
                : "bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-white/40"
            }`}>
              <Bank size={20} weight={method === "transfer" ? "fill" : "regular"} />
            </span>
            <div className="flex flex-col flex-1">
              <span className="text-[14px] font-bold text-gray-900 dark:text-white">Bank Transfer</span>
              <span className="text-[12px] text-gray-500 dark:text-white/40">Send to your account number</span>
            </div>
            <div className={`size-4 rounded-full border-[5px] bg-white dark:bg-[#111111] transition-colors ${
              method === "transfer" ? "border-[#7C3AED]" : "border-gray-300 dark:border-white/20 border-2"
            }`} />
          </Card>
        </div>

        <button 
          onClick={handleAdd}
          disabled={loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED] py-4 text-[14px] font-bold text-white shadow-lg shadow-[#7C3AED]/20 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {loading ? <SpinnerGap size={20} className="animate-spin" /> : "Proceed"}
        </button>
      </div>
    </Screen>
  );
}
