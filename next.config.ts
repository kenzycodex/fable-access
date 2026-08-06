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
const API_ORIGIN = process.env.NEXT_PUBLIC_FABLE_API_URL ?? "";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  // The single most valuable line here: nothing may frame this app.
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // data: covers institution logos, which are stored and served as data URIs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    API_ORIGIN,
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

const nextConfig: NextConfig = {
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
