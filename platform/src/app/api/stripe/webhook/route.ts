import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/db';
import { restaurants, processedStripeEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe, STRIPE_WEBHOOK_SECRET, TRIAL_DAYS } from '@/lib/stripe';
import { generateUniqueSlug } from '@/lib/slug';
import { generateQrDataUrl, reviewUrlFor } from '@/lib/qr';
import {
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendReceiptEmail,
  sendPaymentFailedEmail,
  sendOwnerSignupNotification,
  sendOwnerConversionNotification,
  sendOwnerTrialLapsedNotification,
} from '@/lib/email';
import { sendTrialEndingSms } from '@/lib/sms';
import { sendPurchaseEvent } from '@/lib/meta-conversions';
import { sendWhatsAppWelcome } from '@/lib/whatsapp';

export const runtime = 'nodejs';
// Webhooks must not be statically analyzed / cached
export const dynamic = 'force-dynamic';

type SignupMetadata = {
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  googlePlaceId?: string;
  passwordHash?: string;
  shippingAddress?: string;
};

export async function POST(req: NextRequest) {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set');
    return new Response('Webhook not configured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const body = await req.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // Idempotency — skip if we've already processed this event
  try {
    await db.insert(processedStripeEvents).values({ eventId: event.id });
  } catch {
    // Primary key conflict → already processed
    return Response.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // ignore other events
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err);
    // Remove idempotency marker so Stripe retries
    await db.delete(processedStripeEvents).where(eq(processedStripeEvents.eventId, event.id));
    return new Response('Handler error', { status: 500 });
  }

  return Response.json({ received: true });
}

// ─────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription' || !session.subscription || !session.customer) {
    console.warn('[stripe-webhook] checkout.session.completed skipped (not a subscription)');
    return;
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;

  // Short-circuit if we've already provisioned this subscription
  const existing = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscriptionId))
    .limit(1);
  if (existing.length > 0) return;

  const md = (session.metadata ?? {}) as SignupMetadata;
  if (!md.email || !md.businessName || !md.passwordHash) {
    console.error('[stripe-webhook] missing required metadata on checkout session', session.id);
    return;
  }

  const slug = await generateUniqueSlug(md.businessName);

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const trialEndsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(restaurants).values({
    name: md.businessName,
    slug,
    managerEmail: md.email,
    contactName: md.contactName ?? null,
    city: md.city ?? null,
    managerPhone: md.phone ?? null,
    googlePlaceId: md.googlePlaceId || null,
    googleReviewUrl: md.googlePlaceId
      ? `https://search.google.com/local/writereview?placeid=${md.googlePlaceId}`
      : null,
    adminPasswordHash: md.passwordHash,
    shippingAddress: md.shippingAddress ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: 'trialing',
    trialEndsAt,
  });

  const qrDataUrl = await generateQrDataUrl(slug);
  const reviewUrl = reviewUrlFor(slug);

  await Promise.allSettled([
    sendWelcomeEmail({
      to: md.email,
      restaurantName: md.businessName,
      slug,
      qrDataUrl,
      reviewUrl,
      trialEndsAt,
    }),
    sendOwnerSignupNotification({
      restaurantName: md.businessName,
      contactName: md.contactName ?? '',
      email: md.email,
      phone: md.phone ?? '',
      city: md.city ?? '',
      slug,
      googlePlaceId: md.googlePlaceId || undefined,
    }),
    md.phone
      ? sendWhatsAppWelcome({
          to: md.phone,
          restaurantName: md.businessName,
          trialEndsAt,
        })
      : Promise.resolve(),
  ]);
}

