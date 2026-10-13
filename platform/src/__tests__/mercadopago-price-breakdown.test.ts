import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getPriceBreakdown with MERCADOPAGO_MONTHLY_AMOUNT_MXN set', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps the total and makes the lines sum to it', async () => {
    vi.resetModules();
    vi.stubEnv('MERCADOPAGO_MONTHLY_AMOUNT_MXN', '850');
    const { getPriceBreakdown } = await import('@/lib/mercadopago');

    const b = getPriceBreakdown();

    expect(b.total).toBe(850);
    expect(b.base + b.processingCharge + b.tax).toBe(850);
  });

  it('is unchanged when the override is unset (flat 700)', async () => {
    vi.resetModules();
    vi.stubEnv('MERCADOPAGO_MONTHLY_AMOUNT_MXN', '');
    const { getPriceBreakdown } = await import('@/lib/mercadopago');

    expect(getPriceBreakdown()).toEqual({ base: 700, processingCharge: 0, tax: 0, total: 700 });
  });
});
