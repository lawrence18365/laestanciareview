import { NextRequest } from 'next/server';
import { db } from '@/db';
import { mercadopagoSubscriptions, restaurants } from '@/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import {
  BILLING_START_DATE,
  MERCADOPAGO_ACCESS_TOKEN,
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

  try {
    const preapproval = await createPreapproval({
      reason: 'RateTap Pro',
      externalReference: String(restaurant.id),
      payerEmail: restaurant.managerEmail,
      amount: breakdown.total,
      backUrl: `${baseUrl}/settings?billing=mercadopago`,
      startDate: BILLING_START_DATE,
    });

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

    if (existing[0]) {
      await db
        .update(mercadopagoSubscriptions)
        .set({
          preapprovalId: preapproval.id,
          status: preapproval.status ?? 'pending',
          amount: String(breakdown.total),
          baseAmount: String(breakdown.base),
          processingChargeAmount: String(breakdown.processingCharge),
          taxAmount: String(breakdown.tax),
          totalAmount: String(breakdown.total),
          billingStartsAt: BILLING_START_DATE,
          payerEmail: restaurant.managerEmail,
          externalReference: String(restaurant.id),
          updatedAt: new Date(),
        })
        .where(eq(mercadopagoSubscriptions.id, existing[0].id));
    } else {
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
        billingStartsAt: BILLING_START_DATE,
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
