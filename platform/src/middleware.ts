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
  // 'unsafe-inline' on script-src is still needed for Next's bootstrap script,
  // but 'unsafe-eval' is not — dropping it disables Function()/eval injection
  // sinks. Style still needs 'unsafe-inline' for inline <style> blocks until
  // we move every inline style to a stylesheet.
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://maps.googleapis.com https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https:",
    "frame-src https://www.googletagmanager.com https://js.stripe.com",
    "form-action 'self' https://checkout.stripe.com",
  ].join('; '),
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
    pathname.startsWith('/insights') ||
    pathname.startsWith('/analytics') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/staff') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/feedback') ||
    pathname.startsWith('/live') ||
    pathname.startsWith('/guests') ||
    pathname.startsWith('/leads') ||
    pathname.startsWith('/commercial-leads') ||
    pathname.startsWith('/vip-vino') ||
    pathname.startsWith('/admin') ||
    // Founder prospect board — lists hundreds of prospect phone numbers.
    // Exact match + trailing slash so the public /prospects-us page stays open.
    pathname === '/prospects' ||
    pathname.startsWith('/prospects/');

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
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|logos/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml)$).*)',
  ],
};
