import { NextRequest } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { signupSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/auth';
import { getStripe, STRIPE_PRICE_ID, STRIPE_SETUP_PRICE_ID } from '@/lib/stripe';
import { requireSameOrigin } from '@/lib/origin';
import { db } from '@/db';
import { commercialLeads, pendingSignups } from '@/db/schema';
import { randomToken, tokenHash } from '@/lib/tokens';
import { trackCommercialEvent, upsertCommercialLead } from '@/lib/commercial-tracking';
import { sendOwnerLeadNotification } from '@/lib/email';
import { eq } from 'drizzle-orm';

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW = 10 * 60_000; // 5 signups per 10 min per IP
const TERMINAL_LEAD_STATUSES = new Set(['won', 'lost', 'bad_fit', 'duplicate']);

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  try {
    if (!STRIPE_PRICE_ID) {
      return Response.json({ error: 'Stripe not configured (missing STRIPE_PRICE_ID)' }, { status: 500 });
    }
    if (!STRIPE_SETUP_PRICE_ID) {
      return Response.json({ error: 'Stripe not configured (missing STRIPE_SETUP_PRICE_ID)' }, { status: 500 });
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
    const pendingSignupId = `ps_${randomToken(18)}`;
    const statusToken = randomToken();
    const statusTokenHash = await tokenHash(statusToken);
    const shippingAddress = JSON.stringify(input.shippingAddress);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const source = input.source || 'app_contacto';
    const landingPath = input.landingPath || '/contacto';
    const offer = input.offer || 'trial_checkout';

    const { lead } = await upsertCommercialLead({
      name: input.contactName,
      businessName: input.businessName,
      email: input.email,
      phone: input.phone,
      city: input.city,
      source,
      landingPath,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      offer,
      metadata: {
        ...(input.metadata ?? {}),
        google_place_id: input.googlePlaceId ?? null,
      },
    });

    const stripe = getStripe();
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
      .replace(/\\n/g, '')
      .trim()
      .replace(/\/$/, '');

    await db.insert(pendingSignups).values({
      id: pendingSignupId,
      statusTokenHash,
      leadId: lead.id,
      businessName: input.businessName,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      city: input.city,
      googlePlaceId: input.googlePlaceId ?? null,
      passwordHash,
      shippingAddress,
      expiresAt,
    });

    const signupPayload = { pendingSignupId };

    // Offer: charge the one-time NFC + setup fee TODAY, save the card, and start
    // the 30-day free subscription trial from that saved card in the webhook
    // (handleSetupFeeCheckout). A one-time line item in subscription mode would
    // bill at trial end, not now — so the fee runs through `payment` mode and the
    // subscription is created off-session afterward.
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: input.email,
      customer_creation: 'always',
      line_items: [{ price: STRIPE_SETUP_PRICE_ID, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: signupPayload,
      },
      allow_promotion_codes: true,
      locale: 'es-419',
      success_url: `${baseUrl}/bienvenida?signup_id=${encodeURIComponent(pendingSignupId)}&token=${encodeURIComponent(statusToken)}`,
      cancel_url: `${baseUrl}/contacto?canceled=1`,
      metadata: { ...signupPayload, flow: 'setup_fee_then_trial' },
    });

    await db
      .update(pendingSignups)
      .set({ checkoutSessionId: session.id })
      .where(eq(pendingSignups.id, pendingSignupId));

    await trackCommercialEvent({
      eventName: 'checkout_started',
      leadId: lead.id,
      source,
      path: landingPath,
      metadata: {
        pending_signup_id: pendingSignupId,
        checkout_session_id: session.id,
        offer,
      },
    });

    const nextAction = `Check whether ${input.businessName} completed Stripe checkout; follow up if abandoned.`;
    const shouldFollowUp = !TERMINAL_LEAD_STATUSES.has(lead.status);
    if (shouldFollowUp) {
      await db
        .update(commercialLeads)
        .set({
          nextAction,
          nextActionAt: new Date(Date.now() + 30 * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(commercialLeads.id, lead.id));
    }

    if (shouldFollowUp) {
      await sendOwnerLeadNotification({
        leadId: lead.id,
        businessName: input.businessName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        city: input.city,
        source,
        offer,
        landingPath,
        nextAction,
      }).catch((err) => {
        console.error('[signup/create-checkout] owner notification failed:', err);
      });
    }

    return Response.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[signup/create-checkout] error:', msg);
    return Response.json({ error: 'No se pudo iniciar el pago' }, { status: 500 });
  }
}
