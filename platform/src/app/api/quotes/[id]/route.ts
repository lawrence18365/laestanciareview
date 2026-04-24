import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';

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
  const b = body as Record<string, unknown>;

  const guestCount =
    typeof b.guestCount === 'number'
      ? b.guestCount
      : parseInt(String(b.guestCount ?? '1'), 10);

  await db
    .update(quotes)
    .set({
      status: (b.status as string) || 'draft',
      clientName: (b.clientName as string) || '',
      clientPhone: (b.clientPhone as string) || null,
      clientEmail: (b.clientEmail as string) || null,
      clientCompany: (b.clientCompany as string) || null,
      eventDate: (b.eventDate as string) || null,
      eventType: (b.eventType as string) || null,
      guestCount,
      eventNotes: (b.eventNotes as string) || null,
      pricePerPerson: String(b.pricePerPerson ?? '0'),
      serviceChargePercent: String(b.serviceChargePercent ?? '10'),
      ivaPercent: String(b.ivaPercent ?? '16'),
      packageName: (b.packageName as string) || null,
      terms: (b.terms as string) || null,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  // Replace items entirely
  await db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));

  const itemsMap = b.items as Record<string, string[]> | undefined;
  if (itemsMap && typeof itemsMap === 'object') {
    const rows: { quoteId: number; category: string; name: string; sortOrder: number }[] = [];
    for (const [category, names] of Object.entries(itemsMap)) {
      if (!Array.isArray(names)) continue;
      names.forEach((name, i) => {
        if (typeof name === 'string' && name.trim()) {
          rows.push({ quoteId, category, name: name.trim(), sortOrder: i });
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

  const [existing] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurantId)))
    .limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  await db.delete(quotes).where(eq(quotes.id, quoteId));

  return Response.json({ ok: true });
}
