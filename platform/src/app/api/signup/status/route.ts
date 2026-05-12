import { NextRequest } from 'next/server';
import { db } from '@/db';
import { pendingSignups, restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createSession } from '@/lib/session';
import { generateQrDataUrl, reviewUrlFor } from '@/lib/qr';
import { verifyTokenHash } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const signupId = req.nextUrl.searchParams.get('signup_id');
  const token = req.nextUrl.searchParams.get('token');

  if (!signupId || !token || !signupId.startsWith('ps_')) {
    return Response.json({ error: 'Missing signup token' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(pendingSignups)
    .where(eq(pendingSignups.id, signupId))
    .limit(1);
  const pending = rows[0];
  if (!pending) return Response.json({ error: 'Signup not found' }, { status: 404 });

  if (pending.expiresAt.getTime() < Date.now()) {
    return Response.json({ error: 'Signup token expired' }, { status: 410 });
  }

  const validToken = await verifyTokenHash(token, pending.statusTokenHash);
  if (!validToken) return Response.json({ error: 'Invalid signup token' }, { status: 403 });

  if (!pending.restaurantId) return Response.json({ ready: false });

  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, pending.restaurantId))
    .limit(1);
  const r = restaurantRows[0];
  if (!r) return Response.json({ ready: false });

  // Provision session cookie only after the unguessable onboarding token matches.
  await createSession(r.slug, r.isOwner ? 'owner' : 'gm');

  const qrDataUrl = await generateQrDataUrl(r.slug);

  return Response.json({
    ready: true,
    slug: r.slug,
    restaurantName: r.name,
    reviewUrl: reviewUrlFor(r.slug),
    qrDataUrl,
    trialEndsAt: r.trialEndsAt,
  });
}
