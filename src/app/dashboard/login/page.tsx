"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheckIcon } from "@/components/app-icons";
import { API_BASE } from "@/lib/fable/api";
import { DEMO_CREDENTIALS, INSTITUTION } from "@/lib/fable/seed";
import { login, useFableStore } from "@/lib/fable/store";
import { toast } from "sonner";

const HIGHLIGHTS = [
  "Every transfer scored in under 200ms",
  "Copilot, Shield, Ghost & Watch in one console",
  "Full audit trail behind every decision",
];

export default function DashboardLoginPage() {
  const router = useRouter();
  const store = useFableStore();
  const [email, setEmail] = useState(DEMO_CREDENTIALS.email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.password);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (store?.session.loggedIn) router.replace("/dashboard");
  }, [store, router]);

  async function handleSignIn() {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail || "Invalid credentials");
        setSubmitting(false);
        return;
      }
      // Sign in as the institution this admin actually belongs to — the
      // dashboard filters every query by it.
      login(data.institution_id);
      router.push("/dashboard");
    } catch (err) {
      toast.error("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  return (
    <div data-surface="app" className="h-dvh w-full bg-black">
      <div className="animate-card-entrance grid h-full w-full lg:grid-cols-2 bg-black">
        
        {/* Image panel (Left Side) */}
        <div className="relative hidden w-full h-full overflow-hidden lg:block bg-[#1E1145]">
          <Image
            src="/images/brand/login-bg.jpg"
            alt="Fable Login Background"
            fill
            className="object-cover"
            priority
          />
        </div>

        {/* Form panel (Right Side) */}
        <div className="flex flex-col justify-center px-6 py-8 sm:px-12 lg:px-16 bg-black z-10 relative">
          <div className="flex w-full max-w-[340px] mx-auto flex-col items-center">
            
            <div className="flex justify-center mb-10">
              <Link href="/" className="relative flex w-fit items-center">
                <Image src="/images/brand/fable-logo-white.png" alt="Fable" width={1671} height={547} className="h-14 w-auto drop-shadow-md" />
              </Link>
            </div>

            <form
              className="flex w-full flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSignIn();
              }}
            >
              <div className="flex flex-col gap-3 w-full">
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] placeholder:text-gray-500 hover:bg-white/[0.04]"
                    placeholder="Email"
                  />
                </div>

                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] placeholder:text-gray-500 hover:bg-white/[0.04]"
                    placeholder="Password"
                  />
                </div>
              </div>

              <div className="flex w-full mt-1">
                <Link href="/dashboard/forgot-password" className="text-[14px] text-[#7C3AED] hover:underline hover:text-[#8b5cf6] transition-colors">
                  Forgot your password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-[#7C3AED] py-3 text-[15px] font-medium text-white transition-all hover:bg-[#6d28d9] disabled:opacity-70 shadow-lg shadow-[#7C3AED]/20"
              >
                {submitting ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Authenticating...
                  </>
                ) : (
                  "Log in"
                )}
              </button>

              <div className="mt-4 text-center text-[13px] text-gray-400 font-normal">
                Don't have an account? <button type="button" className="text-[#7C3AED] hover:underline hover:text-[#8b5cf6] transition-colors">Contact Sales</button>.
              </div>

              <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-[#7C3AED]">
                <button type="button" className="hover:underline hover:text-[#8b5cf6] transition-colors">Privacy Notice</button>
                <span className="text-gray-700">|</span>
                <button type="button" className="hover:underline hover:text-[#8b5cf6] transition-colors">Terms of Service</button>
                <span className="text-gray-700">|</span>
                <button type="button" className="hover:underline hover:text-[#8b5cf6] transition-colors">IP Notification</button>
              </div>

              <p className="mt-4 text-center text-[12px] text-gray-500 leading-relaxed px-4">
                By accessing the Fable Console and related services you hereby agree to the Terms of Service.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
