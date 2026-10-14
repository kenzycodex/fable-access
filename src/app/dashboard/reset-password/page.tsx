"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthNotice, AuthShell, AuthSpinner, AuthSuccess, authButton, authInput } from "@/components/dashboard/AuthShell";
import { API_BASE } from "@/lib/fable/api";

function ResetPasswordForm({ invited = false, onDone }: { invited?: boolean; onDone: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || "Failed to reset password.");
        setSubmitting(false);
        return;
      }

      onDone();
      setTimeout(() => {
        router.push("/dashboard/login");
      }, 3000);
    } catch {
      setError("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleReset}>
      {error && <AuthNotice tone="danger">{error}</AuthNotice>}
      <div className="flex w-full flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={authInput}
          placeholder="New Password"
          aria-label="New Password"
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={authInput}
          placeholder="Confirm New Password"
          aria-label="Confirm New Password"
          autoComplete="new-password"
          required
        />
      </div>
      <button type="submit" disabled={submitting} className={`mt-4 ${authButton}`}>
        {submitting ? (
          <>
            <AuthSpinner />
            Saving...
          </>
        ) : invited ? (
          "Accept invitation"
        ) : (
          "Set new password"
        )}
      </button>
      <div className="mt-2 text-center text-[13px]">
        <Link href="/dashboard/login" className="text-[#7C3AED] transition-colors hover:text-[#8b5cf6] hover:underline">
          Back to login
        </Link>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  );
}

/** The same screen sets a first password for an invited teammate, so it says so. */
function ResetPasswordScreen() {
  const invited = useSearchParams().get("invite") === "1";
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <AuthShell>
        <AuthSuccess
          title={invited ? "You're in" : "Password updated"}
          action={
            <Link href="/dashboard/login" className={authButton}>
              Sign in now
            </Link>
          }
        >
          {invited ? "Your account is ready." : "Your new password is set."} Taking you to sign in.
        </AuthSuccess>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invited ? "Join your team on Fable" : "Create new password"}
      description={invited ? "Choose a password to accept your invitation to the console." : "Enter a new secure password for your dashboard access."}
    >
      <ResetPasswordForm invited={invited} onDone={() => setDone(true)} />
    </AuthShell>
  );
}
