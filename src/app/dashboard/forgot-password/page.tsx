"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell, AuthSpinner, AuthSuccess, authButton, authInput } from "@/components/dashboard/AuthShell";
import { API_BASE } from "@/lib/fable/api";

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
        body: JSON.stringify({ email }),
      });
      // We always show success to prevent email enumeration
      setSuccess(true);
    } catch {
      toast.error("Failed to connect to Fable API.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <AuthShell>
        <AuthSuccess
          title="Check your email"
          action={
            <>
              <Link href="/dashboard/login" className={authButton}>
                Back to login
              </Link>
              <button
                type="button"
                onClick={() => setSuccess(false)}
                className="text-[13px] text-gray-400 transition-colors hover:text-white"
              >
                Didn&apos;t get it? Try again
              </button>
            </>
          }
        >
          If an account exists for <span className="font-medium text-white">{email}</span>, you&apos;ll get a link to reset
          your password shortly.
        </AuthSuccess>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" description="Enter your email and we'll send you a link to get back into your account.">
      <form className="flex w-full flex-col gap-4" onSubmit={handleReset}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInput}
          placeholder="Admin Email"
          aria-label="Admin Email"
          autoComplete="username"
          required
        />
        <button type="submit" disabled={submitting || !email} className={`mt-4 ${authButton}`}>
          {submitting ? (
            <>
              <AuthSpinner />
              Sending...
            </>
          ) : (
            "Send reset link"
          )}
        </button>
        <div className="mt-6 text-center text-[13px]">
          <Link href="/dashboard/login" className="text-[#7C3AED] transition-colors hover:text-[#8b5cf6] hover:underline">
            Back to login
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
