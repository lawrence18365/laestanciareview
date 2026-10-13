import { NextRequest } from 'next/server';
import { db } from '@/db';
import {
  mercadopagoSubscriptions,
  processedMercadopagoEvents,
  restaurants,
} from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  MERCADOPAGO_MONTHLY_AMOUNT_MXN,
  getAuthorizedPayment,
  getPreapproval,
  mapPreapprovalStatus,
  subscriptionBillingHasStarted,
  verifyMercadoPagoSignature,
  type MercadoPagoAuthorizedPayment,
  type MercadoPagoPreapproval,
} from '@/lib/mercadopago';
import { sendOwnerConversionNotification } from '@/lib/email';
import { selfServePrice, type BillingCycle } from '@/lib/entitlements';
import { recordProductEvent } from '@/lib/product-events';
import { sendPurchaseEvent } from '@/lib/meta-conversions';
import { parseShippingAddress } from '@/lib/shipping';

export const runtime = 'nodejs';
// Webhooks must not be statically analyzed / cached
export const dynamic = 'force-dynamic';

type MercadoPagoWebhookBody = {
  id?: string | number;
  type?: string;
  action?: string;
  data?: { id?: string | number };
};

function isUniqueViolation(err: unknown): boolean {
  const errors: unknown[] = [];
  const seen = new Set<unknown>();
  let current = err;

  while (
    current !== null &&
    (typeof current === 'object' || typeof current === 'function') &&
    !seen.has(current)
  ) {
    seen.add(current);
    errors.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  if (
    errors.some(
      (error) => (error as { code?: unknown }).code === '23505',
    )
  ) {
    return true;
  }

  const duplicateMessage = /duplicate key value|unique constraint/i;
  return (
    (typeof err === 'string' && duplicateMessage.test(err)) ||
    errors.some((error) => {
      const message = (error as { message?: unknown }).message;
      return typeof message === 'string' && duplicateMessage.test(message);
    })
  );
}

function shouldSkipPreBillingStartDowngrade(
  currentStatus: string,
  nextStatus: string,
  billingStartsAt: Date | null,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): boolean {
  const currentlyHasAccess =
    currentStatus === 'active' || currentStatus === 'trialing';
  const wouldLoseAccess = nextStatus === 'canceled' || nextStatus === 'past_due';
  // Skipping is only ever justified while the restaurant still HAS a trial to
  // protect: a cancelled/paused preapproval during the free trial must not
  // revoke the remaining days, but an account whose trial already ended has no
  // free access left to preserve and must be downgraded when MP says so.
  const trialStillRunning =
    !!trialEndsAt && trialEndsAt.getTime() > now.getTime();
  // Per-restaurant trial window: prefer the subscription row's billing start
  // over the global launch date (rows predate per-restaurant trials may be null).
  return (
    trialStillRunning &&
    !subscriptionBillingHasStarted(billingStartsAt, now) &&
    currentlyHasAccess &&
    wouldLoseAccess
  );
}

/**
 * Handle the case where the preapproval went away (cancelled/paused) while the
 * restaurant's own trial is still running: keep the free days it already has,
 * but never let them turn into free access forever.
 *
 * An account that authorized a preapproval mid-trial is `active`
 * (mapPreapprovalStatus), and `active` is not expired by anything: the
 * expire-trials cron only flips `trialing` rows. So skipping the downgrade
 * outright would leave a cancelled/paused account `active` for good once the
 * trial ends. Downgrading to `trialing` keeps the remaining trial intact and
 * hands expiry back to the cron.
 *
 * An account that is already `trialing` needs no change — the cron already
 * owns it.
 */
async function holdTrialAccessAfterPreapprovalLoss(
  restaurantId: number,
  currentStatus: string,
): Promise<void> {
  if (currentStatus !== 'active') return;

  await db
    .update(restaurants)
    .set({ subscriptionStatus: 'trialing' })
    .where(eq(restaurants.id, restaurantId));
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as MercadoPagoWebhookBody | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const dataIdRaw = body.data?.id ?? req.nextUrl.searchParams.get('data.id') ?? '';
  const dataId = String(dataIdRaw);

  // Do not call db.* until the signature check succeeds.
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response('Webhook secret not configured', { status: 503 });
  }

  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  if (!xSignature || !xRequestId) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const valid = verifyMercadoPagoSignature({
    xSignature,
    xRequestId,
    dataId,
    secret: webhookSecret,
  });
  if (!valid) {
    console.warn('[mercadopago-webhook] invalid x-signature');
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const eventKey = `${body.type ?? ''}:${body.action ?? ''}:${dataId}:${body.id ?? ''}`;

  // Idempotency — skip if we've already processed this event
  try {
    await db.insert(processedMercadopagoEvents).values({ eventId: eventKey });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json({ received: true, duplicate: true });
    }

    console.error('[mercadopago-webhook] idempotency insert error:', err);
    return new Response('Idempotency error', { status: 500 });
  }

  try {
    switch (body.type) {
      case 'subscription_preapproval':
        await handlePreapproval(dataId);
        break;
      case 'subscription_authorized_payment':
        await handleAuthorizedPayment(dataId);
        break;
      default:
        // 'payment' and anything else: acknowledge, no-op
        break;
    }
  } catch (err) {
    console.error(`[mercadopago-webhook] handler error for ${body.type}:`, err);
    // Remove idempotency marker so Mercado Pago retries
    await db
      .delete(processedMercadopagoEvents)
      .where(eq(processedMercadopagoEvents.eventId, eventKey));
    return new Response('Handler error', { status: 500 });
  }

  console.log(
    `[mercadopago-webhook] processed ${JSON.stringify({
      type: body.type ?? null,
      action: body.action ?? null,
      dataId,
      eventId: body.id ?? null,
    })}`,
  );

  return Response.json({ received: true });
}

