import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/db';
import { commercialLeads, restaurants, processedStripeEvents, pendingSignups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, TRIAL_DAYS } from '@/lib/stripe';
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
import { sendPurchaseEvent, sendCompleteRegistrationEvent } from '@/lib/meta-conversions';
import { sendWhatsAppWelcome } from '@/lib/whatsapp';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

export const runtime = 'nodejs';
// Webhooks must not be statically analyzed / cached
export const dynamic = 'force-dynamic';

type SignupMetadata = {
  pendingSignupId?: string;
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  googlePlaceId?: string;
  passwordHash?: string;
  shippingAddress?: string;
};

type SignupRecord = {
  pendingSignupId?: string;
  leadId?: number | null;
  businessName: string;
  contactName?: string | null;
  email: string;
  phone?: string | null;
  city?: string | null;
  googlePlaceId?: string | null;
  passwordHash: string;
  shippingAddress?: string | null;
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
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
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

/**
 * Resolve the subscription tied to a completed checkout session.
 *
 * - Legacy `subscription`-mode sessions: Checkout already created the
 *   subscription; just retrieve it.
 * - New `payment`-mode (setup-fee) sessions: the one-time NFC/setup fee was
 *   charged today and the card saved (`setup_future_usage`). Reuse that card to
 *   start the 30-day-trial subscription off-session. Reuses an existing
 *   subscription if one is already present so Stripe retries don't double-create.
 */
async function resolveSubscription(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  if (session.mode === 'subscription' && session.subscription) {
    const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    return stripe.subscriptions.retrieve(id);
  }

  const existing = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
  if (existing.data.length > 0) return existing.data[0];

  // Promote the card used for the setup fee to the customer's default so the
  // subscription can auto-charge once the 30-day trial ends.
  let defaultPm: string | undefined;
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    defaultPm = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
  }
  if (defaultPm) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: defaultPm },
    });
  }

  const md = (session.metadata ?? {}) as { pendingSignupId?: string };
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: STRIPE_PRICE_ID }],
    trial_period_days: TRIAL_DAYS,
    trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
    ...(defaultPm ? { default_payment_method: defaultPm } : {}),
    metadata: { pendingSignupId: md.pendingSignupId ?? '' },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (!session.customer) {
    console.warn('[stripe-webhook] checkout.session.completed skipped (no customer)');
    return;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;

  // Short-circuit if we've already provisioned this customer. Keyed on customer
  // (not subscription) because the new setup-fee flow creates the subscription
  // here, so there's no subscription id on the session yet — and this makes
  // Stripe webhook retries idempotent.
  const existing = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeCustomerId, customerId))
    .limit(1);
  if (existing.length > 0) return;

  const signup = await getSignupRecord(session);
  if (!signup) {
    console.error('[stripe-webhook] missing required metadata on checkout session', session.id);
    return;
  }

  const stripe = getStripe();
  const subscription = await resolveSubscription(stripe, session, customerId);
  if (!subscription) {
    console.error('[stripe-webhook] could not resolve/create subscription for', session.id);
    return;
  }
  const subscriptionId = subscription.id;

  const slug = await generateUniqueSlug(signup.businessName);

  const trialEndsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const [restaurant] = await db.insert(restaurants).values({
    name: signup.businessName,
    slug,
    managerEmail: signup.email,
    contactName: signup.contactName ?? null,
    city: signup.city ?? null,
    managerPhone: signup.phone ?? null,
    googlePlaceId: signup.googlePlaceId || null,
    googleReviewUrl: signup.googlePlaceId
      ? `https://search.google.com/local/writereview?placeid=${signup.googlePlaceId}`
      : null,
    adminPasswordHash: signup.passwordHash,
    shippingAddress: signup.shippingAddress ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: 'trialing',
    trialEndsAt,
  }).returning({ id: restaurants.id });

  if (signup.pendingSignupId) {
    await db
      .update(pendingSignups)
      .set({
        status: 'provisioned',
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        restaurantId: restaurant.id,
        completedAt: new Date(),
      })
      .where(eq(pendingSignups.id, signup.pendingSignupId));
  }

  if (signup.leadId) {
    await db
      .update(commercialLeads)
      .set({
        status: 'won',
        wonAt: new Date(),
        nextAction: null,
        nextActionAt: null,
        updatedAt: new Date(),
      })
      .where(eq(commercialLeads.id, signup.leadId));

    await trackCommercialEvent({
      eventName: 'lead_won',
      leadId: signup.leadId,
      restaurantId: restaurant.id,
      source: 'stripe',
      metadata: {
        pending_signup_id: signup.pendingSignupId ?? null,
        checkout_session_id: session.id,
      },
    });
  }

  await trackCommercialEvent({
    eventName: 'checkout_completed',
    leadId: signup.leadId ?? null,
    restaurantId: restaurant.id,
    source: 'stripe',
    metadata: {
      pending_signup_id: signup.pendingSignupId ?? null,
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    },
  });

  await trackCommercialEvent({
    eventName: 'restaurant_activated',
    leadId: signup.leadId ?? null,
    restaurantId: restaurant.id,
    source: 'stripe',
    metadata: {
      pending_signup_id: signup.pendingSignupId ?? null,
      subscription_status: 'trialing',
    },
  });

  const qrDataUrl = await generateQrDataUrl(slug);
  const reviewUrl = reviewUrlFor(slug);

  await Promise.allSettled([
    sendWelcomeEmail({
      to: signup.email,
      restaurantName: signup.businessName,
      slug,
      qrDataUrl,
      reviewUrl,
      trialEndsAt,
    }),
    sendOwnerSignupNotification({
      restaurantName: signup.businessName,
      contactName: signup.contactName ?? '',
      email: signup.email,
      phone: signup.phone ?? '',
      city: signup.city ?? '',
      slug,
      googlePlaceId: signup.googlePlaceId || undefined,
    }),
    signup.phone
      ? sendWhatsAppWelcome({
          to: signup.phone,
          restaurantName: signup.businessName,
          trialEndsAt,
        })
      : Promise.resolve(),
    sendCompleteRegistrationEvent({
      email: signup.email,
      phone: signup.phone ?? undefined,
      eventId: session.id,
    }),
  ]);
}

