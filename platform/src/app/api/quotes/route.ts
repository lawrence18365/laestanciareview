import { NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { DEFAULT_TERMS } from '@/lib/quote-defaults';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant[0]) return Response.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.restaurantId, restaurant[0].id))
    .orderBy(desc(quotes.createdAt));

  return Response.json({ quotes: rows });
}

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant[0]) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  // Validate required fields
  if (!b.clientName || typeof b.clientName !== 'string') {
    return Response.json({ error: 'clientName required' }, { status: 400 });
  }
  const guestCount = typeof b.guestCount === 'number' ? b.guestCount : parseInt(String(b.guestCount ?? '1'), 10);

  const [inserted] = await db
    .insert(quotes)
    .values({
      restaurantId: restaurant[0].id,
      status: 'draft',
      clientName: b.clientName as string,
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
      terms: (b.terms as string) || DEFAULT_TERMS,
      configJson: (b.configJson ?? null) as object | null,
      quoteNumber: null,
    })
    .returning();

  // Auto-generate quote number after insert
  const quoteNumber = `Q-${String(inserted.id).padStart(4, '0')}`;
  await db.update(quotes).set({ quoteNumber }).where(eq(quotes.id, inserted.id));

  // Insert quote items if provided
  const itemsMap = b.items as Record<string, string[]> | undefined;
  if (itemsMap && typeof itemsMap === 'object') {
    const rows: { quoteId: number; category: string; name: string; sortOrder: number }[] = [];
    for (const [category, names] of Object.entries(itemsMap)) {
      if (!Array.isArray(names)) continue;
      names.forEach((name, i) => {
        if (typeof name === 'string' && name.trim()) {
          rows.push({ quoteId: inserted.id, category, name: name.trim(), sortOrder: i });
        }
      });
    }
    if (rows.length > 0) {
      await db.insert(quoteItems).values(rows);
    }
  }

  return Response.json({ id: inserted.id, quoteNumber }, { status: 201 });
}
