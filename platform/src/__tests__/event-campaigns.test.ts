import { describe, expect, it } from 'vitest';
import {
  calculateBookingEconomics,
  contactTimestamps,
  decideContactTransition,
} from '@/lib/event-campaigns';

describe('calculateBookingEconomics', () => {
  it('calculates the fee on collected revenue after agreed exclusions', () => {
    expect(
      calculateBookingEconomics(
        {
          collectedAmount: 10_000,
          refundedAmount: 500,
          ivaAmount: 1_200,
          serviceChargeAmount: 300,
          gratuityAmount: 200,
          attributionSource: 'direct',
        },
        12,
      ),
    ).toEqual({ eligibleRevenue: '7800.00', feeAmount: '936.00' });
  });

  it('never creates negative eligible revenue', () => {
    expect(
      calculateBookingEconomics(
        {
          collectedAmount: 100,
          refundedAmount: 150,
          ivaAmount: 0,
          serviceChargeAmount: 0,
          gratuityAmount: 0,
          attributionSource: 'matched',
        },
        12,
      ),
    ).toEqual({ eligibleRevenue: '0.00', feeAmount: '0.00' });
  });

  it('excludes organic bookings from performance billing', () => {
    expect(
      calculateBookingEconomics(
        {
          collectedAmount: 50_000,
          refundedAmount: 0,
          ivaAmount: 0,
          serviceChargeAmount: 0,
          gratuityAmount: 0,
          attributionSource: 'organic',
        },
        12,
      ),
    ).toEqual({ eligibleRevenue: '0.00', feeAmount: '0.00' });
  });

  it('rounds fees in cents rather than binary floating point', () => {
    expect(
      calculateBookingEconomics(
        {
          collectedAmount: 1_599,
          refundedAmount: 0,
          ivaAmount: 0,
          serviceChargeAmount: 0,
          gratuityAmount: 0,
          attributionSource: 'assisted',
        },
        12,
      ),
    ).toEqual({ eligibleRevenue: '1599.00', feeAmount: '191.88' });
  });
});

describe('contactTimestamps', () => {
  it('does not confuse opening WhatsApp with a sent message', () => {
    const now = new Date('2026-07-14T12:00:00Z');
    const opened = contactTimestamps('opened', now);
    expect(opened.openedAt).toEqual(now);
    expect('sentAt' in opened).toBe(false);
  });
});

describe('decideContactTransition', () => {
  it('applies queued to opened', () => {
    expect(decideContactTransition({ currentStatus: 'queued', requestedStatus: 'opened' }))
      .toEqual({ kind: 'apply', to: 'opened' });
  });

  it('treats the same status as an idempotent no-op', () => {
    expect(decideContactTransition({ currentStatus: 'opened', requestedStatus: 'opened' }))
      .toEqual({ kind: 'noop' });
  });

  it.each(['sent', 'replied', 'interested', 'deposit_pending', 'booked'] as const)(
    'treats %s to opened as stale without moving backward',
    (currentStatus) => {
      expect(decideContactTransition({ currentStatus, requestedStatus: 'opened' }))
        .toEqual({ kind: 'stale' });
    },
  );

  it.each(['opted_out', 'declined'] as const)(
    'blocks outbound WhatsApp for %s contacts',
    (currentStatus) => {
      expect(decideContactTransition({ currentStatus, requestedStatus: 'opened' }))
        .toEqual({ kind: 'blocked', reason: currentStatus });
    },
  );

  it('returns a stable result for a genuinely invalid transition', () => {
    const result = decideContactTransition({ currentStatus: 'queued', requestedStatus: 'booked' });
    expect(result).toEqual({ kind: 'invalid', code: 'INVALID_TRANSITION' });
    expect(JSON.stringify(result)).not.toContain('Illegal transition');
  });

  it.each([
    ['queued', 'opened'],
    ['opened', 'sent'],
    ['sent', 'replied'],
    ['sent', 'interested'],
    ['replied', 'interested'],
    ['replied', 'deposit_pending'],
    ['interested', 'booked'],
  ] as const)('keeps the normal forward path %s to %s', (currentStatus, requestedStatus) => {
    expect(decideContactTransition({ currentStatus, requestedStatus }))
      .toEqual({ kind: 'apply', to: requestedStatus });
  });
});
