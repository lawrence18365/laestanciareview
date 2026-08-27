import { NextRequest } from 'next/server';
import { db } from '@/db';
import {
  mercadopagoSubscriptions,
  processedMercadopagoEvents,
  restaurants,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthorizedPayment,
  getPreapproval,
  mapPreapprovalStatus,
  subscriptionBillingHasStarted,
  verifyMercadoPagoSignature,
} from '@/lib/mercadopago';

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
): boolean {
  const currentlyHasAccess =
    currentStatus === 'active' || currentStatus === 'trialing';
  const wouldLoseAccess = nextStatus === 'canceled' || nextStatus === 'past_due';
  // Per-restaurant trial window: prefer the subscription row's billing start
  // over the global launch date (rows predate per-restaurant trials may be null).
  return (
    !subscriptionBillingHasStarted(billingStartsAt) &&
    currentlyHasAccess &&
    wouldLoseAccess
  );
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
    )
  ) {
    console.log(
      `[mercadopago-webhook] pre-billing-start downgrade skipped restaurant=${restaurant.id} current=${restaurant.subscriptionStatus} mapped=${mapped}`,
    );
    return;
  }

  await db
    .update(restaurants)
    .set({ subscriptionStatus: mapped, billingProvider: 'mercadopago' })
    .where(eq(restaurants.id, restaurant.id));
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
  if (!restaurant || restaurant.subscriptionStatus === newStatus) return;

  if (
    shouldSkipPreBillingStartDowngrade(
      restaurant.subscriptionStatus,
      newStatus,
      subscription.billingStartsAt,
    )
  ) {
    console.log(
      `[mercadopago-webhook] pre-billing-start downgrade skipped restaurant=${restaurant.id} current=${restaurant.subscriptionStatus} mapped=${newStatus}`,
    );
    return;
  }

  await db
    .update(restaurants)
    .set({ subscriptionStatus: newStatus, billingProvider: 'mercadopago' })
    .where(eq(restaurants.id, restaurant.id));
}
