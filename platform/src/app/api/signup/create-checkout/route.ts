import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { signupSchema, type SignupInput } from '@/lib/validations';
import { hashPassword } from '@/lib/auth';
import { TRIAL_DAYS } from '@/lib/stripe';
import { requireSameOrigin } from '@/lib/origin';
import { db } from '@/db';
import { commercialLeads, pendingSignups } from '@/db/schema';
import { randomToken, tokenHash } from '@/lib/tokens';
import { trackCommercialEvent, upsertCommercialLead } from '@/lib/commercial-tracking';
import { sendOwnerSignupNotification, sendWelcomeEmail } from '@/lib/email';
import { eq } from 'drizzle-orm';
import {
  isValidPilotAccessToken,
  PILOT_ACCESS_COOKIE,
  PILOT_TRIAL_DAYS,
} from '@/lib/pilot';
import { provisionSignupAtomic } from '@/lib/signup-provisioning';
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

    // The retired founder flow charged a one-time MX$1,500 NFC + setup fee in
    // Stripe `payment` mode and then created the trial off-session — the Stripe
    // webhook ignored `payment`-mode sessions, so money was taken and nothing
    // provisioned. Self-serve trials are free and QR-only now, so any request
    // that still asks for that flow is rejected rather than charged.
    if (!isPilot && isRetiredSetupFeeRequest(input)) {
      return Response.json(
        {
          error:
            'El pago de instalación ya no es necesario. Activa tu prueba gratis desde /contacto.',
        },
        { status: 400 },
      );
    }

    const trialDays = isPilot ? PILOT_TRIAL_DAYS : TRIAL_DAYS;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
    const passwordHash = await hashPassword(input.password);
    const pendingSignupId = `ps_${randomToken(18)}`;
    const statusToken = randomToken();
    const statusTokenHash = await tokenHash(statusToken);
    const shippingAddress = input.shippingAddress ? JSON.stringify(input.shippingAddress) : null;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const source = input.source || 'app_contacto';
    const landingPath = stripPilotQueryParam(input.landingPath || '/contacto');
    const offer = isPilot ? 'founder_pilot' : (input.offer || 'trial_checkout');
    const sourceTag = isPilot ? 'pilot' : 'self_serve';
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
      status: isPilot ? 'pilot_pending' : 'trial_pending',
    });

    // Both flows provision immediately: the restaurant is live the moment the
    // form is submitted. Only the pilot flag, trial length, and offer differ.
    // No Stripe call, no STRIPE_* env var required.
    let restaurant: { id: number; slug: string };

    try {
      restaurant = await provisionSignupAtomic({
        businessName: input.businessName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        city: input.city,
        googlePlaceId: input.googlePlaceId,
        passwordHash,
        shippingAddress,
        trialEndsAt,
        pilot: isPilot,
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
        source: sourceTag,
        path: landingPath,
        metadata: { pending_signup_id: pendingSignupId, offer },
      }),
      trackCommercialEvent({
        eventName: isPilot ? 'pilot_signup_completed' : 'restaurant_activated',
        leadId: lead.id,
        restaurantId: restaurant.id,
        source: sourceTag,
        path: landingPath,
        metadata: {
          pending_signup_id: pendingSignupId,
          subscription_status: 'trialing',
          trial_days: trialDays,
          pilot: isPilot,
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
          trialDays,
          pilot: isPilot,
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
            trialDays,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[signup/create-checkout] error:', msg);
    return Response.json(
      { error: pilotRequest ? 'No se pudo activar el piloto' : 'No se pudo activar tu cuenta' },
      { status: 500 },
    );
  }
}

/**
 * True when the caller explicitly asks for the retired MX$1,500 setup-fee
 * checkout (old `/contacto?offer=setup_fee` links, or a client sending the
 * `setup_fee_then_trial` flow tag in `metadata`).
 */
function isRetiredSetupFeeRequest(input: SignupInput): boolean {
  const flow = input.metadata?.flow;
  if (typeof flow === 'string' && flow.toLowerCase().includes('setup_fee')) return true;
  const offer = (input.offer ?? '').toLowerCase();
  return offer === 'setup_fee' || offer === 'setup_fee_then_trial';
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
