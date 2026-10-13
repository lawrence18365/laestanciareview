import { NextRequest, NextResponse } from 'next/server';
import { classifyUserAgent } from '@/lib/analytics-client';
import { isAllowedRedirect, verifyTrackToken } from '@/lib/email-tracking';
import { recordProductEvent } from '@/lib/product-events';

export const dynamic = 'force-dynamic';

/** 1x1 transparent GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Open pixel (k=o) and click redirect (k=c) for welcome / trial-nurture emails.
 * See lib/email-tracking.ts for the token design. An unsigned, tampered or
 * off-allow-list request is a 400 and writes nothing.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get('k');
  const template = q.get('t') ?? '';
  const restaurantId = Number(q.get('r'));
  const target = q.get('u') ?? '';
  const sig = q.get('s') ?? '';

  if (kind !== 'o' && kind !== 'c') return new Response(null, { status: 400 });
  if (kind === 'o' && target) return new Response(null, { status: 400 });
  if (kind === 'c' && !isAllowedRedirect(target)) return new Response(null, { status: 400 });

  const valid = await verifyTrackToken({ kind, template, restaurantId, target, sig });
  if (!valid) return new Response(null, { status: 400 });

  // Scanners and prefetchers are flagged, not dropped, so trial:funnel can
  // exclude them while history stays comparable. Derived fields only.
  const { device, os, bot } = classifyUserAgent(req.headers.get('user-agent'));
  await recordProductEvent({
    name: kind === 'o' ? 'email_opened' : 'email_clicked',
    restaurantId,
    role: 'system',
    path: '/api/email/t',
    properties: {
      template,
      restaurant_id: restaurantId,
      device,
      os,
      ...(bot ? { bot: true } : {}),
    },
  });

  if (kind === 'c') return NextResponse.redirect(target, 302);

  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, private, max-age=0',
    },
  });
}
