import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_START_DATE,
  computeBillingStartDate,
  isLegacyActiveAccount,
  legacyBillingStartDate,
} from '@/lib/mercadopago';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeBillingStartDate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('starts billing at the restaurant own trial end when that is later', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const trialEndsAt = new Date(now.getTime() + 20 * DAY_MS);

    expect(computeBillingStartDate({ trialEndsAt, now }).getTime()).toBe(
      trialEndsAt.getTime(),
    );
  });

  it('never mints a second free trial once the trial has already ended', () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const trialEndsAt = new Date(now.getTime() - 5 * DAY_MS);

    const start = computeBillingStartDate({ trialEndsAt, now });

    // ~now + 10 minutes (Mercado Pago needs a future start_date), NOT now + 30d.
    expect(start.getTime()).toBe(now.getTime() + 10 * MINUTE_MS);
    expect(start.getTime()).toBeLessThan(now.getTime() + DAY_MS);
  });

  it('is never earlier than max(trialEndsAt, now + 10min, BILLING_START_DATE)', () => {
    const cases: Array<{ now: string; trialEndsAt: string | null }> = [
      // Before the global launch date, no trial at all.
      { now: '2026-07-15T12:00:00.000Z', trialEndsAt: null },
      // Before the global launch date, trial ends before it.
      { now: '2026-07-15T12:00:00.000Z', trialEndsAt: '2026-07-20T12:00:00.000Z' },
      // Before the global launch date, trial still running past it.
      { now: '2026-08-21T12:00:00.000Z', trialEndsAt: '2026-09-10T12:00:00.000Z' },
      // After the global launch date, trial long expired.
      { now: '2026-12-01T12:00:00.000Z', trialEndsAt: '2026-11-01T12:00:00.000Z' },
      // After the global launch date, trial still running.
      { now: '2026-12-01T12:00:00.000Z', trialEndsAt: '2026-12-20T12:00:00.000Z' },
    ];

    for (const c of cases) {
      const now = new Date(c.now);
      const trialEndsAt = c.trialEndsAt ? new Date(c.trialEndsAt) : null;
      const start = computeBillingStartDate({ trialEndsAt, now });

      const lowerBound = Math.max(
        BILLING_START_DATE.getTime(),
        now.getTime() + 10 * MINUTE_MS,
        trialEndsAt ? trialEndsAt.getTime() : 0,
      );

      expect(start.getTime()).toBe(lowerBound);
      // Defensive: never mutate or hand out the shared constant.
      if (start.getTime() === BILLING_START_DATE.getTime()) {
        expect(start).not.toBe(BILLING_START_DATE);
      }
    }
  });

  it('falls back to the global start date when the trial is not the constraint', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');

    // now + 10min and the (absent) trial are both before Sep 1 2026.
    expect(computeBillingStartDate({ now }).getTime()).toBe(
      BILLING_START_DATE.getTime(),
    );
    expect(
      computeBillingStartDate({ trialEndsAt: new Date('2026-08-20T12:00:00.000Z'), now })
        .getTime(),
    ).toBe(BILLING_START_DATE.getTime());
  });

  it('needs no arguments and defaults to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'));

    // No trial: the global launch date (later than now + 10min) wins.
    expect(computeBillingStartDate().getTime()).toBe(BILLING_START_DATE.getTime());
  });
});

describe('legacyBillingStartDate', () => {
  it('gives a legacy active account the retired 30-day window, not now + 10min', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');

    const start = legacyBillingStartDate(now);

    expect(start.getTime()).toBe(now.getTime() + 30 * DAY_MS);
    expect(start.getTime()).toBeGreaterThan(
      computeBillingStartDate({ trialEndsAt: null, now }).getTime(),
    );
  });

  it('never goes back before the global launch date', () => {
    // A re-subscribe long before the launch date cannot undercut it.
    const start = legacyBillingStartDate(new Date('2026-07-15T12:00:00.000Z'));

    expect(start.getTime()).toBe(BILLING_START_DATE.getTime());
  });
});

describe('isLegacyActiveAccount', () => {
  it.each([
    ['active', false, true],
    ['active', true, false],
    ['trialing', false, false],
    ['trialing', true, false],
    ['canceled', false, false],
  ] as const)(
    'status=%s hasMercadopagoRow=%s → %s',
    (subscriptionStatus, hasMercadopagoRow, expected) => {
      expect(isLegacyActiveAccount({ subscriptionStatus, hasMercadopagoRow })).toBe(
        expected,
      );
    },
  );
});
