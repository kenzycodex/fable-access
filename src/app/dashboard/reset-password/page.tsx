"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field, Notice, TextInput } from "@/components/app-kit";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { API_BASE } from "@/lib/fable/api";

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
        body: JSON.stringify({ token, new_password: password }),
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
    } catch {
      setError("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <Notice tone="success">
        Your password has been reset. Taking you to sign in...
      </Notice>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleReset}>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="New password" hint="At least 8 characters.">
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password">
        <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" full loading={submitting}>
        {submitting ? "Saving" : "Set new password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Create a new password"
      description="Choose a new password for your console access."
      footer={
        <Link href="/dashboard/login" className="font-semibold text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      <Suspense fallback={<p className="text-center text-[13px] text-d-muted">Loading...</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
