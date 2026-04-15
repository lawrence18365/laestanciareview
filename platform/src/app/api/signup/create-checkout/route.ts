import { NextRequest } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { signupSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/auth';
import { getStripe, STRIPE_PRICE_ID, TRIAL_DAYS } from '@/lib/stripe';

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW = 10 * 60_000; // 5 signups per 10 min per IP

export async function POST(req: NextRequest) {
  try {
    if (!STRIPE_PRICE_ID) {
      return Response.json({ error: 'Stripe not configured (missing STRIPE_PRICE_ID)' }, { status: 500 });
    }

    const ip = getClientIP(req);
    const rl = await checkRateLimitAsync(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await req.json();
    const parsed = signupSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const passwordHash = await hashPassword(input.password);

    const stripe = getStripe();
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
      .replace(/\\n/g, '')
      .trim()
      .replace(/\/$/, '');

    const signupPayload = {
      businessName: input.businessName,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      city: input.city,
      googlePlaceId: input.googlePlaceId ?? '',
      passwordHash,
      shippingAddress: JSON.stringify(input.shippingAddress),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: input.email,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        metadata: signupPayload,
      },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      locale: 'es-419',
      success_url: `${baseUrl}/bienvenida?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/contacto?canceled=1`,
      metadata: signupPayload,
    });

    return Response.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[signup/create-checkout] error:', msg);
    return Response.json({ error: 'No se pudo iniciar el pago' }, { status: 500 });
  }
}
