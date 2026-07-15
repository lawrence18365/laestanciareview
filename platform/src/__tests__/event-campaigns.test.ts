import { describe, expect, it } from 'vitest';
import { calculateBookingEconomics, contactTimestamps } from '@/lib/event-campaigns';

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
