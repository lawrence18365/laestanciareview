import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const TEST_SALT = 'review-device-test-salt';
const ORIGINAL_REVIEW_DEVICE_SALT = process.env.REVIEW_DEVICE_SALT;

const mocks = vi.hoisted(() => ({
  reviewCountsByHash: new Map<string, number>(),
  insertedValues: [] as Array<Record<string, unknown>>,
  selectConditions: [] as unknown[],
  dbInsert: vi.fn(),
  dbSelect: vi.fn(),
  checkRateLimitAsync: vi.fn(async () => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
  getRestaurantBySlug: vi.fn(async () => ({
    id: 17,
    name: 'La Estancia',
    googleReviewUrl: 'https://g.page/r/example/review',
  })),
  getStaffByCode: vi.fn(async () => ({ id: 23, name: 'Ana' })),
  trackCommercialEvent: vi.fn(async () => undefined),
}));

vi.mock('@/db', () => ({
  db: {
    select: mocks.dbSelect.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (condition: unknown) => {
          mocks.selectConditions.push(condition);
          const query = new PgDialect().sqlToQuery(condition as SQL);
          const deviceHash = query.params.find(
            (param) => typeof param === 'string' && /^[a-f0-9]{64}$/.test(param),
          );
          return [{ count: mocks.reviewCountsByHash.get(String(deviceHash)) ?? 0 }];
        }),
      })),
    })),
    insert: mocks.dbInsert.mockImplementation(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
        return {
          returning: vi.fn(async () => [{ id: 91 }]),
        };
      }),
    })),
  },
}));

vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: mocks.getRestaurantBySlug,
  getStaffByCode: mocks.getStaffByCode,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
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

import { POST } from '@/app/api/reviews/submit/route';
import { t } from '@/lib/i18n';

afterAll(() => {
  if (ORIGINAL_REVIEW_DEVICE_SALT === undefined) {
    delete process.env.REVIEW_DEVICE_SALT;
  } else {
    process.env.REVIEW_DEVICE_SALT = ORIGINAL_REVIEW_DEVICE_SALT;
  }
});

function deviceHash(deviceId: string): string {
  return createHash('sha256')
    .update(`${TEST_SALT}|${deviceId}`)
    .digest('hex');
}

function submitRequest(ip: string, userAgent: string, deviceId?: string): NextRequest {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': userAgent,
    'x-forwarded-for': `${ip}, 10.0.0.2`,
    'x-real-ip': '198.51.100.200',
  });
  if (deviceId) headers.set('cookie', `rt_device=${deviceId}`);

  return new NextRequest('https://app.ratetapmx.com/api/reviews/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      restaurantSlug: 'la-estancia',
      staffCode: ' ANA-01 ',
      rating: 5,
    }),
  });
}

describe('POST /api/reviews/submit device limit', () => {
  beforeEach(() => {
    process.env.REVIEW_DEVICE_SALT = TEST_SALT;
    mocks.reviewCountsByHash.clear();
    mocks.insertedValues.length = 0;
    mocks.selectConditions.length = 0;
    mocks.dbInsert.mockClear();
    mocks.dbSelect.mockClear();
    mocks.checkRateLimitAsync.mockClear();
    mocks.getRestaurantBySlug.mockClear();
    mocks.getStaffByCode.mockClear();
    mocks.trackCommercialEvent.mockClear();
  });

  it('sets a cookie and never checks the 24-hour limit on the first request', async () => {
    const response = await POST(submitRequest('203.0.113.10', 'Phone Browser A'));
    const setCookie = response.headers.get('set-cookie');
    const newDeviceId = setCookie?.match(/^rt_device=([^;]+);/)?.[1];

    expect(response.status).toBe(200);
    expect(setCookie).toMatch(
      /^rt_device=[0-9a-f-]+; Path=\/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly$/,
    );
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.insertedValues[0]?.deviceHash).toBe(deviceHash(String(newDeviceId)));
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith(
      'submit:rate-limit-ip',
      30,
      60_000,
    );
  });

  it('limits the fourth submission with the same cookie within 24 hours', async () => {
    const deviceId = '550e8400-e29b-41d4-a716-446655440000';
    const hash = deviceHash(deviceId);
    mocks.reviewCountsByHash.set(hash, 3);

    const response = await POST(
      submitRequest('203.0.113.10', 'Phone Browser A', deviceId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, limited: true });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.getStaffByCode).not.toHaveBeenCalled();
  });

  it('does not limit a different cookie', async () => {
    const firstHash = deviceHash('550e8400-e29b-41d4-a716-446655440000');
    const secondHash = deviceHash('550e8400-e29b-41d4-a716-446655440001');
    mocks.reviewCountsByHash.set(firstHash, 3);

    const response = await POST(
      submitRequest(
        '203.0.113.10',
        'Phone Browser A',
        '550e8400-e29b-41d4-a716-446655440001',
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).not.toHaveProperty('limited');
    expect(mocks.dbInsert).toHaveBeenCalledOnce();
    expect(mocks.insertedValues[0]?.deviceHash).toBe(secondHash);
    expect(secondHash).not.toBe(firstHash);
  });

  it('uses the same hash for the same cookie across user agents', async () => {
    const deviceId = '550e8400-e29b-41d4-a716-446655440002';
    const expectedHash = deviceHash(deviceId);

    const firstResponse = await POST(
      submitRequest('192.0.2.44', 'Mozilla/5.0 Test Phone', deviceId),
    );
    const secondResponse = await POST(
      submitRequest('198.51.100.44', 'Different Browser', deviceId),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(mocks.insertedValues).toHaveLength(2);
    expect(mocks.insertedValues[0]).toMatchObject({
      restaurantId: 17,
      staffId: 23,
      staffCode: 'ANA-01',
      staffName: 'Ana',
      deviceHash: expectedHash,
    });
    expect(mocks.insertedValues[1]?.deviceHash).toBe(expectedHash);
  });
});

describe('guest-facing i18n', () => {
  it('contains no waiter placeholder or waiter label', () => {
    const guestCopy = [
      t.starRating.howWasYourExperience('Restaurante Ejemplo'),
      t.starRating.submittingRating,
      t.starRating.tapToRate,
      t.starRating.rateStars(1),
      t.starRating.rateStars(5),
      t.starRating.somethingWrong,
      t.starRating.tryAgain,
      t.starRating.alreadyReceived,
      t.feedbackForm.thankYou,
      t.feedbackForm.feedbackShared('Restaurante Ejemplo'),
      t.feedbackForm.howToImprove,
      t.feedbackForm.name,
      t.feedbackForm.email,
      t.feedbackForm.optional,
      t.feedbackForm.yourName,
      t.feedbackForm.yourEmail,
      t.feedbackForm.whatCouldWeDoBetter,
      t.feedbackForm.tellUsAboutExperience,
      t.feedbackForm.submitting,
      t.feedbackForm.shareFeedback,
      t.feedbackForm.submitReminder,
      t.feedbackForm.somethingWrong,
      t.feedbackForm.invalidLink,
    ].join(' ');

    expect(guestCopy).not.toMatch(/staffName|waiter|\bmeser[oa]s?\b|\bcamarer[oa]s?\b/i);
    expect(t.starRating.howWasYourExperience('La Estancia')).toBe(
      '¿Cómo fue su experiencia en La Estancia?',
    );
  });
});