// ─────────────────────────────────────────────────────────────

// Match ONLY by the row's stored preapprovalId — never by
// external_reference / restaurant id. A delayed cancellation webhook for an
// OLD (replaced) preapproval must not touch the NEW subscription's row, and
// external_reference is just the restaurant id, so falling through on it
// would do exactly that.
async function findSubscriptionByPreapproval(preapprovalId: string) {
  const byPreapproval = await db
    .select()
    .from(mercadopagoSubscriptions)
    .where(eq(mercadopagoSubscriptions.preapprovalId, preapprovalId))
    .limit(1);
  return byPreapproval[0] ?? null;
}

/**
 * Billing cycle of a Plan Restaurante subscription, when it can be told: the
 * preapproval's own frequency (12 months = annual) first, then the charged
 * amount against the two plan prices. Undefined when neither says.
 */
function billingCycleOf(
  subscription: typeof mercadopagoSubscriptions.$inferSelect,
  preapproval?: MercadoPagoPreapproval,
): BillingCycle | undefined {
  const frequency = (preapproval as { auto_recurring?: { frequency?: number } } | undefined)
    ?.auto_recurring?.frequency;
  if (frequency === 12) return 'annual';
  if (frequency === 1) return 'monthly';
  const charged = Number(subscription.totalAmount ?? subscription.amount);
  if (charged === selfServePrice('annual')) return 'annual';
  if (charged === selfServePrice('monthly')) return 'monthly';
  return undefined;
}

/**
 * Analytics only (US-15): the moment a self-serve restaurant becomes active.
 * Never throws and never touches the status transition. Group restaurants are
 * not part of the Plan Restaurante funnel.
 */
async function recordPlanActivated(
  restaurant: typeof restaurants.$inferSelect,
  cycle: BillingCycle | undefined,
) {
  if (restaurant.groupKey !== null) return;
  await recordProductEvent({
    name: 'plan_activated',
    restaurantId: restaurant.id,
    properties: cycle ? { cycle } : {},
  });
}

