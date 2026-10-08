"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Field, Notice, TextInput } from "@/components/app-kit";
import { AuthShell } from "@/components/dashboard/AuthShell";
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

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your admin email and we will send you a link to get back in."
      footer={
        <Link href="/dashboard/login" className="font-semibold text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      {success ? (
        <Notice tone="success">
          If an account exists for <span className="font-semibold">{email}</span>, we have sent instructions to reset your
          password.
        </Notice>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleReset}>
          <Field label="Admin email">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.ng"
              autoComplete="username"
              required
            />
          </Field>
          <Button type="submit" size="lg" full loading={submitting} disabled={!email}>
            {submitting ? "Sending" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
