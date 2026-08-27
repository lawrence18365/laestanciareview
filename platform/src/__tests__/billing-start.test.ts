import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_START_DATE,
  MERCADOPAGO_TRIAL_DAYS,
  computeBillingStartDate,
} from '@/lib/mercadopago';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeBillingStartDate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('defaults to a 30-day trial window', () => {
    expect(MERCADOPAGO_TRIAL_DAYS).toBe(30);
  });

  it('returns the later of Sep 1 2026 and now + 30 days when now is well before the global start', () => {
    // 2026-08-21 + 30d = 2026-09-20, which is later than BILLING_START_DATE.
    const now = new Date('2026-08-21T12:00:00.000Z');
    const start = computeBillingStartDate(now);

    expect(start.getTime()).toBe(now.getTime() + 30 * DAY_MS);
    expect(start.getTime()).toBeGreaterThan(BILLING_START_DATE.getTime());
  });

  it('returns the global start date when now + 30 days lands before Sep 1 2026', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const start = computeBillingStartDate(now);

    expect(start.getTime()).toBe(BILLING_START_DATE.getTime());
    // Defensive: never mutate or hand out the shared constant.
    expect(start).not.toBe(BILLING_START_DATE);
  });

  it('returns now + 30 days when now is after Sep 1 2026', () => {
    const now = new Date('2026-10-05T12:00:00.000Z');

    expect(computeBillingStartDate(now).getTime()).toBe(now.getTime() + 30 * DAY_MS);
  });

  it('respects the MERCADOPAGO_TRIAL_DAYS env override', async () => {
    vi.stubEnv('MERCADOPAGO_TRIAL_DAYS', '45');
    vi.resetModules();

    const { computeBillingStartDate: computeWithOverride } = await import(
      '@/lib/mercadopago'
    );
    const now = new Date('2026-10-05T12:00:00.000Z');

    expect(computeWithOverride(now).getTime()).toBe(now.getTime() + 45 * DAY_MS);
  });

  it('falls back to 30 days for an invalid MERCADOPAGO_TRIAL_DAYS value', async () => {
    vi.stubEnv('MERCADOPAGO_TRIAL_DAYS', 'not-a-number');
    vi.resetModules();

    const { computeBillingStartDate: computeWithInvalid } = await import(
      '@/lib/mercadopago'
    );
    const now = new Date('2026-10-05T12:00:00.000Z');

    expect(computeWithInvalid(now).getTime()).toBe(now.getTime() + 30 * DAY_MS);
  });

  it.each(['0', '-5', 'NaN', 'Infinity'])(
    'falls back to 30 days when MERCADOPAGO_TRIAL_DAYS is %s',
    async (value) => {
      vi.stubEnv('MERCADOPAGO_TRIAL_DAYS', value);
      vi.resetModules();

      const mod = await import('@/lib/mercadopago');
      const now = new Date('2026-10-05T12:00:00.000Z');

      expect(mod.MERCADOPAGO_TRIAL_DAYS).toBe(30);
      expect(mod.computeBillingStartDate(now).getTime()).toBe(
        now.getTime() + 30 * DAY_MS,
      );
    },
  );
});
