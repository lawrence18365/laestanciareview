import { NextRequest, NextResponse } from 'next/server';
import {
  serializeSignupAccess,
  SIGNUP_ACCESS_COOKIE,
  SIGNUP_ACCESS_TTL_SECONDS,
} from '@/lib/signup-access';

export async function GET(req: NextRequest) {
  const signupId = req.nextUrl.searchParams.get('signup_id');
  const token = req.nextUrl.searchParams.get('token');
  const response = NextResponse.redirect(new URL('/bienvenida', req.url));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');

  if (signupId?.startsWith('ps_') && token) {
    response.cookies.set(SIGNUP_ACCESS_COOKIE, serializeSignupAccess(signupId, token), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SIGNUP_ACCESS_TTL_SECONDS,
    });
  } else {
    response.cookies.delete(SIGNUP_ACCESS_COOKIE);
  }

  return response;
}
