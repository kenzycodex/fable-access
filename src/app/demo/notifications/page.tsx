"use client";

import { ShieldCheck, ArrowDown } from "@phosphor-icons/react";
import { Screen, ScreenHeader, Card } from "@/components/demo/kit";

export default function NotificationsPage() {
  return (
    <Screen>
      <ScreenHeader title="Notifications" />
      
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4 p-4 rounded-2xl bg-purple-50 border border-purple-100 dark:bg-[#7C3AED]/10 dark:border-[#7C3AED]/20">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-[#7C3AED]/20 dark:text-[#7C3AED]">
            <ShieldCheck size={20} weight="fill" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold text-gray-900 dark:text-white">Fable Shield Alert</span>
            <span className="text-[13px] text-gray-600 dark:text-white/60 leading-relaxed">
              Fable blocked a suspicious login attempt from an unknown device in Lagos. Your account is safe.
            </span>
            <span className="text-[11px] font-medium text-gray-400 dark:text-white/30 mt-1">2 hours ago</span>
          </div>
        </div>

        <Card className="flex items-start gap-4 p-4 rounded-2xl">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-white/50">
            <ArrowDown size={20} />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold text-gray-900 dark:text-white">Deposit Successful</span>
            <span className="text-[13px] text-gray-600 dark:text-white/60 leading-relaxed">
              Your deposit of ₦120,000 from GTBank was successful.
            </span>
            <span className="text-[11px] font-medium text-gray-400 dark:text-white/30 mt-1">Yesterday</span>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
