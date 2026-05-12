import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { commercialLeads, prospectOutreachEvents, prospectQueue } from '@/db/schema';
import {
  CommercialEventName,
  trackCommercialEvent,
  upsertCommercialLead,
} from '@/lib/commercial-tracking';

type JsonRecord = Record<string, unknown>;

export type ProspectRow = typeof prospectQueue.$inferSelect;

export type ProspectOutreachEventName =
  | 'prospect_identified'
  | 'outreach_queued'
  | 'outreach_sent'
  | 'outreach_delivered'
  | 'outreach_failed'
  | 'outreach_viewed'
  | 'outreach_replied';

export function normalizePhoneDigits(phone?: string | null): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (digits.length < 7) return null;
  return digits;
}

export function auditPath(placeId: string): string {
  return `/audit/${encodeURIComponent(placeId)}`;
}

export function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function asCommercialEventName(eventName: ProspectOutreachEventName): CommercialEventName {
  return eventName;
}

export async function logProspectOutreachEvent(input: {
  placeId?: string | null;
  commercialLeadId?: number | null;
  eventName: ProspectOutreachEventName;
  provider?: string | null;
  providerMessageId?: string | null;
  status?: string | null;
  payload?: JsonRecord | null;
  error?: string | null;
}) {
  await db.insert(prospectOutreachEvents).values({
    placeId: input.placeId ?? null,
    commercialLeadId: input.commercialLeadId ?? null,
    eventName: input.eventName,
    provider: input.provider ?? null,
    providerMessageId: input.providerMessageId ?? null,
    status: input.status ?? null,
    payload: input.payload ?? null,
    error: input.error ?? null,
  });

  if (input.commercialLeadId) {
    await trackCommercialEvent({
      eventName: asCommercialEventName(input.eventName),
      leadId: input.commercialLeadId,
      source: input.provider ?? 'outreach',
      path: input.placeId ? auditPath(input.placeId) : null,
      metadata: {
        status: input.status ?? null,
        provider_message_id: input.providerMessageId ?? null,
        ...(input.payload ?? {}),
        ...(input.error ? { error: input.error } : {}),
      },
    });
  }
}

export async function ensureCommercialLeadForProspect(
  prospect: ProspectRow,
  source: string,
  offer = 'free_review_audit',
) {
  if (prospect.commercialLeadId) {
    const rows = await db
      .select()
      .from(commercialLeads)
      .where(eq(commercialLeads.id, prospect.commercialLeadId))
      .limit(1);
    if (rows[0]) return rows[0];
  }

  const { lead } = await upsertCommercialLead({
    businessName: prospect.restaurantName,
    phone: prospect.phone,
    city: prospect.city,
    source,
    landingPath: auditPath(prospect.placeId),
    offer,
    metadata: {
      place_id: prospect.placeId,
      google_rating: prospect.rating,
      google_review_count: prospect.reviewCount,
    },
  });

  await db
    .update(prospectQueue)
    .set({ commercialLeadId: lead.id, updatedAt: new Date() })
    .where(eq(prospectQueue.placeId, prospect.placeId));

  return lead;
}

export async function findProspectByPhone(phone: string) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;

  const localMx = digits.startsWith('521') ? `+52${digits.slice(3)}` : `+${digits}`;
  const candidates = Array.from(new Set([`+${digits}`, localMx, digits]));

  const rows = await db
    .select()
    .from(prospectQueue)
    .where(
      or(...candidates.map((candidate) => eq(prospectQueue.phone, candidate))),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function markProspectReplied(input: {
  phone: string;
  text: string;
  provider: string;
  providerMessageId?: string | null;
}) {
  const prospect = await findProspectByPhone(input.phone);
  if (!prospect) return null;

  const now = new Date();
  const lead = await ensureCommercialLeadForProspect(prospect, `${input.provider}_reply`);

  await db
    .update(prospectQueue)
    .set({
      commercialLeadId: lead.id,
      status: 'replied',
      repliedAt: now,
      replyText: input.text,
      nextActionAt: now,
      updatedAt: now,
    })
    .where(eq(prospectQueue.placeId, prospect.placeId));

  await db
    .update(commercialLeads)
    .set({
      status: lead.status === 'new' ? 'contacted' : lead.status,
      nextAction: `Reply to inbound ${input.provider} message`,
      nextActionAt: now,
      updatedAt: now,
    })
    .where(eq(commercialLeads.id, lead.id));

  await logProspectOutreachEvent({
    placeId: prospect.placeId,
    commercialLeadId: lead.id,
    eventName: 'outreach_replied',
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    status: 'replied',
    payload: { text: input.text },
  });

  return { prospect, lead };
}

export async function markProspectDelivery(input: {
  providerMessageId: string;
  eventName: 'outreach_delivered' | 'outreach_failed';
  deliveryStatus: string;
  provider: string;
  payload?: JsonRecord | null;
  error?: string | null;
}) {
  const rows = await db
    .select()
    .from(prospectQueue)
    .where(
      and(
        eq(prospectQueue.providerMessageId, input.providerMessageId),
      ),
    )
    .limit(1);
  const prospect = rows[0];
  if (!prospect) return null;

  const status = input.eventName === 'outreach_failed' ? 'failed' : 'delivered';
  await db
    .update(prospectQueue)
    .set({
      status,
      deliveryStatus: input.deliveryStatus,
      lastError: input.error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(prospectQueue.placeId, prospect.placeId));

  await logProspectOutreachEvent({
    placeId: prospect.placeId,
    commercialLeadId: prospect.commercialLeadId,
    eventName: input.eventName,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    status,
    payload: input.payload ?? null,
    error: input.error ?? null,
  });

  return prospect;
}
