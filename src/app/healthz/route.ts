// The cluster's probe: 200 whenever the server is up. No checks, no data.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });
}