async function handlePreapproval(dataId: string) {
  if (!dataId) {
    console.warn('[mercadopago-webhook] subscription_preapproval without data.id');
    return;
  }

  const preapproval = await getPreapproval(dataId);

  const subscription = await findSubscriptionByPreapproval(dataId);
  if (!subscription) {
    console.warn(
      `[mercadopago-webhook] event for unknown/stale preapproval ${dataId}, ignoring`,
    );
    return;
  }

  await db
    .update(mercadopagoSubscriptions)
    .set({
      status: preapproval.status ?? subscription.status,
      nextPaymentDate: preapproval.next_payment_date
        ? new Date(preapproval.next_payment_date)
        : null,
      payerEmail: preapproval.payer_email ?? subscription.payerEmail,
      updatedAt: new Date(),
    })
    .where(eq(mercadopagoSubscriptions.id, subscription.id));

  const mapped = mapPreapprovalStatus(preapproval.status ?? '');
  if (!mapped) return;

  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, subscription.restaurantId))
    .limit(1);
  const restaurant = restaurantRows[0];
  if (!restaurant || restaurant.subscriptionStatus === mapped) return;

  if (
    shouldSkipPreBillingStartDowngrade(
      restaurant.subscriptionStatus,
      mapped,
      subscription.billingStartsAt,
      restaurant.trialEndsAt,
    )
  ) {
    console.log(
      `[mercadopago-webhook] pre-billing-start downgrade skipped restaurant=${restaurant.id} current=${restaurant.subscriptionStatus} mapped=${mapped}`,
    );
    await holdTrialAccessAfterPreapprovalLoss(
      restaurant.id,
      restaurant.subscriptionStatus,
    );
    return;
  }

  await db
    .update(restaurants)
    .set({ subscriptionStatus: mapped, billingProvider: 'mercadopago' })
    .where(eq(restaurants.id, restaurant.id));

  if (mapped === 'active') {
    await recordPlanActivated(restaurant, billingCycleOf(subscription, preapproval));
  }
}

async function handleAuthorizedPayment(dataId: string) {
  if (!dataId) {
    console.warn('[mercadopago-webhook] subscription_authorized_payment without data.id');
    return;
  }

  const authorizedPayment = await getAuthorizedPayment(dataId);

  const preapprovalId = authorizedPayment.preapproval_id;
  if (!preapprovalId) {
    console.warn(
      `[mercadopago-webhook] authorized payment ${dataId} has no preapproval_id`,
    );
    return;
  }

  const subscription = await findSubscriptionByPreapproval(preapprovalId);
  if (!subscription) {
    console.warn(
      `[mercadopago-webhook] event for unknown/stale preapproval ${preapprovalId}, ignoring`,
    );
    return;
  }

  const paymentStatus =
    authorizedPayment.payment?.status ?? authorizedPayment.status ?? null;
  const paymentId = authorizedPayment.payment?.id ?? authorizedPayment.id;

  await db
    .update(mercadopagoSubscriptions)
    .set({
      lastPaymentId: paymentId != null ? String(paymentId) : null,
      lastPaymentStatus: paymentStatus,
      nextPaymentDate: authorizedPayment.next_payment_date
        ? new Date(authorizedPayment.next_payment_date)
        : subscription.nextPaymentDate,
      updatedAt: new Date(),
    })
    .where(eq(mercadopagoSubscriptions.id, subscription.id));

  let newStatus: 'active' | 'past_due' | null = null;
  if (paymentStatus === 'approved') newStatus = 'active';
  else if (paymentStatus === 'rejected') newStatus = 'past_due';
  if (!newStatus) return;

  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, subscription.restaurantId))
    .limit(1);
  const restaurant = restaurantRows[0];
  if (!restaurant) return;

  // The first approved payment is the conversion moment: it is when the
  // restaurant starts paying, so it is when the physical NFC cards ship and
  // the owner is told. Independent of the status transition below (the
  // preapproval webhook may already have flipped the restaurant to active).
  if (newStatus === 'active') {
    await notifyFirstConversion(restaurant, subscription, authorizedPayment);
  }

  if (restaurant.subscriptionStatus === newStatus) return;

  if (
    shouldSkipPreBillingStartDowngrade(
      restaurant.subscriptionStatus,
      newStatus,
      subscription.billingStartsAt,
      restaurant.trialEndsAt,
    )
  ) {
    console.log(
      `[mercadopago-webhook] pre-billing-start downgrade skipped restaurant=${restaurant.id} current=${restaurant.subscriptionStatus} mapped=${newStatus}`,
    );
    await holdTrialAccessAfterPreapprovalLoss(
      restaurant.id,
      restaurant.subscriptionStatus,
    );
    return;
  }

  await db
    .update(restaurants)
    .set({ subscriptionStatus: newStatus, billingProvider: 'mercadopago' })
    .where(eq(restaurants.id, restaurant.id));

  if (newStatus === 'active') {
    await recordPlanActivated(restaurant, billingCycleOf(subscription));
  }
}

