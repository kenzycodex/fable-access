import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const hasAuthCookie = request.cookies.has('fable_auth');
  const path = request.nextUrl.pathname;
  
  // Exclude auth-related routes from protection
  const isAuthRoute = path === '/dashboard/login' || 
                      path === '/dashboard/forgot-password' || 
                      path === '/dashboard/reset-password';
                      
  const isDashboardRoute = path.startsWith('/dashboard');

  // If already authenticated, do not allow visiting login/reset pages
  if (isAuthRoute && hasAuthCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // If unauthenticated, bounce from dashboard routes directly to login
  if (isDashboardRoute && !isAuthRoute && !hasAuthCookie) {
    return NextResponse.redirect(new URL('/dashboard/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
