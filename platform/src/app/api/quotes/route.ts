import { NextRequest } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants, eventLeads } from '@/db/schema';
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

  // If the quote originates from a lead, verify the lead belongs to this
  // tenant before linking — never trust a client-supplied lead id.
  let linkedLeadId: number | null = null;
  if (data.leadId != null) {
    const [lead] = await db
      .select({ id: eventLeads.id })
      .from(eventLeads)
      .where(
        and(
          eq(eventLeads.id, data.leadId),
          eq(eventLeads.restaurantId, restaurant[0].id),
        ),
      )
      .limit(1);
    if (lead) linkedLeadId = lead.id;
  }

  const [inserted] = await db
    .insert(quotes)
    .values({
      restaurantId: restaurant[0].id,
      leadId: linkedLeadId,
      status: 'draft',
      clientName: data.clientName,
      clientPhone: data.clientPhone ?? null,
      clientEmail: data.clientEmail ?? null,
      clientCompany: data.clientCompany ?? null,
      eventDate: data.eventDate ?? null,
      eventType: data.eventType ?? null,
      guestCount: data.guestCount,
      eventNotes: data.eventNotes ?? null,
      packageName: data.packageName ?? null,
      terms: data.terms ?? DEFAULT_TERMS,
      configJson: (data.configJson ?? null) as object | null,
      quoteNumber: null,
    })
    .returning();

  // Auto-generate quote number after insert
  const quoteNumber = `Q-${String(inserted.id).padStart(4, '0')}`;
  await db.update(quotes).set({ quoteNumber }).where(eq(quotes.id, inserted.id));

  // Advance the originating lead into the pipeline. Only from new/claimed so a
  // won/lost lead isn't dragged back to quoted.
  if (linkedLeadId != null) {
    await db
      .update(eventLeads)
      // Stamp claimedAt too (preserving an existing value) so a lead quoted
      // straight from "new" doesn't keep reading as "sin tomar" — the leads
      // dashboard defines taken/untaken by claimedAt.
      .set({
        status: 'quoted',
        claimedAt: sql`COALESCE(${eventLeads.claimedAt}, now())`,
      })
      .where(
        and(
          eq(eventLeads.id, linkedLeadId),
          inArray(eventLeads.status, ['new', 'claimed']),
        ),
      );
  }

  return Response.json({ id: inserted.id, quoteNumber }, { status: 201 });
}
