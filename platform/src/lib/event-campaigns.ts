import { z } from 'zod';

export const CAMPAIGN_STATUSES = [
  'draft',
  'ready',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export const CONTACT_STATUSES = [
  'queued',
  'opened',
  'sent',
  'replied',
  'interested',
  'deposit_pending',
  'booked',
  'declined',
  'opted_out',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const ALLOWED_CONTACT_TRANSITIONS: Record<ContactStatus, readonly ContactStatus[]> = {
  queued: ['opened', 'declined', 'opted_out'],
  opened: ['sent', 'declined', 'opted_out'],
  sent: ['replied', 'interested', 'declined', 'opted_out'],
  replied: ['interested', 'deposit_pending', 'booked', 'declined', 'opted_out'],
  interested: ['deposit_pending', 'booked', 'declined', 'opted_out'],
  deposit_pending: ['booked', 'declined', 'opted_out'],
  booked: ['opted_out'],
  declined: ['opted_out'],
  opted_out: [],
};

export type ContactTransitionDecision =
  | { kind: 'apply'; to: ContactStatus }
  | { kind: 'noop' }
  | { kind: 'stale' }
  | { kind: 'blocked'; reason: 'opted_out' | 'declined' }
  | { kind: 'invalid'; code: 'INVALID_TRANSITION' };

export function decideContactTransition({
  currentStatus,
  requestedStatus,
}: {
  currentStatus: ContactStatus;
  requestedStatus: ContactStatus;
}): ContactTransitionDecision {
  if (currentStatus === requestedStatus) return { kind: 'noop' };

  if (
    (currentStatus === 'opted_out' || currentStatus === 'declined') &&
    (requestedStatus === 'opened' || requestedStatus === 'sent')
  ) {
    return { kind: 'blocked', reason: currentStatus };
  }

  if (
    requestedStatus === 'opened' &&
    ['sent', 'replied', 'interested', 'deposit_pending', 'booked'].includes(currentStatus)
  ) {
    return { kind: 'stale' };
  }

  if (ALLOWED_CONTACT_TRANSITIONS[currentStatus].includes(requestedStatus)) {
    return { kind: 'apply', to: requestedStatus };
  }

  return { kind: 'invalid', code: 'INVALID_TRANSITION' };
}

export const BOOKING_STATUSES = [
  'inquiry',
  'quoted',
  'deposit_pending',
  'booked',
  'attended',
  'cancelled',
  'refunded',
] as const;

const money = z.coerce.number().finite().min(0).max(10_000_000).default(0);

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(3).max(180),
  campaignType: z.enum(['house_event', 'private_pipeline']).default('house_event'),
  audienceRule: z.enum(['all_consented', 'wine', 'vip']).default('all_consented'),
  eventDate: z.string().date(),
  eventTime: z.string().trim().max(40).optional().nullable(),
  offerName: z.string().trim().min(3).max(220),
  messageText: z.string().trim().min(20).max(5000),
  pricePerPerson: money,
  capacity: z.coerce.number().int().min(1).max(10000),
  minimumSeats: z.coerce.number().int().min(0).max(10000).default(0),
  baselineSeats: z.coerce.number().int().min(0).max(10000).default(0),
  attributionDays: z.coerce.number().int().min(1).max(180).default(30),
  feePercent: z.coerce.number().finite().min(0).max(100).default(12),
});

export const campaignPatchSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
});

export const campaignContactPatchSchema = z.object({
  status: z.enum(CONTACT_STATUSES),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const campaignBookingSchema = z.object({
  contactId: z.coerce.number().int().positive().optional().nullable(),
  clientName: z.string().trim().min(1).max(200),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  partySize: z.coerce.number().int().min(1).max(10000),
  status: z.enum(BOOKING_STATUSES).default('inquiry'),
  attributionSource: z.enum(['direct', 'matched', 'assisted', 'organic']).default('direct'),
  attributionEvidence: z.string().trim().max(2000).optional().nullable(),
  bookedAmount: money,
  depositAmount: money,
  collectedAmount: money,
  refundedAmount: money,
  ivaAmount: money,
  serviceChargeAmount: money,
  gratuityAmount: money,
});

function cents(value: number): number {
  return Math.round(value * 100);
}

function moneyString(valueInCents: number): string {
  return (valueInCents / 100).toFixed(2);
}

export function calculateBookingEconomics(
  input: Pick<
    z.infer<typeof campaignBookingSchema>,
    | 'collectedAmount'
    | 'refundedAmount'
    | 'ivaAmount'
    | 'serviceChargeAmount'
    | 'gratuityAmount'
    | 'attributionSource'
  >,
  feePercent: number,
): { eligibleRevenue: string; feeAmount: string } {
  if (input.attributionSource === 'organic') {
    return { eligibleRevenue: '0.00', feeAmount: '0.00' };
  }

  const eligibleCents = Math.max(
    0,
    cents(input.collectedAmount) -
      cents(input.refundedAmount) -
      cents(input.ivaAmount) -
      cents(input.serviceChargeAmount) -
      cents(input.gratuityAmount),
  );
  const feeCents = Math.round((eligibleCents * feePercent) / 100);
  return {
    eligibleRevenue: moneyString(eligibleCents),
    feeAmount: moneyString(feeCents),
  };
}

export function contactTimestamps(status: ContactStatus, now = new Date()) {
  return {
    ...(status === 'opened' ? { openedAt: now } : {}),
    ...(status === 'sent' ? { sentAt: now } : {}),
    ...(status === 'replied' || status === 'interested' || status === 'deposit_pending' || status === 'booked'
      ? { repliedAt: now }
      : {}),
    ...(status === 'opted_out' ? { optedOutAt: now } : {}),
    lastActionAt: now,
    updatedAt: now,
  };
}
