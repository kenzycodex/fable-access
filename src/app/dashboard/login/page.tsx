"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { AuthShell } from "@/components/dashboard/AuthShell";
import { Button, Field, TextInput } from "@/components/app-kit";
import { API_BASE } from "@/lib/fable/api";
import { login, useFableStore } from "@/lib/fable/store";

/** Demo credentials shown on the sign-in card.
 *
 * Configured rather than hardcoded. The previous version baked an email and
 * password into the bundle, which meant that after re-provisioning the page
 * advertised an account that no longer existed, so the only thing it reliably
 * produced was a failed login.
 *
 * Set both in Vercel to show the card, or leave either unset to hide it
 * entirely (which is what you want the moment this stops being a demo):
 *   NEXT_PUBLIC_DEMO_EMAIL, NEXT_PUBLIC_DEMO_PASSWORD
 *
 * These are NEXT_PUBLIC_ and therefore inlined into the client bundle, which is
 * fine only because the whole point is to publish them. Never put a real
 * operator credential here.
 */
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "";
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";

export default function DashboardLoginPage() {
  const router = useRouter();
  const store = useFableStore();
  // Not pre-filled. These used to default to a hardcoded demo account that no
  // longer exists after re-provisioning, so the form arrived populated with
  // credentials guaranteed to fail, which reads as a broken login rather than
  // an empty one.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // While a sign-in is in flight, handleSignIn owns the navigation.
    if (store?.session.loggedIn && !submitting) router.replace("/dashboard");
  }, [store, router, submitting]);

  async function handleSignIn() {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail || "Invalid credentials");
        setSubmitting(false);
        return;
      }
      // Sign in as the institution this admin actually belongs to, and keep the
      // signed session token the API issued. Every dashboard call presents it,
      // which is what lets the server derive the tenant from a verified
      // identity instead of trusting a query parameter.
      login(data.institution_id, data.token, data.expires_at);
      // A full navigation, not router.push. The marketing site prefetches
      // /dashboard while signed out, and middleware answered that prefetch with
      // a redirect to this page. The client router then replays the cached
      // redirect and leaves a freshly signed-in user on the login screen until
      // they reload, which is most visible on mobile. A hard navigation skips
      // the cache and sends the cookie we just set.
      window.location.assign("/dashboard");
    } catch {
      toast.error("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to the Fable console."
      footer={
        <>
          <p>
            No account yet?{" "}
            <Link href="/pricing" className="font-semibold text-brand hover:underline">
              See pricing and talk to us
            </Link>
          </p>
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px]">
            <Link href="/privacy" className="hover:text-d-text hover:underline">Privacy Notice</Link>
            <Link href="/terms" className="hover:text-d-text hover:underline">Terms of Service</Link>
            <Link href="/terms#intellectual-property" className="hover:text-d-text hover:underline">IP Notice</Link>
          </p>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSignIn();
        }}
      >
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@institution.ng"
            required
          />
        </Field>

        <Field
          label="Password"
          right={
            <Link href="/dashboard/forgot-password" className="text-[12px] font-semibold text-brand hover:underline">
              Forgot password?
            </Link>
          }
        >
          <div className="relative">
            <TextInput
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="pr-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-d-faint transition-colors hover:text-d-text"
            >
              {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>

        <Button type="submit" size="lg" full loading={submitting} className="mt-1">
          {submitting ? "Signing in" : "Sign in"}
        </Button>

        {DEMO_EMAIL && DEMO_PASSWORD && (
          <div className="rounded-xl bg-brand/[0.07] p-4 text-[13px]">
            <p className="font-semibold text-brand">Demo account</p>
            <p className="mt-1.5 text-d-muted">
              Email <span className="font-mono text-d-text">{DEMO_EMAIL}</span>
            </p>
            <p className="text-d-muted">
              Password <span className="font-mono text-d-text">{DEMO_PASSWORD}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
              }}
              className="mt-2 text-[12px] font-semibold text-brand hover:underline"
            >
              Fill these in
            </button>
          </div>
        )}

        <p className="text-center text-[12px] leading-relaxed text-d-faint">
          By signing in you agree to the{" "}
          <Link href="/terms" className="underline hover:text-d-text">Terms of Service</Link> and acknowledge the{" "}
          <Link href="/privacy" className="underline hover:text-d-text">Privacy Notice</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
