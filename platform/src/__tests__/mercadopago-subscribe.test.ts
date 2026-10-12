/**
 * POST /api/billing/mercadopago/subscribe — the first-charge date.
 *
 * computeBillingStartDate() bills from the restaurant's own trial end and falls
 * back to `now + 10 minutes` when there is no trial left (Mercado Pago needs a
 * future start_date). That floor would charge a LEGACY account — one already
 * `active` but never in Mercado Pago because it paid outside the app — almost
 * immediately, so it keeps the 30-day window it is conceptually still on. These
 * tests pin the legacy branch and every non-legacy one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  /** Rows returned by the `status <> 'cancelled'` (live-subscription) lookup. */
  nonCancelledRows: [] as Array<Record<string, unknown>>,
  /** Rows returned by the any-status lookup ("has it ever been in MP?"). */
  anyRows: [] as Array<Record<string, unknown>>,
  insertedValues: [] as Array<Record<string, unknown>>,
  createPreapproval: vi.fn(),
  cancelPreapproval: vi.fn(),
  getPreapproval: vi.fn(),
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  restaurant: {
    id: 77,
    slug: 'mi-cocina',
    managerEmail: 'gm@example.com',
    subscriptionStatus: 'trialing',
    trialEndsAt: null as Date | null,
  },
}));

/**
 * Drizzle renders conditions as StringChunk wrappers with Params for values.
 * Flatten both so the mock can tell the two `mercadopago_subscriptions` lookups
 * apart (the live one mentions 'cancelled', the any-status one does not).
 */
function flatten(node: unknown, depth = 0): { text: string; params: unknown[] } {
  if (depth > 10 || node == null) return { text: '', params: [] };
  if (typeof node === 'string') return { text: node, params: [] };
  if (typeof node !== 'object') return { text: '', params: [] };

  const ctor = (node as { constructor?: { name?: string } }).constructor?.name ?? '';
  const value = (node as { value?: unknown }).value;
  if (ctor === 'StringChunk') {
    return { text: Array.isArray(value) ? value.join('') : String(value ?? ''), params: [] };
  }
  if (ctor === 'Param') return { text: '', params: [value] };

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return { text: '', params: [] };

  let text = '';
  const params: unknown[] = [];
  for (const chunk of chunks) {
    const part = flatten(chunk, depth + 1);
    text += part.text;
    params.push(...part.params);
  }
  return { text, params };
}

vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => ({
          limit: vi.fn(async () => {
            const { text, params } = flatten(condition);
            const searchable = [text, ...params.map(String)].join(' ').toLowerCase();
            return searchable.includes('cancelled')
              ? mocks.nonCancelledRows
              : mocks.anyRows;
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
      }),
    })),
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
import { BILLING_START_DATE, legacyBillingStartDate } from '@/lib/mercadopago';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function subscribeRequest() {
  return new NextRequest('https://app.ratetapmx.com/api/billing/mercadopago/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

/** The `startDate` the route actually asked Mercado Pago for. */
function requestedStartDate(): Date {
  const call = mocks.createPreapproval.mock.calls[0]?.[0] as { startDate?: Date };
  expect(call?.startDate).toBeInstanceOf(Date);
  return call.startDate as Date;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.nonCancelledRows.length = 0;
  mocks.anyRows.length = 0;
  mocks.insertedValues.length = 0;
  mocks.createPreapproval.mockReset();
  mocks.createPreapproval.mockResolvedValue({
    id: 'pre-1',
    init_point: 'https://mp.test/pre-1',
    status: 'pending',
  });
  mocks.cancelPreapproval.mockReset();
  mocks.getPreapproval.mockReset();
  mocks.getPreapproval.mockResolvedValue({ id: 'preapproval-old', status: 'pending' });
  mocks.verifySession.mockReset();
  mocks.verifySession.mockResolvedValue({ slug: 'mi-cocina' });
  mocks.getRestaurantBySlug.mockReset();
  mocks.restaurant.subscriptionStatus = 'trialing';
  mocks.restaurant.trialEndsAt = null;
  mocks.getRestaurantBySlug.mockImplementation(async () => ({ ...mocks.restaurant }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/billing/mercadopago/subscribe first-charge date', () => {
  it('gives a legacy active account (no Mercado Pago row at all) a 30-day window', async () => {
    mocks.restaurant.subscriptionStatus = 'active';

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    const startDate = requestedStartDate();
    expect(startDate.getTime()).toBe(legacyBillingStartDate(NOW).getTime());
    expect(startDate.getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
    // Never BEFORE the global launch date, and never ~now + 10 minutes.
    expect(startDate.getTime()).toBeGreaterThan(BILLING_START_DATE.getTime());
    expect(startDate.getTime()).toBeGreaterThan(NOW.getTime() + DAY_MS);
    // The promised date is persisted on the new subscription row.
    expect(mocks.insertedValues[0]).toEqual(
      expect.objectContaining({ restaurantId: 77, billingStartsAt: startDate }),
    );
  });

  it('does not treat an active account that has been in Mercado Pago as legacy', async () => {
    mocks.restaurant.subscriptionStatus = 'active';
    mocks.restaurant.trialEndsAt = new Date('2026-08-01T00:00:00.000Z'); // expired
    // A cancelled row proves it has been through Mercado Pago before, even
    // though there is no live subscription row to reuse.
    mocks.anyRows.push({ id: 5, restaurantId: 77, status: 'cancelled' });

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    // Expired trial → the global launch date, NOT a fresh 30 days.
    expect(requestedStartDate().getTime()).toBe(BILLING_START_DATE.getTime());
  });

  it('bills a trialing account from its own trial end, not from a fixed window', async () => {
    mocks.restaurant.subscriptionStatus = 'trialing';
    mocks.restaurant.trialEndsAt = new Date('2026-09-15T00:00:00.000Z');

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    expect(requestedStartDate().toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('bills a trialing account with an expired trial at the next possible moment', async () => {
    mocks.restaurant.subscriptionStatus = 'trialing';
    mocks.restaurant.trialEndsAt = new Date('2026-08-01T00:00:00.000Z');

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    const startDate = requestedStartDate();
    // The launch date is later than now + 10min here; either way it is NOT a
    // second free month.
    expect(startDate.getTime()).toBeLessThan(NOW.getTime() + 30 * DAY_MS);
  });

  it('keeps a live pending subscription on its own start date and cancels the old link', async () => {
    mocks.restaurant.subscriptionStatus = 'trialing';
    mocks.restaurant.trialEndsAt = new Date('2026-09-15T00:00:00.000Z');
    mocks.anyRows.push({
      id: 5,
      restaurantId: 77,
      status: 'pending',
      preapprovalId: 'preapproval-old',
    });
    mocks.nonCancelledRows.push({
      id: 5,
      restaurantId: 77,
      status: 'pending',
      preapprovalId: 'preapproval-old',
    });

    const response = await POST(subscribeRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancelPreapproval).toHaveBeenCalledWith('preapproval-old');
    expect(requestedStartDate().toISOString()).toBe('2026-09-15T00:00:00.000Z');
    // Reissued in place: no second row for the same restaurant.
    expect(mocks.insertedValues).toHaveLength(0);
  });
});
