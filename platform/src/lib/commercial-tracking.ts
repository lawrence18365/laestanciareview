import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { commercialEvents, commercialLeads } from '@/db/schema';
export { COMMERCIAL_LEAD_STATUSES, isCommercialLeadStatus } from '@/lib/commercial-statuses';
export type { CommercialLeadStatus } from '@/lib/commercial-statuses';

export type CommercialEventName =
  | 'lead_created'
  | 'lead_duplicate'
  | 'lead_status_updated'
  | 'lead_contacted'
  | 'lead_won'
  | 'lead_lost'
  | 'demo_requested'
  | 'demo_booked'
  | 'proposal_sent'
  | 'prospect_identified'
  | 'outreach_queued'
  | 'outreach_sent'
  | 'outreach_delivered'
  | 'outreach_failed'
  | 'outreach_viewed'
  | 'outreach_replied'
  | 'checkout_started'
  | 'checkout_completed'
  | 'restaurant_activated'
  | 'review_submitted'
  | 'google_redirected'
  | 'feedback_submitted'
  | 'guest_captured'
  | 'subscription_paid'
  | 'subscription_failed'
  | 'subscription_canceled';

type JsonRecord = Record<string, unknown>;

export type CommercialLeadInput = {
  name?: string | null;
  businessName: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  source?: string | null;
  landingPath?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  offer?: string | null;
  metadata?: JsonRecord | null;
};

export type CommercialEventInput = {
  eventName: CommercialEventName;
  leadId?: number | null;
  restaurantId?: number | null;
  source?: string | null;
  path?: string | null;
  metadata?: JsonRecord | null;
};

function cleanText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function normalizeEmail(email?: string | null): string | null {
  return cleanText(email)?.toLowerCase() ?? null;
}

export function normalizePhone(phone?: string | null): string | null {
  const digits = cleanText(phone)?.replace(/\D/g, '') ?? '';
  return digits.length >= 7 ? digits : null;
}

export function normalizeBusinessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePath(path?: string | null): string | null {
  const cleaned = cleanText(path);
  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);
    return `${url.pathname}${url.search}`;
  } catch {
    return cleaned.startsWith('/') ? cleaned : null;
  }
}

export function commercialLeadDedupeKey(input: CommercialLeadInput): string {
  const business = normalizeBusinessName(input.businessName);
  const phone = normalizePhone(input.phone);
  if (phone) return `phone_business:${phone}:${business}`;

  const email = normalizeEmail(input.email);
  if (email) return `email_business:${email}:${business}`;

  const city = normalizeBusinessName(input.city ?? '');
  return `business:${business}:${city || 'unknown-city'}`;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code?: unknown }).code : undefined;
  const cause = 'cause' in err ? (err as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  const message = 'message' in err ? String((err as { message?: unknown }).message) : '';
  return code === '23505' || causeCode === '23505' || message.includes('duplicate key');
}

export async function trackCommercialEvent(input: CommercialEventInput) {
  const [event] = await db
    .insert(commercialEvents)
    .values({
      leadId: input.leadId ?? null,
      restaurantId: input.restaurantId ?? null,
      eventName: input.eventName,
      source: cleanText(input.source),
      path: normalizePath(input.path),
      metadata: input.metadata ?? null,
    })
    .returning({ id: commercialEvents.id });

  return event;
}

export async function upsertCommercialLead(input: CommercialLeadInput) {
  const businessName = cleanText(input.businessName);
  if (!businessName) throw new Error('businessName is required');

  const now = new Date();
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);
  const businessNameNormalized = normalizeBusinessName(businessName);
  const dedupeKey = commercialLeadDedupeKey({ ...input, businessName });
  const source = cleanText(input.source) ?? 'unknown';
  const offer = cleanText(input.offer) ?? 'unknown';

  const values = {
    name: cleanText(input.name),
    businessName,
    email: cleanText(input.email),
    phone: cleanText(input.phone),
    city: cleanText(input.city),
    source,
    landingPath: normalizePath(input.landingPath),
    utmSource: cleanText(input.utmSource),
    utmMedium: cleanText(input.utmMedium),
    utmCampaign: cleanText(input.utmCampaign),
    utmTerm: cleanText(input.utmTerm),
    utmContent: cleanText(input.utmContent),
    offer,
    emailNormalized,
    phoneNormalized,
    businessNameNormalized,
    dedupeKey,
    metadata: input.metadata ?? null,
    updatedAt: now,
  };

  try {
    const [lead] = await db.insert(commercialLeads).values(values).returning();
    const event = await trackCommercialEvent({
      eventName: 'lead_created',
      leadId: lead.id,
      source,
      path: values.landingPath,
      metadata: { offer, dedupe_key: dedupeKey },
    });
    return { lead, deduped: false, eventId: event.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existingRows = await db
    .select()
    .from(commercialLeads)
    .where(eq(commercialLeads.dedupeKey, dedupeKey))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new Error('duplicate lead not found');

  const [lead] = await db
    .update(commercialLeads)
    .set({
      name: values.name ?? existing.name,
      businessName: values.businessName,
      email: values.email ?? existing.email,
      phone: values.phone ?? existing.phone,
      city: values.city ?? existing.city,
      source,
      landingPath: values.landingPath ?? existing.landingPath,
      utmSource: values.utmSource ?? existing.utmSource,
      utmMedium: values.utmMedium ?? existing.utmMedium,
      utmCampaign: values.utmCampaign ?? existing.utmCampaign,
      utmTerm: values.utmTerm ?? existing.utmTerm,
      utmContent: values.utmContent ?? existing.utmContent,
      offer,
      emailNormalized: values.emailNormalized ?? existing.emailNormalized,
      phoneNormalized: values.phoneNormalized ?? existing.phoneNormalized,
      businessNameNormalized: values.businessNameNormalized,
      metadata: values.metadata ?? existing.metadata,
      updatedAt: now,
    })
    .where(eq(commercialLeads.id, existing.id))
    .returning();

  const event = await trackCommercialEvent({
    eventName: 'lead_duplicate',
    leadId: lead.id,
    source,
    path: values.landingPath,
    metadata: { offer, dedupe_key: dedupeKey },
  });

  return { lead, deduped: true, eventId: event.id };
}
