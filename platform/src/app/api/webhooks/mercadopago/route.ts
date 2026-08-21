import { NextRequest } from 'next/server';
import { db } from '@/db';
import {
  mercadopagoSubscriptions,
  processedMercadopagoEvents,
  restaurants,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  MERCADOPAGO_WEBHOOK_SECRET,
  getAuthorizedPayment,
  getPreapproval,
  mapPreapprovalStatus,
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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as MercadoPagoWebhookBody | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const dataIdRaw = body.data?.id ?? req.nextUrl.searchParams.get('data.id') ?? '';
  const dataId = String(dataIdRaw);

  // Signature verification. When the secret is configured, an invalid
  // signature is a hard 401. When it is not configured (test/sandbox setups
  // where MP has no secret yet) we log and still process.
  if (MERCADOPAGO_WEBHOOK_SECRET) {
    const valid = verifyMercadoPagoSignature({
      xSignature: req.headers.get('x-signature'),
      xRequestId: req.headers.get('x-request-id'),
      dataId,
      secret: MERCADOPAGO_WEBHOOK_SECRET,
    });
    if (!valid) {
      console.warn('[mercadopago-webhook] invalid x-signature');
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn(
      '[mercadopago-webhook] MERCADOPAGO_WEBHOOK_SECRET not set — processing without signature verification (test mode)',
    );
  }

  const eventKey = `${body.type ?? ''}:${body.action ?? ''}:${dataId}:${body.id ?? ''}`;

  // Idempotency — skip if we've already processed this event
  try {
    await db.insert(processedMercadopagoEvents).values({ eventId: eventKey });
  } catch {
    // Primary key conflict → already processed
    return Response.json({ received: true, duplicate: true });
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

async function findSubscriptionByPreapproval(
  preapprovalId: string,
  externalReference?: string | null,
) {
  const byPreapproval = await db
    .select()
    .from(mercadopagoSubscriptions)
    .where(eq(mercadopagoSubscriptions.preapprovalId, preapprovalId))
    .limit(1);
  if (byPreapproval[0]) return byPreapproval[0];

  if (externalReference) {
    const byReference = await db
      .select()
      .from(mercadopagoSubscriptions)
      .where(eq(mercadopagoSubscriptions.externalReference, externalReference))
      .limit(1);
    if (byReference[0]) return byReference[0];
  }

  return null;
}

async function handlePreapproval(dataId: string) {
  if (!dataId) {
    console.warn('[mercadopago-webhook] subscription_preapproval without data.id');
    return;
  }

  const preapproval = await getPreapproval(dataId);

  const subscription = await findSubscriptionByPreapproval(
    dataId,
    preapproval.external_reference,
  );
  if (!subscription) {
    console.warn(
      `[mercadopago-webhook] no subscription row for preapproval ${dataId}`,
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

  const subscription = await findSubscriptionByPreapproval(
    preapprovalId,
    authorizedPayment.external_reference,
  );
  if (!subscription) {
    console.warn(
      `[mercadopago-webhook] no subscription row for preapproval ${preapprovalId}`,
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

  await db
    .update(restaurants)
    .set({ subscriptionStatus: newStatus, billingProvider: 'mercadopago' })
    .where(eq(restaurants.id, restaurant.id));
}
