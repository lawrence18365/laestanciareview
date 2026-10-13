import { NextRequest } from 'next/server';
import { db } from '@/db';
import { mercadopagoSubscriptions, restaurants } from '@/db/schema';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import {
  MERCADOPAGO_ACCESS_TOKEN,
  cancelPreapproval,
  computeBillingStartDate,
  createPreapproval,
  getMercadoPagoBaseUrl,
  getPreapproval,
  getPriceBreakdown,
  isLegacyActiveAccount,
  legacyBillingStartDate,
} from '@/lib/mercadopago';

import { z } from 'zod';
import { recordProductEvent } from '@/lib/product-events';
import { selfServePrice, usesPlanRestaurantePrice, type BillingCycle } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ cycle: z.enum(['monthly', 'annual']).optional() });

/**
 * Whether the restaurant has ANY mercadopago_subscriptions row, cancelled ones
 * included: a row proves it has been through Mercado Pago before, so it is not
 * a legacy account.
 */
async function hasAnyMercadopagoRow(restaurantId: number): Promise<boolean> {
  const rows = await db
    .select({ id: mercadopagoSubscriptions.id })
    .from(mercadopagoSubscriptions)
    .where(eq(mercadopagoSubscriptions.restaurantId, restaurantId))
    .limit(1);
  return rows.length > 0;
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!MERCADOPAGO_ACCESS_TOKEN) {
    console.error('[mercadopago-subscribe] MERCADOPAGO_ACCESS_TOKEN not set');
    return Response.json(
      { error: 'El pago con Mercado Pago no está configurado' },
      { status: 500 },
    );
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });
  }

  if (!restaurant.managerEmail) {
    return Response.json(
      { error: 'Agrega el email del gerente en Ajustes antes de suscribirte' },
      { status: 400 },
    );
  }

  // Optional body: { cycle?: 'monthly' | 'annual' }. A missing/empty body is
  // the legacy request and means monthly.
  const rawBody: unknown = await req.json().catch(() => ({}));
  const parsedBody = bodySchema.safeParse(rawBody ?? {});
  if (!parsedBody.success) {
    return Response.json({ error: 'Ciclo de pago no válido' }, { status: 400 });
  }
  const cycle: BillingCycle = parsedBody.data.cycle ?? 'monthly';

  const baseUrl = getMercadoPagoBaseUrl();
  // Plan Restaurante price for self-serve single-location restaurants; every
  // other restaurant (Grupo, 2+ locations) ignores `cycle` and keeps the
  // global monthly path unchanged.
  const planRestaurante = usesPlanRestaurantePrice(restaurant);
  const frequency: 1 | 12 = planRestaurante && cycle === 'annual' ? 12 : 1;
  const breakdown = planRestaurante
    ? { base: selfServePrice(cycle), processingCharge: 0, tax: 0, total: selfServePrice(cycle) }
    : getPriceBreakdown();

  try {
    // One active row per restaurant: reuse/update a non-cancelled row if one
    // exists, otherwise insert a fresh one.
    const existing = await db
      .select()
      .from(mercadopagoSubscriptions)
      .where(
        and(
          eq(mercadopagoSubscriptions.restaurantId, restaurant.id),
          ne(mercadopagoSubscriptions.status, 'cancelled'),
        ),
      )
      .limit(1);

    // Legacy accounts: already `active` but never in Mercado Pago at all (they
    // paid outside the app), so they have no trial window left to bill from.
    // computeBillingStartDate() would charge them at now + 10min; they keep
    // the 30-day window instead. Any existing row — cancelled or not —
    // disqualifies the account: it has been through Mercado Pago, so it is not
    // legacy.
    const isLegacy = isLegacyActiveAccount({
      subscriptionStatus: restaurant.subscriptionStatus,
      hasMercadopagoRow: await hasAnyMercadopagoRow(restaurant.id),
    });

    // Billing starts when this restaurant's own trial ends — never a fresh
    // trial window, so an already-expired trial cannot be reset by subscribing.
    const billingStartsAt = isLegacy
      ? legacyBillingStartDate()
      : computeBillingStartDate({ trialEndsAt: restaurant.trialEndsAt });

    // Never cancel/reissue a live subscription: if the customer already
    // authorized, the preapproval is actively billing (or about to) and
    // replacing it would silently kill their paid plan. Cancel-before-
    // reissue below only ever applies to not-yet-authorized (pending)
    // preapprovals, where losing the old checkout link is harmless.
    if (existing[0]?.status === 'authorized') {
      return Response.json(
        { error: 'Ya tienes una suscripción activa' },
        { status: 409 },
      );
    }

    // Reissue safety: cancel the previous preapproval BEFORE creating a new
    // one, so a stale checkout link can never be charged on the old start
    // date. If the cancel fails unexpectedly, abort (500) rather than risk
    // two live preapprovals.
    const previousPreapprovalId = existing[0]?.preapprovalId;
    if (previousPreapprovalId) {
      // Re-click guard: our row can still say `pending` after the customer
      // authorized on Mercado Pago (the webhook may not have landed yet).
      // Cancelling that preapproval would kill a payment that just went
      // through, so check its LIVE status first. If we cannot read it, abort:
      // never cancel blind.
      try {
        const live = await getPreapproval(previousPreapprovalId);
        if (live.status === 'authorized') {
          return Response.json(
            { pending: true, message: 'Estamos confirmando tu pago…' },
            { status: 202 },
          );
        }
      } catch (statusErr) {
        // 404 = the preapproval no longer exists, so there is nothing live to
        // protect (cancelPreapproval tolerates it too).
        const gone = statusErr instanceof Error && statusErr.message.includes('(404)');
        if (!gone) {
          console.error(
            `[mercadopago-subscribe] failed to read previous preapproval ${previousPreapprovalId}:`,
            statusErr,
          );
          return Response.json(
            { error: 'No pudimos verificar tu pago. Inténtalo de nuevo en un momento.' },
            { status: 502 },
          );
        }
      }
      try {
        await cancelPreapproval(previousPreapprovalId);
      } catch (cancelErr) {
        console.error(
          `[mercadopago-subscribe] failed to cancel previous preapproval ${previousPreapprovalId}:`,
          cancelErr,
        );
        return Response.json(
          { error: 'No se pudo renovar la suscripción. Inténtalo de nuevo o escríbenos por WhatsApp.' },
          { status: 500 },
        );
      }
    }

    const preapproval = await createPreapproval({
      reason: 'RateTap Pro',
      externalReference: String(restaurant.id),
      payerEmail: restaurant.managerEmail,
      amount: breakdown.total,
      backUrl: `${baseUrl}/settings?billing=mercadopago`,
      startDate: billingStartsAt,
      frequency,
    });

    if (existing[0]) {
      // Compare-and-swap: only take over the row if it still points at the
      // preapproval we just cancelled. If a concurrent (double-clicked)
      // request already reissued the row, we lost the race: cancel the
      // preapproval WE created (best-effort) and ask the user to reload.
      const swapCondition = previousPreapprovalId
        ? and(
            eq(mercadopagoSubscriptions.id, existing[0].id),
            eq(mercadopagoSubscriptions.preapprovalId, previousPreapprovalId),
          )
        : and(
            eq(mercadopagoSubscriptions.id, existing[0].id),
            isNull(mercadopagoSubscriptions.preapprovalId),
          );
      const updateResult = await db
        .update(mercadopagoSubscriptions)
        .set({
          preapprovalId: preapproval.id,
          status: preapproval.status ?? 'pending',
          amount: String(breakdown.total),
          baseAmount: String(breakdown.base),
          processingChargeAmount: String(breakdown.processingCharge),
          taxAmount: String(breakdown.tax),
          totalAmount: String(breakdown.total),
          billingStartsAt,
          payerEmail: restaurant.managerEmail,
          externalReference: String(restaurant.id),
          updatedAt: new Date(),
        })
        .where(swapCondition);

      if ((updateResult.rowCount ?? 0) === 0) {
        try {
          await cancelPreapproval(preapproval.id);
        } catch (cleanupErr) {
          console.error(
            `[mercadopago-subscribe] failed to cancel losing-race preapproval ${preapproval.id}:`,
            cleanupErr,
          );
        }
        return Response.json(
          { error: 'La suscripción se está procesando, recarga la página' },
          { status: 409 },
        );
      }
    } else {
      // Accepted residual risk: two simultaneous FIRST subscribes (no prior
      // row) can both insert and create two pending preapprovals. This
      // window is far narrower than the reissue race above and needs no
      // schema change; the webhook only activates the row that matches the
      // authorized preapproval id.
      await db.insert(mercadopagoSubscriptions).values({
        restaurantId: restaurant.id,
        preapprovalId: preapproval.id,
        externalReference: String(restaurant.id),
        status: preapproval.status ?? 'pending',
        amount: String(breakdown.total),
        baseAmount: String(breakdown.base),
        processingChargeAmount: String(breakdown.processingCharge),
        taxAmount: String(breakdown.tax),
        totalAmount: String(breakdown.total),
        billingStartsAt,
        payerEmail: restaurant.managerEmail,
      });
    }

    await db
      .update(restaurants)
      .set({ billingProvider: 'mercadopago' })
      .where(eq(restaurants.id, restaurant.id));

    void recordProductEvent({
      name: 'checkout_started',
      restaurantId: restaurant.id,
      role: session.role,
      path: '/api/billing/mercadopago/subscribe',
      properties: { cycle: frequency === 12 ? 'annual' : 'monthly', amount: breakdown.total },
    });

    // Never grant access here — the webhook is the source of truth.
    return Response.json({ url: preapproval.init_point });
  } catch (err) {
    console.error('[mercadopago-subscribe] failed to create preapproval:', err);
    return Response.json(
      { error: 'No se pudo iniciar la suscripción con Mercado Pago' },
      { status: 500 },
    );
  }
}