async function getSignupRecord(session: Stripe.Checkout.Session): Promise<SignupRecord | null> {
  const md = (session.metadata ?? {}) as SignupMetadata;

  if (md.pendingSignupId) {
    const rows = await db
      .select()
      .from(pendingSignups)
      .where(eq(pendingSignups.id, md.pendingSignupId))
      .limit(1);
    const pending = rows[0];
    if (!pending) return null;
    return {
      pendingSignupId: pending.id,
      leadId: pending.leadId,
      businessName: pending.businessName,
      contactName: pending.contactName,
      email: pending.email,
      phone: pending.phone,
      city: pending.city,
      googlePlaceId: pending.googlePlaceId,
      passwordHash: pending.passwordHash,
      shippingAddress: pending.shippingAddress,
    };
  }

  // Legacy fallback for checkout sessions created before pending_signups existed.
  // New sessions only store pendingSignupId in Stripe metadata.
  if (!md.email || !md.businessName || !md.passwordHash) return null;
  return {
    businessName: md.businessName,
    contactName: md.contactName ?? null,
    email: md.email,
    phone: md.phone ?? null,
    city: md.city ?? null,
    googlePlaceId: md.googlePlaceId || null,
    passwordHash: md.passwordHash,
    shippingAddress: md.shippingAddress ?? null,
  };
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

  await trackCommercialEvent({
    eventName: 'subscription_paid',
    restaurantId: r.id,
    source: 'stripe',
    metadata: {
      invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      amount_mxn: amountMxn,
      first_conversion: wasFirstConversion,
    },
  });

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

    const [ownerNotification] = await Promise.allSettled([
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

    const ownerNotificationRecipient =
      (process.env.OWNER_NOTIFICATION_EMAIL ?? '').replace(/\\n/g, '').trim()
      || (process.env.ADMIN_EMAIL ?? '').replace(/\\n/g, '').trim()
      || '(unconfigured)';

    if (ownerNotification.status === 'fulfilled' && !ownerNotification.value.success) {
      console.error(`[stripe-webhook] sendOwnerConversionNotification failed ${JSON.stringify({
        restaurant: r.name,
        to: ownerNotificationRecipient,
        responseCode: ownerNotification.value.error?.responseCode ?? null,
        message: ownerNotification.value.error?.message ?? 'SMTP send skipped',
      })}`);
    } else if (ownerNotification.status === 'rejected') {
      console.error(`[stripe-webhook] sendOwnerConversionNotification failed ${JSON.stringify({
        restaurant: r.name,
        to: ownerNotificationRecipient,
        responseCode: null,
        message: ownerNotification.reason instanceof Error
          ? ownerNotification.reason.message
          : String(ownerNotification.reason),
      })}`);
    }
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

  await trackCommercialEvent({
    eventName: 'subscription_failed',
    restaurantId: r.id,
    source: 'stripe',
    metadata: {
      invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      amount_due_mxn: Math.round((invoice.amount_due ?? 0) / 100),
    },
  });

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

/**
 * Map any Stripe subscription status to our DB's 4-state enum so the layout
 * gate can reason about it without knowing Stripe's full taxonomy.
 *
 * Anything not `active`, `trialing`, or `past_due` collapses to `canceled` —
 * including `paused`, `unpaid`, `incomplete`, `incomplete_expired`. From the
 * customer's perspective those are all "you can't use the app right now,"
 * which is what `canceled` already means in our UI.
 */
function mapStripeStatus(
  s: Stripe.Subscription.Status,
): 'active' | 'trialing' | 'past_due' | 'canceled' {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    default:
      return 'canceled';
  }
}

/**
 * Fired on any subscription mutation Stripe knows about — pause, resume,
 * plan change, trial extension, etc. Keeps our `subscriptionStatus` in sync
 * with Stripe's source of truth.
 *
 * Skips the `trialing → canceled` transition: that flow has a side-effect
 * (lapsed-trial owner email) handled by `customer.subscription.deleted`, and
 * preempting it here would silence the email.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.stripeSubscriptionId, subscription.id))
    .limit(1);
  const r = rows[0];
  if (!r) return;

  const newStatus = mapStripeStatus(subscription.status);
  if (r.subscriptionStatus === newStatus) return;

  if (r.subscriptionStatus === 'trialing' && newStatus === 'canceled') return;

  await db
    .update(restaurants)
    .set({ subscriptionStatus: newStatus })
    .where(eq(restaurants.id, r.id));
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

  await trackCommercialEvent({
    eventName: 'subscription_canceled',
    restaurantId: r.id,
    source: 'stripe',
    metadata: {
      stripe_subscription_id: subscription.id,
      previous_status: r.subscriptionStatus,
    },
  });

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
