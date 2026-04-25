import { NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { DEFAULT_TERMS } from '@/lib/quote-defaults';
import { quoteCreateSchema } from '@/lib/validations';
import { requireSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';

export async function GET() {
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
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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

  const parsed = quoteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(quotes)
    .values({
      restaurantId: restaurant[0].id,
      status: 'draft',
      clientName: data.clientName,
      clientPhone: data.clientPhone ?? null,
      clientEmail: data.clientEmail ?? null,
      clientCompany: data.clientCompany ?? null,
      eventDate: data.eventDate ?? null,
      eventType: data.eventType ?? null,
      guestCount: data.guestCount,
      eventNotes: data.eventNotes ?? null,
      pricePerPerson: data.pricePerPerson,
      serviceChargePercent: data.serviceChargePercent,
      ivaPercent: data.ivaPercent,
      packageName: data.packageName ?? null,
      terms: data.terms ?? DEFAULT_TERMS,
      configJson: (data.configJson ?? null) as object | null,
      quoteNumber: null,
    })
    .returning();

  // Auto-generate quote number after insert
  const quoteNumber = `Q-${String(inserted.id).padStart(4, '0')}`;
  await db.update(quotes).set({ quoteNumber }).where(eq(quotes.id, inserted.id));

  // Insert quote items if provided
  if (data.items) {
    const rows: { quoteId: number; category: string; name: string; sortOrder: number }[] = [];
    for (const [category, names] of Object.entries(data.items)) {
      if (!Array.isArray(names)) continue;
      names.forEach((name, i) => {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed) {
          rows.push({ quoteId: inserted.id, category, name: trimmed, sortOrder: i });
        }
      });
    }
    if (rows.length > 0) {
      await db.insert(quoteItems).values(rows);
    }
  }

  return Response.json({ id: inserted.id, quoteNumber }, { status: 201 });
}
