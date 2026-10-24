// A single, wordless loading indicator used everywhere in the demo: a rolling
// ring in the institution's brand colour (via the --brand-primary CSS variable
// the layout injects). No "use client" — it has no interactivity, so it can be
// dropped into server components like loading.tsx without a client boundary.

export function Spinner({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em] ${className}`.trim()}
      style={{ width: size, height: size, color: "var(--brand-primary, #7C3AED)" }}
    />
  );
}

/** Full-height centred spinner for page/route-level loading states. */
export function PageSpinner({ minh = "60vh" }: { minh?: string }) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: minh }}>
      <Spinner size={32} />
    </div>
  );
}
