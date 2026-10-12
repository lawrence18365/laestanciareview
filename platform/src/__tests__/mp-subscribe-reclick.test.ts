/**
 * POST /api/billing/mercadopago/subscribe — re-click guard.
 *
 * Our row can still say `pending` after the customer authorized on Mercado
 * Pago (the webhook has not landed). Re-clicking must NOT cancel that
 * preapproval: the route reads its live status first and, if authorized,
 * answers "confirming payment" instead of cancelling and reissuing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  existingRows: [] as Array<Record<string, unknown>>,
  createPreapproval: vi.fn(),
  cancelPreapproval: vi.fn(),
  getPreapproval: vi.fn(),
}));

vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/session', () => ({ verifySession: vi.fn(async () => ({ slug: 'mi-cocina' })) }));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => ({
    id: 77,
    slug: 'mi-cocina',
    managerEmail: 'gm@example.com',
    subscriptionStatus: 'canceled',
    trialEndsAt: new Date('2026-08-01T00:00:00.000Z'),
  })),
}));
vi.mock('@/db', () => ({
  db: {
    // Every lookup returns the same pending row; only the re-click path matters here.
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.existingRows) })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => ({ rowCount: 1 })) })),
    })),
  },
}));
vi.mock('@/lib/mercadopago', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/mercadopago')>();
  return {
    ...original,
    MERCADOPAGO_ACCESS_TOKEN: 'test-access-token',
    createPreapproval: mocks.createPreapproval,
    cancelPreapproval: mocks.cancelPreapproval,
    getPreapproval: mocks.getPreapproval,
  };
});

import { POST } from '@/app/api/billing/mercadopago/subscribe/route';

function subscribeRequest() {
  return new NextRequest('https://app.ratetapmx.com/api/billing/mercadopago/subscribe', {
    method: 'POST',
  });
}

beforeEach(() => {
  mocks.existingRows.length = 0;
  mocks.existingRows.push({ id: 5, restaurantId: 77, status: 'pending', preapprovalId: 'pre-old' });
  mocks.createPreapproval.mockReset();
  mocks.createPreapproval.mockResolvedValue({
    id: 'pre-new',
    init_point: 'https://mp.test/pre-new',
    status: 'pending',
  });
  mocks.cancelPreapproval.mockReset();
  mocks.getPreapproval.mockReset();
});

describe('POST /api/billing/mercadopago/subscribe re-click guard', () => {
  it('does NOT cancel or reissue when the live preapproval is already authorized', async () => {
    mocks.getPreapproval.mockResolvedValue({ id: 'pre-old', status: 'authorized' });

    const response = await POST(subscribeRequest());
    const body = await response.json();

    expect(mocks.getPreapproval).toHaveBeenCalledWith('pre-old');
    expect(response.status).toBe(202);
    expect(body).toEqual({ pending: true, message: 'Estamos confirmando tu pago…' });
    expect(mocks.cancelPreapproval).not.toHaveBeenCalled();
    expect(mocks.createPreapproval).not.toHaveBeenCalled();
  });

  it('cancels and reissues when the live preapproval is still pending', async () => {
    mocks.getPreapproval.mockResolvedValue({ id: 'pre-old', status: 'pending' });

    const response = await POST(subscribeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://mp.test/pre-new');
    expect(mocks.cancelPreapproval).toHaveBeenCalledWith('pre-old');
    expect(mocks.createPreapproval).toHaveBeenCalledTimes(1);
  });

  it('aborts without cancelling when the live status cannot be read', async () => {
    mocks.getPreapproval.mockRejectedValue(new Error('Mercado Pago getPreapproval failed (500): boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(502);
    expect(mocks.cancelPreapproval).not.toHaveBeenCalled();
    expect(mocks.createPreapproval).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reissues when the old preapproval no longer exists (404)', async () => {
    mocks.getPreapproval.mockRejectedValue(new Error('Mercado Pago getPreapproval failed (404): not found'));

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancelPreapproval).toHaveBeenCalledWith('pre-old');
    expect(mocks.createPreapproval).toHaveBeenCalledTimes(1);
  });
});
