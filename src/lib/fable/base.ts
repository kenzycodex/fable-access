// Where the Fable API is reached from.
//
// In the browser it is NEXT_PUBLIC_FABLE_API_URL, which is a same-origin path
// (/fable-api) when the site and the API run together in one cluster, so the
// browser only ever talks to the site's own address. On the server the API is
// reached directly by its internal name when FABLE_INTERNAL_API_URL is set, and
// the public value is used otherwise (local development, Vercel).
const PUBLIC_API = process.env.NEXT_PUBLIC_FABLE_API_URL ?? "http://localhost:8000";

export const API_BASE = (
  typeof window === "undefined" && process.env.FABLE_INTERNAL_API_URL ? process.env.FABLE_INTERNAL_API_URL : PUBLIC_API
).replace(/\/+$/, "");