/**
 * Ship NFC cards + fire the owner/Meta conversion notifications on the FIRST
 * approved payment, mirroring the Stripe `invoice.payment_succeeded` block.
 *
 * Idempotent: the claim is a conditional update guarded by
 * `nfc_cards_shipped_at IS NULL`, and only the caller that actually flipped
 * the row sends anything. A retried webhook (or a later renewal payment)
 * updates zero rows and stays silent.
 *
 * The owner notice is the whole point of shipping here, so a notice that never
 * went out releases the claim again (only if the row still holds the timestamp
 * WE wrote) and logs loudly: the next approved payment — a real retry-bait
 * signal, unlike a webhook replay — then tries again. A failed Meta purchase
 * event is NOT worth echoing a second paid conversion for, so it never
 * releases the claim.
 */
async function notifyFirstConversion(
  restaurant: typeof restaurants.$inferSelect,
  subscription: typeof mercadopagoSubscriptions.$inferSelect,
  authorizedPayment: MercadoPagoAuthorizedPayment,
) {
  const claimedAt = new Date();
  const claimed = await db
    .update(restaurants)
    .set({ nfcCardsShippedAt: claimedAt })
    .where(
      and(
        eq(restaurants.id, restaurant.id),
        isNull(restaurants.nfcCardsShippedAt),
      ),
    )
    .returning({ id: restaurants.id });

  if (claimed.length === 0) return;

  const amountMxn = paymentAmountMxn(authorizedPayment, subscription);
  const shipping = parseShippingAddress(restaurant.shippingAddress, restaurant.city);

  const [notice] = await Promise.allSettled([
    sendOwnerConversionNotification({
      restaurantName: restaurant.name,
      contactName: restaurant.contactName ?? 'Desconocido',
      email: restaurant.managerEmail ?? '',
      phone: restaurant.managerPhone ?? '',
      shippingAddress: shipping,
      amountMxn,
    }),
    restaurant.managerEmail
      ? sendPurchaseEvent({
          email: restaurant.managerEmail,
          phone: restaurant.managerPhone ?? undefined,
          valueMxn: amountMxn,
          // Deterministic per-restaurant id: a ship-notice retry re-runs this
          // whole block on the next approved payment, and the same event id
          // makes Meta drop the duplicate instead of counting a second
          // Purchase (the payment id would differ on a real retry, and a
          // Date.now()-based id would never match).
          eventId: `mp_conversion_${restaurant.id}`,
        })
      : Promise.resolve(),
  ]);

  // Rejected, or an explicit `false` ("not sent"). A `void` result from a
  // caller/mock that predates the boolean contract carries no signal, so it
  // must not undo a shipped claim.
  const noticeSent = notice.status === 'fulfilled' && notice.value !== false;
  if (noticeSent) return;

  console.error(
    `[mercadopago-webhook] conversion notice NOT sent for restaurant=${restaurant.id}; releasing nfc_cards_shipped_at so the next approved payment retries`,
    notice.status === 'rejected' ? notice.reason : 'not sent',
  );

  await db
    .update(restaurants)
    .set({ nfcCardsShippedAt: null })
    .where(
      and(
        eq(restaurants.id, restaurant.id),
        eq(restaurants.nfcCardsShippedAt, claimedAt),
      ),
    );
}

/** Amount in MXN (Mercado Pago amounts are already pesos, not cents). */
function paymentAmountMxn(
  authorizedPayment: MercadoPagoAuthorizedPayment,
  subscription: typeof mercadopagoSubscriptions.$inferSelect,
): number {
  const candidates: unknown[] = [
    authorizedPayment.payment?.transaction_amount,
    authorizedPayment.transaction_amount,
    subscription.totalAmount,
    subscription.amount,
    MERCADOPAGO_MONTHLY_AMOUNT_MXN,
  ];
  for (const candidate of candidates) {
    const parsed =
      typeof candidate === 'number' ? candidate : parseFloat(String(candidate ?? ''));
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 0;
}
