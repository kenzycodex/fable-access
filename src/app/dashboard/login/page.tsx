"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { AuthShell, AuthSpinner, authButton, authInput } from "@/components/dashboard/AuthShell";
import { API_BASE } from "@/lib/fable/api";
import { login, sessionToken, useFableStore } from "@/lib/fable/store";

/** Where to go after signing in: `?next=` when it is a path on this site (the
 * sandbox app sends people here and back), otherwise the console. */
function nextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  // A same-site path only. "//host" and "/\host" are read by browsers as
  // another site, so a backslash anywhere is refused too.
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard";
}

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
    // Only a live session skips the form. A remembered but expired one used to
    // bounce you onward and back here again.
    if (store?.session.loggedIn && sessionToken() && !submitting) router.replace(nextPath());
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
      window.location.assign(nextPath());
    } catch {
      toast.error("Failed to connect to Fable API.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSignIn();
        }}
      >
        <div className="flex w-full flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            placeholder="Email"
            aria-label="Email"
            autoComplete="username"
            required
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${authInput} pr-10`}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-white"
              tabIndex={-1}
            >
              {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="mt-1 flex w-full items-center justify-between gap-3">
          <Link href="/dashboard/forgot-password" className="text-[14px] text-[#7C3AED] transition-colors hover:text-[#8b5cf6] hover:underline">
            Forgot your password?
          </Link>
        </div>

        <button type="submit" disabled={submitting} className={`mt-2 ${authButton}`}>
          {submitting ? (
            <>
              <AuthSpinner />
              Authenticating...
            </>
          ) : (
            "Log in"
          )}
        </button>

        <div className="mt-4 text-center text-[13px] font-normal text-gray-400">
          Don&apos;t have an account?{" "}
          <Link href="/pricing" className="text-[#7C3AED] transition-colors hover:text-[#8b5cf6] hover:underline">
            Contact Sales
          </Link>
          .
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-[#7C3AED]">
          <Link href="/privacy" className="transition-colors hover:text-[#8b5cf6] hover:underline">Privacy Notice</Link>
          <span className="text-gray-700">|</span>
          <Link href="/terms" className="transition-colors hover:text-[#8b5cf6] hover:underline">Terms of Service</Link>
          <span className="text-gray-700">|</span>
          <Link href="/terms#intellectual-property" className="transition-colors hover:text-[#8b5cf6] hover:underline">IP Notice</Link>
        </div>

        <p className="mt-4 px-4 text-center text-[12px] leading-relaxed text-gray-500">
          By accessing the Fable Console and related services you agree to the{" "}
          <Link href="/terms" className="underline hover:text-white/80">Terms of Service</Link> and acknowledge the{" "}
          <Link href="/privacy" className="underline hover:text-white/80">Privacy Notice</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
