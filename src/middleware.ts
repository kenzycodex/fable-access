import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Route guard for the console.
 *
 * This used to be `cookies.has('fable_auth')`, and the cookie's value was the
 * literal string "1". Typing `document.cookie = "fable_auth=1"` in any browser
 * console therefore granted access to the whole dashboard.
 *
 * The cookie now holds the signed session token the API issued, so there is
 * something real to inspect. What this checks is the token's *shape and
 * expiry*, not its signature: the signing secret lives on the API and should
 * not be copied into the frontend's runtime. That is deliberate and worth
 * being precise about.
 *
 *   This middleware is a routing convenience, not a security boundary.
 *
 * The security boundary is the API, which verifies the signature on every
 * request and derives the tenant from it. Someone who forges a well-formed but
 * unsigned token gets to look at an empty dashboard shell whose every data
 * call returns 401 — which is a UX outcome, not an access-control failure.
 */

function tokenIsUsable(raw: string | undefined): boolean {
  if (!raw) return false
  const parts = decodeURIComponent(raw).split('.')
  if (parts.length !== 2) return false

  try {
    // base64url -> JSON, without pulling in a dependency.
    const json = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { exp?: number; inst?: string }
    if (!payload.inst || typeof payload.exp !== 'number') return false
    return payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const signedIn = tokenIsUsable(request.cookies.get('fable_auth')?.value)

  const isAuthRoute =
    path === '/dashboard/login' ||
    path === '/dashboard/forgot-password' ||
    path === '/dashboard/reset-password'

  const isDashboardRoute = path.startsWith('/dashboard')

  if (isAuthRoute && signedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (isDashboardRoute && !isAuthRoute && !signedIn) {
    const res = NextResponse.redirect(new URL('/dashboard/login', request.url))
    // An expired or malformed token would otherwise bounce the operator between
    // /dashboard and /dashboard/login on every navigation.
    res.cookies.delete('fable_auth')
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
