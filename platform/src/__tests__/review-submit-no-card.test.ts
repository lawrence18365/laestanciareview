import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// A guest who opens /r/<slug> without ?card=CODE sends staffCode ''. That is
// "no server", not invalid input: the review must be stored unattributed.

const mocks = vi.hoisted(() => ({
  insertedValues: [] as Array<Record<string, unknown>>,
  getStaffByCode: vi.fn(async (): Promise<{ id: number; name: string } | null> => null),
  trackCommercialEvent: vi.fn(async () => undefined),
}));

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
        return { returning: vi.fn(async () => [{ id: 91 }]) };
      }),
    })),
  },
}));

vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => ({
    id: 17,
    name: 'La Estancia',
    googleReviewUrl: 'https://g.page/r/example/review',
  })),
  getStaffByCode: mocks.getStaffByCode,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
  getClientIP: vi.fn(() => 'rate-limit-ip'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/tokens', () => ({
  randomToken: vi.fn(() => 'feedback-token'),
  tokenHash: vi.fn(async () => 'feedback-token-hash'),
}));
vi.mock('@/lib/commercial-tracking', () => ({
  trackCommercialEvent: mocks.trackCommercialEvent,
}));
vi.mock('@/lib/product-events', () => ({ recordProductEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/complaint-sla', () => ({ scheduleComplaintSlaSweep: vi.fn() }));

import { POST } from '@/app/api/reviews/submit/route';

function submit(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.ratetapmx.com/api/reviews/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reviews/submit without a card', () => {
  beforeEach(() => {
    mocks.insertedValues.length = 0;
    mocks.getStaffByCode.mockClear();
    mocks.getStaffByCode.mockResolvedValue(null);
  });

  it.each([
    ['empty staffCode', { restaurantSlug: 'la-estancia', staffCode: '', rating: 5 }],
    ['whitespace-only staffCode', { restaurantSlug: 'la-estancia', staffCode: '   ', rating: 5 }],
    ['omitted staffCode', { restaurantSlug: 'la-estancia', rating: 5 }],
  ])('accepts %s and stores the review with no staff attribution', async (_label, body) => {
    const response = await POST(submit(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reviewId: 91,
      action: 'choice',
    });
    expect(mocks.getStaffByCode).not.toHaveBeenCalled();
    expect(mocks.insertedValues).toHaveLength(1);
    expect(mocks.insertedValues[0]).toMatchObject({
      restaurantId: 17,
      staffId: null,
      staffCode: null,
      staffName: null,
      rating: 5,
      sentToGoogle: false,
    });
  });

  it('keeps today\'s behavior for an unknown non-empty code: stored, unattributed', async () => {
    const response = await POST(
      submit({ restaurantSlug: 'la-estancia', staffCode: ' NOPE-99 ', rating: 4 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getStaffByCode).toHaveBeenCalledWith(17, 'NOPE-99');
    expect(mocks.insertedValues[0]).toMatchObject({
      staffId: null,
      staffCode: 'NOPE-99',
      staffName: 'NOPE-99',
    });
  });

  it('still attributes a valid code to its server', async () => {
    mocks.getStaffByCode.mockResolvedValue({ id: 23, name: 'Ana' });
    const response = await POST(
      submit({ restaurantSlug: 'la-estancia', staffCode: 'ANA-01', rating: 5 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.insertedValues[0]).toMatchObject({
      staffId: 23,
      staffCode: 'ANA-01',
      staffName: 'Ana',
    });
  });

  it('still rejects an invalid rating', async () => {
    const response = await POST(
      submit({ restaurantSlug: 'la-estancia', staffCode: '', rating: 9 }),
    );
    expect(response.status).toBe(400);
    expect(mocks.insertedValues).toHaveLength(0);
  });
});
