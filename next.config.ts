import type { NextConfig } from "next";

/** Security headers.
 *
 * There were none: no CSP, no HSTS, no X-Frame-Options, no
 * X-Content-Type-Options. Two of those matter concretely here.
 *
 * Without frame-ancestors, the console and the demo bank can be framed, and
 * clickjacking a Ghost *release* button is directly monetisable — it is the
 * highest-value action in the product.
 *
 * Without a CSP, any injected script has free rein over the origin, including
 * the session token. That exposure is much smaller now that the institution's
 * API key no longer lives in the browser at all, but defence in depth is the
 * point.
 *
 * The CSP is deliberately not maximally strict: Next injects inline styles and
 * bootstrap scripts, so 'unsafe-inline' stays for now. Tightening it needs a
 * nonce-based setup, which is a separate change and easy to get subtly wrong.
 * connect-src has to allow the API origin plus the two free geocoders the SDK
 * falls back to.
 */
const API_ORIGIN = (() => {
  try {
    // Just the origin: a path or trailing slash in the env value must not
    // narrow what the policy allows.
    return process.env.NEXT_PUBLIC_FABLE_API_URL ? new URL(process.env.NEXT_PUBLIC_FABLE_API_URL).origin : "";
  } catch {
    return "";
  }
})();

// While developing, any local API port is allowed. This file is read once when
// the dev server starts, so a policy built from one port blocks the API the
// moment .env.local points at another, until a restart nobody thinks to do.
// Never applied to a production build.
const LOCAL_API = process.env.NODE_ENV === "production" ? [] : ["http://localhost:*", "http://127.0.0.1:*"];

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  // The single most valuable line here: nothing may frame this app.
  "frame-ancestors 'none'",
  "object-src 'none'",
  // 'unsafe-eval' only while developing: Next's dev server needs it for fast
  // refresh, and a production build does not.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // data: covers institution logos, which are stored and served as data URIs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    API_ORIGIN,
    ...LOCAL_API,
    "https://nominatim.openstreetmap.org",
    "https://api.bigdatacloud.net",
    "https://ipapi.co",
  ].filter(Boolean).join(" "),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // WebAuthn needs the publickey-credentials APIs; nothing else is used.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// Running in the Forge cluster, the site is the one published Service and the
// API is an internal one. The browser calls /fable-api on the site's own
// address and the site forwards it to the API inside the cluster, so nothing
// outside ever needs to reach the API. The destination is fixed at build time.
const INTERNAL_API = (process.env.FABLE_INTERNAL_API_URL ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // A small self-contained server for the container image. Off elsewhere
  // (Vercel and local development build as before).
  output: process.env.FABLE_STANDALONE ? "standalone" : undefined,
  experimental: {
    // Keep a visited dynamic screen in the client cache for three minutes, so
    // going back to it is instant. Safe here: the demo and console screens
    // fetch their data in the browser, so the cached part holds no live data.
    staleTimes: { dynamic: 180 },
  },
  async rewrites() {
    return INTERNAL_API ? [{ source: "/fable-api/:path*", destination: `${INTERNAL_API}/:path*` }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    // Fallback for below-the-fold assets not yet mirrored into /public.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "fable.ng",
        pathname: "/wp-content/uploads/**",
      },
    ],
  },
};

export default nextConfig;