async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscription.id))
    .limit(1);
  const r = rows[0];
  if (!r || !r.managerEmail) return;

  const amount = priceAmountMxn(subscription);
  const daysLeft = subscription.trial_end
    ? Math.max(1, Math.ceil((subscription.trial_end * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
    : 3;

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com').replace(/\\n/g, '').trim().replace(/\/$/, '');

  await Promise.allSettled([
    sendTrialEndingEmail({
      to: r.managerEmail,
      restaurantName: r.name,
      daysLeft,
      amountMxn: amount,
    }),
    r.managerPhone
      ? sendTrialEndingSms({
          to: r.managerPhone,
          restaurantName: r.name,
          daysLeft,
          amountMxn: amount,
          paymentUrl: `${baseUrl}/dashboard`,
        })
      : Promise.resolve(),
  ]);
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;

  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscriptionId))
    .limit(1);
  const r = rows[0];
  if (!r) return;

  const amountMxn = Math.round((invoice.amount_paid ?? 0) / 100);
  const periodEnd = invoice.lines.data[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const wasFirstConversion = r.nfcCardsShippedAt === null;

  await db
    .update(restaurants)
    .set({
      subscriptionStatus: 'active',
      ...(wasFirstConversion ? { nfcCardsShippedAt: new Date() } : {}),
    })
    .where(eq(restaurants.id, r.id));

  if (r.managerEmail) {
    await sendReceiptEmail({
      to: r.managerEmail,
      restaurantName: r.name,
      amountMxn,
      periodEnd,
      invoiceUrl: invoice.hosted_invoice_url ?? undefined,
    });
  }

  if (wasFirstConversion) {
    // Owner ship-NFC email + Meta Purchase event
    let shipping: OwnerConversionShipping = {
      line1: '—',
      city: r.city ?? '—',
      state: '—',
      postalCode: '—',
    };
    if (r.shippingAddress) {
      try {
        const parsed = JSON.parse(r.shippingAddress);
        shipping = { ...shipping, ...parsed };
      } catch {
        /* ignore parse errors */
      }
    }

    await Promise.allSettled([
      sendOwnerConversionNotification({
        restaurantName: r.name,
        contactName: r.contactName ?? 'Desconocido',
        email: r.managerEmail ?? '',
        phone: r.managerPhone ?? '',
        shippingAddress: shipping,
        amountMxn,
      }),
      r.managerEmail
        ? sendPurchaseEvent({
            email: r.managerEmail,
            phone: r.managerPhone ?? undefined,
            valueMxn: amountMxn,
            eventId: invoice.id ?? `inv_${r.id}_${Date.now()}`,
          })
        : Promise.resolve(),
    ]);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;

  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscriptionId))
    .limit(1);
  const r = rows[0];
  if (!r) return;

  await db
    .update(restaurants)
    .set({ subscriptionStatus: 'past_due' })
    .where(eq(restaurants.id, r.id));

  if (r.managerEmail) {
    const amountMxn = Math.round((invoice.amount_due ?? 0) / 100);
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com').replace(/\\n/g, '').trim().replace(/\/$/, '');
    await sendPaymentFailedEmail({
      to: r.managerEmail,
      restaurantName: r.name,
      amountMxn,
      updatePaymentUrl: `${baseUrl}/dashboard`,
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscription.id))
    .limit(1);
  const r = rows[0];
  if (!r) return;

  const wasTrial = r.subscriptionStatus === 'trialing';

  await db
    .update(restaurants)
    .set({ subscriptionStatus: 'canceled' })
    .where(eq(restaurants.id, r.id));

  if (wasTrial && r.nfcCardsShippedAt === null) {
    await sendOwnerTrialLapsedNotification({
      restaurantName: r.name,
      contactName: r.contactName,
      email: r.managerEmail,
    });
  }
}

// ─────────────────────────────────────────────────────────────

type OwnerConversionShipping = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  notes?: string;
};

function priceAmountMxn(subscription: Stripe.Subscription): number {
  const item = subscription.items.data[0];
  const unit = item?.price?.unit_amount ?? 0;
  const qty = item?.quantity ?? 1;
  return Math.round((unit * qty) / 100);
}

function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}
