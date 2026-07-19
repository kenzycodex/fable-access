"use client";

import { API_BASE } from "@/lib/fable/api";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      // We always show success to prevent email enumeration
      setSuccess(true);
    } catch (err) {
      toast.error("Failed to connect to Fable API.");
    } finally {
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
            
            <div className="flex justify-center mb-8">
              <Link href="/" className="relative flex w-fit items-center">
                <Image src="/images/brand/fable-logo-white.png" alt="Fable" width={1671} height={547} className="h-14 w-auto drop-shadow-md" />
              </Link>
            </div>

            <div className="w-full text-center mb-8">
              <h1 className="text-xl font-bold text-white mb-2">Reset your password</h1>
              <p className="text-sm text-gray-400">Enter your email and we'll send you a link to get back into your account.</p>
            </div>

            {success ? (
              <div className="w-full rounded border border-[#00f5a0]/30 bg-[#00f5a0]/10 p-4 text-center">
                <p className="text-[14px] text-white">
                  If an account exists for <span className="font-bold text-[#00f5a0]">{email}</span>, we've sent instructions to reset your password.
                </p>
                <div className="mt-6">
                  <Link href="/dashboard/login" className="text-[#00f5a0] text-sm hover:underline font-bold">
                    Return to login
                  </Link>
                </div>
              </div>
            ) : (
              <form className="flex w-full flex-col gap-4" onSubmit={handleReset}>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] placeholder:text-gray-500 hover:bg-white/[0.04]"
                    placeholder="Admin Email"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !email}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#7C3AED] py-3 text-[15px] font-medium text-white transition-all hover:bg-[#6d28d9] disabled:opacity-70 shadow-lg shadow-[#7C3AED]/20"
                >
                  {submitting ? (
                    <>
                      <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Sending...
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </button>

                <div className="mt-6 text-center text-[13px]">
                  <Link href="/dashboard/login" className="text-[#7C3AED] hover:underline hover:text-[#8b5cf6] transition-colors">
                    Back to login
                  </Link>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
