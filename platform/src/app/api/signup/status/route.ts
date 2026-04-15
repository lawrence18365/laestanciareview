import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe } from '@/lib/stripe';
import { createSession } from '@/lib/session';
import { generateQrDataUrl, reviewUrlFor } from '@/lib/qr';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return Response.json({ error: 'Missing session_id' }, { status: 400 });
  }

  let subscriptionId: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.subscription) {
      subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    }
  } catch (err) {
    console.error('[signup/status] Stripe retrieve failed:', err);
    return Response.json({ ready: false });
  }

  if (!subscriptionId) return Response.json({ ready: false });

  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscriptionId))
    .limit(1);
  const r = rows[0];
  if (!r) return Response.json({ ready: false });

  // Provision session cookie so the user is auto-logged-in when they click into the dashboard
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
