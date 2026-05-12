import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { commercialLeads } from '@/db/schema';
import { requireSameOrigin } from '@/lib/origin';
import { verifySession } from '@/lib/session';
import { CommercialEventName, trackCommercialEvent } from '@/lib/commercial-tracking';
import { COMMERCIAL_LEAD_STATUSES, CommercialLeadStatus } from '@/lib/commercial-statuses';

export const runtime = 'nodejs';

const updateSchema = z.object({
  status: z.enum(COMMERCIAL_LEAD_STATUSES).optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  contactedAt: z.string().datetime().nullable().optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
});

function eventForStatus(status: CommercialLeadStatus): CommercialEventName {
  switch (status) {
    case 'contacted':
      return 'lead_contacted';
    case 'demo_booked':
      return 'demo_booked';
    case 'proposal_sent':
      return 'proposal_sent';
    case 'won':
      return 'lead_won';
    case 'lost':
    case 'bad_fit':
      return 'lead_lost';
    default:
      return 'lead_status_updated';
  }
}

function shouldStampContacted(status?: CommercialLeadStatus) {
  return status === 'contacted' || status === 'demo_booked' || status === 'proposal_sent' || status === 'won';
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'owner') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(commercialLeads)
    .where(eq(commercialLeads.id, leadId))
    .limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const now = new Date();
  const patch: Partial<typeof commercialLeads.$inferInsert> = {
    updatedAt: now,
  };

  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status;
    if (shouldStampContacted(parsed.data.status) && !existing.contactedAt && parsed.data.contactedAt === undefined) {
      patch.contactedAt = now;
    }
    if (parsed.data.status === 'contacted' && !existing.nextActionAt && parsed.data.nextActionAt === undefined) {
      patch.nextActionAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    if (parsed.data.status === 'won' && !existing.wonAt) patch.wonAt = now;
    if ((parsed.data.status === 'lost' || parsed.data.status === 'bad_fit') && !existing.lostAt) {
      patch.lostAt = now;
    }
  }
  if (parsed.data.nextAction !== undefined) patch.nextAction = parsed.data.nextAction || null;
  if (parsed.data.nextActionAt !== undefined) {
    patch.nextActionAt = parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : null;
  }
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;
  if (parsed.data.lostReason !== undefined) patch.lostReason = parsed.data.lostReason || null;
  if (parsed.data.contactedAt !== undefined) {
    patch.contactedAt = parsed.data.contactedAt ? new Date(parsed.data.contactedAt) : null;
  }

  const [updated] = await db
    .update(commercialLeads)
    .set(patch)
    .where(eq(commercialLeads.id, leadId))
    .returning();

  if (parsed.data.status && parsed.data.status !== existing.status) {
    await trackCommercialEvent({
      eventName: eventForStatus(parsed.data.status),
      leadId,
      source: 'sales_cockpit',
      path: '/commercial-leads',
      metadata: {
        previous_status: existing.status,
        status: parsed.data.status,
        next_action: updated.nextAction,
        next_action_at: updated.nextActionAt,
        lost_reason: updated.lostReason,
      },
    });
  } else {
    await trackCommercialEvent({
      eventName: 'lead_status_updated',
      leadId,
      source: 'sales_cockpit',
      path: '/commercial-leads',
      metadata: {
        status: updated.status,
        next_action: updated.nextAction,
        next_action_at: updated.nextActionAt,
        notes_changed: parsed.data.notes !== undefined,
      },
    });
  }

  return Response.json({ ok: true, lead: updated });
}
