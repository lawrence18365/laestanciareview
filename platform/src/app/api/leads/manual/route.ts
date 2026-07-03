/**
 * Manual event-lead entry from the dashboard. A GM adds a walk-in or phone
 * inquiry the WhatsApp bot didn't capture. source is forced to 'manual';
 * status starts at 'new'. Tenant-scoped + CSRF-protected like the other
 * dashboard mutations.
 */

import { NextRequest } from 'next/server';
import { db } from '@/db';
import { eventLeads } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { eventLeadManualSchema } from '@/lib/validations';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = eventLeadManualSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const [lead] = await db
    .insert(eventLeads)
    .values({
      restaurantId: restaurant.id,
      source: 'manual',
      phone: d.phone.trim(),
      name: d.name ?? null,
      tipoEvento: d.tipoEvento ?? null,
      pax: d.pax ?? null,
      fechaTentativa: d.fechaTentativa ?? null,
      presupuestoPp: d.presupuestoPp ?? null,
      prioridad: d.prioridad ?? null,
      notasExtra: d.notasExtra ?? null,
      urgente: d.urgente ?? false,
      status: 'new',
    })
    .returning();

  return Response.json(
    {
      lead: {
        ...lead,
        createdAt: lead.createdAt.toISOString(),
        claimedAt: lead.claimedAt?.toISOString() ?? null,
        externalCreatedAt: lead.externalCreatedAt?.toISOString() ?? null,
      },
    },
    { status: 201 },
  );
}
