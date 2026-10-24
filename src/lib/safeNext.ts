/** A `?next=` value only when it is a path on this site, else `fallback`.
 * "//host" and "/\host" are read by browsers as another site, so a backslash
 * anywhere is refused too. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  const value = next ?? "";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}
