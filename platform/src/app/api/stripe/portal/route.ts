import { NextRequest } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant?.stripeCustomerId) {
    return Response.json({ error: 'No Stripe customer found' }, { status: 404 });
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');

  try {
    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: restaurant.stripeCustomerId,
      return_url: `${baseUrl}/dashboard`,
    });
    return Response.json({ url: portalSession.url });
  } catch (err) {
    console.error('[stripe-portal] failed to create portal session:', err);
    return Response.json({ error: 'No se pudo abrir el portal de pago' }, { status: 500 });
  }
}
