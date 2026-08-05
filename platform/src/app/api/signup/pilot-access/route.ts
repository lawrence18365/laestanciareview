import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import {
  createPilotAccessToken,
  isValidPilotCode,
  PILOT_ACCESS_COOKIE,
  PILOT_ACCESS_TTL_SECONDS,
} from '@/lib/pilot';

const VALIDATION_LIMIT = 5;
const VALIDATION_WINDOW = 10 * 60_000;

export async function GET(req: NextRequest) {
  const ip = getClientIP(req);
  const limit = await checkRateLimitAsync(
    `pilot-code-validation:${ip}`,
    VALIDATION_LIMIT,
    VALIDATION_WINDOW,
  );
  if (!limit.allowed) return rateLimitResponse(limit.resetAt);

  const candidate = req.nextUrl.searchParams.get('pilot');
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('return_to'));
  const response = NextResponse.redirect(new URL(returnTo, req.url));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');

  if (isValidPilotCode(candidate)) {
    const token = createPilotAccessToken();
    if (token) {
      response.cookies.set(PILOT_ACCESS_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: PILOT_ACCESS_TTL_SECONDS,
      });
    }
  } else {
    response.cookies.delete(PILOT_ACCESS_COOKIE);
  }

  return response;
}

function safeReturnPath(value: string | null): string {
  if (!value) return '/contacto';
  try {
    const url = new URL(value, 'https://ratetap.invalid');
    return url.origin === 'https://ratetap.invalid' && url.pathname === '/contacto'
      ? `${url.pathname}${url.search}`
      : '/contacto';
  } catch {
    return '/contacto';
  }
}
