import { NextRequest, NextResponse } from 'next/server';
import { verifySessionValue } from '@/lib/session';

const COOKIE_NAME = 'ratetap_session';

// Security headers applied to all responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Apply security headers to all responses
  const addHeaders = (res: NextResponse) => {
    for (const [key, value] of Object.entries(securityHeaders)) {
      res.headers.set(key, value);
    }
    return res;
  };

  // Protected app routes — require valid session
  const isAppRoute = pathname.startsWith('/dashboard') ||
    pathname.startsWith('/overview') ||
    pathname.startsWith('/analytics') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/staff') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/feedback') ||
    pathname.startsWith('/live');

  if (isAppRoute) {
    const cookie = req.cookies.get(COOKIE_NAME)?.value;

    if (!cookie) {
      return addHeaders(NextResponse.redirect(new URL('/login', req.url)));
    }

    const session = await verifySessionValue(cookie);
    if (!session) {
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.delete(COOKIE_NAME);
      return addHeaders(res);
    }
  }

  return addHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/overview/:path*',
    '/analytics/:path*',
    '/inbox/:path*',
    '/staff/:path*',
    '/settings/:path*',
    '/feedback/:path*',
    '/live/:path*',
    '/api/:path*',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/r/:path*',
  ],
};
