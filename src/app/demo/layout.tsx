import type { Metadata } from "next";
import { DemoBottomNav, DemoSidebar } from "@/components/demo/DemoNav";

export const metadata: Metadata = {
  title: "Demo Bank",
  description: "A working demo of Fable protecting a live transfer, end to end.",
};

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-surface="app" className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-[#111111] dark:text-white transition-colors duration-300">
      <DemoSidebar />
      <main className="min-h-dvh pb-20 lg:pl-[220px] lg:pb-6">{children}</main>
      <DemoBottomNav />
    </div>
  );
}
