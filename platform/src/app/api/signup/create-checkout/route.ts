import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { signupSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/auth';
import { getStripe, STRIPE_PRICE_ID, STRIPE_SETUP_PRICE_ID } from '@/lib/stripe';
import { requireSameOrigin } from '@/lib/origin';
import { db } from '@/db';
import { commercialLeads, pendingSignups } from '@/db/schema';
import { randomToken, tokenHash } from '@/lib/tokens';
import { trackCommercialEvent, upsertCommercialLead } from '@/lib/commercial-tracking';
import {
  sendOwnerLeadNotification,
  sendOwnerSignupNotification,
  sendWelcomeEmail,
} from '@/lib/email';
import { eq } from 'drizzle-orm';
import {
  isValidPilotAccessToken,
  PILOT_ACCESS_COOKIE,
  PILOT_TRIAL_DAYS,
} from '@/lib/pilot';
import { provisionPilotSignupAtomic } from '@/lib/signup-provisioning';
import { generateQrDataUrl, reviewUrlFor } from '@/lib/qr';
import { sendWhatsAppWelcome } from '@/lib/whatsapp';
import { sendCompleteRegistrationEvent } from '@/lib/meta-conversions';
import {
  serializeSignupAccess,
  SIGNUP_ACCESS_COOKIE,
  SIGNUP_ACCESS_TTL_SECONDS,
} from '@/lib/signup-access';

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW = 10 * 60_000; // 5 signups per 10 min per IP
const TERMINAL_LEAD_STATUSES = new Set(['won', 'lost', 'bad_fit', 'duplicate']);

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  let pilotRequest = false;
  try {
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
    const isPilot = isValidPilotAccessToken(req.cookies.get(PILOT_ACCESS_COOKIE)?.value);
    pilotRequest = isPilot;

    if (!isPilot && !STRIPE_PRICE_ID) {
      return Response.json({ error: 'Stripe not configured (missing STRIPE_PRICE_ID)' }, { status: 500 });
    }
    if (!isPilot && !STRIPE_SETUP_PRICE_ID) {
      return Response.json({ error: 'Stripe not configured (missing STRIPE_SETUP_PRICE_ID)' }, { status: 500 });
    }

    const passwordHash = await hashPassword(input.password);
    const pendingSignupId = `ps_${randomToken(18)}`;
    const statusToken = randomToken();
    const statusTokenHash = await tokenHash(statusToken);
    const shippingAddress = JSON.stringify(input.shippingAddress);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const source = input.source || 'app_contacto';
    const landingPath = stripPilotQueryParam(input.landingPath || '/contacto');
    const offer = isPilot ? 'founder_pilot' : (input.offer || 'trial_checkout');
    const metadata = { ...(input.metadata ?? {}) };
    if (typeof metadata.landing_url === 'string') {
      metadata.landing_url = stripPilotQueryParam(metadata.landing_url);
    }

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
        ...metadata,
        google_place_id: input.googlePlaceId ?? null,
        pilot: isPilot,
      },
    });

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
      status: isPilot ? 'pilot_pending' : 'checkout_started',
    });

    if (isPilot) {
      const trialEndsAt = new Date(Date.now() + PILOT_TRIAL_DAYS * 24 * 60 * 60 * 1000);
      let restaurant: { id: number; slug: string };

      try {
        restaurant = await provisionPilotSignupAtomic({
          businessName: input.businessName,
          contactName: input.contactName,
          email: input.email,
          phone: input.phone,
          city: input.city,
          googlePlaceId: input.googlePlaceId,
          passwordHash,
          shippingAddress,
          trialEndsAt,
          pilot: true,
          pendingSignupId,
          leadId: lead.id,
        });
      } catch (err) {
        await db.delete(pendingSignups).where(eq(pendingSignups.id, pendingSignupId));
        if (isPilotLimitError(err)) return pilotLimitResponse();
        throw err;
      }

      await Promise.allSettled([
        db
          .update(commercialLeads)
          .set({
            status: 'won',
            wonAt: new Date(),
            nextAction: null,
            nextActionAt: null,
            updatedAt: new Date(),
          })
          .where(eq(commercialLeads.id, lead.id)),
        trackCommercialEvent({
          eventName: 'lead_won',
          leadId: lead.id,
          restaurantId: restaurant.id,
          source: 'pilot',
          path: landingPath,
          metadata: { pending_signup_id: pendingSignupId, offer },
        }),
        trackCommercialEvent({
          eventName: 'pilot_signup_completed',
          leadId: lead.id,
          restaurantId: restaurant.id,
          source: 'pilot',
          path: landingPath,
          metadata: {
            pending_signup_id: pendingSignupId,
            subscription_status: 'trialing',
            trial_days: PILOT_TRIAL_DAYS,
          },
        }),
        (async () => {
          const qrDataUrl = await generateQrDataUrl(restaurant.slug);
          await sendWelcomeEmail({
            to: input.email,
            restaurantName: input.businessName,
            slug: restaurant.slug,
            qrDataUrl,
            reviewUrl: reviewUrlFor(restaurant.slug),
            trialEndsAt,
            trialDays: PILOT_TRIAL_DAYS,
            pilot: true,
          });
        })(),
        sendOwnerSignupNotification({
          restaurantName: input.businessName,
          contactName: input.contactName,
          email: input.email,
          phone: input.phone,
          city: input.city,
          slug: restaurant.slug,
          googlePlaceId: input.googlePlaceId,
        }),
        input.phone
          ? sendWhatsAppWelcome({
              to: input.phone,
              restaurantName: input.businessName,
              trialEndsAt,
              trialDays: PILOT_TRIAL_DAYS,
            })
          : Promise.resolve(),
        sendCompleteRegistrationEvent({
          email: input.email,
          phone: input.phone,
          eventId: pendingSignupId,
        }),
      ]);

      const response = NextResponse.json({
        url: `${baseUrl}/bienvenida`,
      });
      response.cookies.set(
        SIGNUP_ACCESS_COOKIE,
        serializeSignupAccess(pendingSignupId, statusToken),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: SIGNUP_ACCESS_TTL_SECONDS,
        },
      );
      response.cookies.delete(PILOT_ACCESS_COOKIE);
      return response;
    }

    const signupPayload = { pendingSignupId };
    const stripe = getStripe();

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
    return Response.json(
      { error: pilotRequest ? 'No se pudo activar el piloto' : 'No se pudo iniciar el pago' },
      { status: 500 },
    );
  }
}

function isPilotLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = 'message' in err ? String((err as { message?: unknown }).message) : '';
  const cause = 'cause' in err ? (err as { cause?: unknown }).cause : null;
  const causeMessage = cause && typeof cause === 'object' && 'message' in cause
    ? String((cause as { message?: unknown }).message)
    : '';
  return message.includes('pilot_signup_limit_reached') || causeMessage.includes('pilot_signup_limit_reached');
}

function pilotLimitResponse() {
  return Response.json(
    { error: 'Los lugares del piloto fundador ya están ocupados.' },
    { status: 409 },
  );
}

function stripPilotQueryParam(value: string): string {
  try {
    const url = new URL(value, 'https://ratetap.invalid');
    if (!url.searchParams.has('pilot')) return value;
    url.searchParams.delete('pilot');

    if (/^https?:\/\//i.test(value)) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}
