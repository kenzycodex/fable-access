"use client";

import { API_BASE } from "@/lib/fable/api";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Invalid or missing reset token.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    
    setError("");
    setSubmitting(true);
    
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.detail || "Failed to reset password.");
        setSubmitting(false);
        return;
      }
      
      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard/login");
      }, 3000);
    } catch (err) {
      setError("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-[340px] mx-auto flex-col items-center">
      <div className="flex justify-center mb-8">
        <Link href="/" className="relative flex w-fit items-center">
          <Image src="/images/brand/fable-logo-white.png" alt="Fable" width={1671} height={547} className="h-14 w-auto drop-shadow-md" />
        </Link>
      </div>

      <div className="w-full text-center mb-8">
        <h1 className="text-xl font-bold text-white mb-2">Create new password</h1>
        <p className="text-sm text-gray-400">Enter a new secure password for your dashboard access.</p>
      </div>

      {success ? (
        <div className="w-full rounded border border-[#00f5a0]/30 bg-[#00f5a0]/10 p-4 text-center">
          <p className="text-[14px] text-white">
            Your password has been successfully reset!
          </p>
          <p className="text-[12px] text-gray-400 mt-2">
            Redirecting you to login...
          </p>
        </div>
      ) : (
        <form className="flex w-full flex-col gap-4" onSubmit={handleReset}>
          {error && (
            <div className="w-full rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
              {error}
            </div>
          )}
          
          <div className="flex flex-col gap-3 w-full">
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] placeholder:text-gray-500 hover:bg-white/[0.04]"
                placeholder="New Password"
                required
              />
            </div>

            <div className="relative">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] placeholder:text-gray-500 hover:bg-white/[0.04]"
                placeholder="Confirm New Password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#7C3AED] py-3 text-[15px] font-medium text-white transition-all hover:bg-[#6d28d9] disabled:opacity-70 shadow-lg shadow-[#7C3AED]/20"
          >
            {submitting ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Saving...
              </>
            ) : (
              "Set new password"
            )}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div data-surface="app" className="h-dvh w-full bg-black">
      <div className="animate-card-entrance grid h-full w-full lg:grid-cols-2 bg-black">
        <div className="relative hidden w-full h-full overflow-hidden lg:block bg-[#1E1145]">
          <Image
            src="/images/brand/login-bg.jpg"
            alt="Fable Login Background"
            fill
            className="object-cover"
            priority
          />
        </div>
        <div className="flex flex-col justify-center px-6 py-8 sm:px-12 lg:px-16 bg-black z-10 relative">
          <Suspense fallback={<div className="text-white text-center">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
