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
  getPriceBreakdown,
} from '@/lib/mercadopago';

export const dynamic = 'force-dynamic';

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

  const baseUrl = getMercadoPagoBaseUrl();
  const breakdown = getPriceBreakdown();
  const billingStartsAt = computeBillingStartDate();

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
