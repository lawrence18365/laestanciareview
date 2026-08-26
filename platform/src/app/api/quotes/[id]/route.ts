import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { quoteUpdateSchema } from '@/lib/validations';
import { requireSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';

async function getRestaurantId(slug: string): Promise<number | null> {
  const rows = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurantId = await getRestaurantId(session.slug);
  if (!restaurantId) return Response.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: 'Invalid id' }, { status: 400 });

  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurantId)))
    .limit(1);
  if (!quote) return Response.json({ error: 'Not found' }, { status: 404 });

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(quoteItems.sortOrder);

  return Response.json({ quote, items });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurantId = await getRestaurantId(session.slug);
  if (!restaurantId) return Response.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: 'Invalid id' }, { status: 400 });

  // Ownership check
  const [existing] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurantId)))
    .limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = quoteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  await db
    .update(quotes)
    .set({
      status: data.status ?? 'draft',
      clientName: data.clientName,
      clientPhone: data.clientPhone ?? null,
      clientEmail: data.clientEmail ?? null,
      clientCompany: data.clientCompany ?? null,
      eventDate: data.eventDate ?? null,
      eventType: data.eventType ?? null,
      guestCount: data.guestCount,
      eventNotes: data.eventNotes ?? null,
      serviceChargePercent: data.serviceChargePercent,
      ivaPercent: data.ivaPercent,
      packageName: data.packageName ?? null,
      terms: data.terms ?? null,
      configJson:
        data.configJson !== undefined ? (data.configJson as object | null) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  // Replace items entirely
  await db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));

  if (data.items) {
    const rows: { quoteId: number; category: string; name: string; sortOrder: number }[] = [];
    for (const [category, names] of Object.entries(data.items)) {
      if (!Array.isArray(names)) continue;
      names.forEach((name, i) => {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed) {
          rows.push({ quoteId, category, name: trimmed, sortOrder: i });
        }
      });
    }
    if (rows.length > 0) {
      await db.insert(quoteItems).values(rows);
    }
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurantId = await getRestaurantId(session.slug);
  if (!restaurantId) return Response.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: 'Invalid id' }, { status: 400 });

  const [existing] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurantId)))
    .limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  await db.delete(quotes).where(eq(quotes.id, quoteId));

  return Response.json({ ok: true });
}
