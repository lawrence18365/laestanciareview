import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  updatedValues: [] as Array<Record<string, unknown>>,
  whereConditions: [] as unknown[],
  dbUpdate: vi.fn(),
  verifySession: vi.fn(async () => ({ slug: 'estancia-leon', role: 'gm' as const })),
  getRestaurantBySlug: vi.fn(async () => ({ id: 77, slug: 'estancia-leon' })),
}));

vi.mock('@/db', () => ({
  db: {
    update: mocks.dbUpdate.mockImplementation(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return {
          where: vi.fn(async (condition: unknown) => {
            mocks.whereConditions.push(condition);
          }),
        };
      }),
    })),
  },
}));

vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));

import { DELETE } from '@/app/api/push/subscribe/route';

function deleteRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.ratetapmx.com/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DELETE /api/push/subscribe', () => {
  beforeEach(() => {
    mocks.updatedValues.length = 0;
    mocks.whereConditions.length = 0;
    mocks.dbUpdate.mockClear();
    mocks.verifySession.mockClear();
    mocks.getRestaurantBySlug.mockClear();
  });

  it('rejects any revocation reason outside the client allow-list', async () => {
    const response = await DELETE(
      deleteRequest({ endpoint: 'https://push.example/sub-1', reason: 'endpoint_invalid' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Motivo inválido' });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['an omitted reason', undefined],
    ['an explicit user reason', 'user_unsubscribe'],
  ])('uses user_unsubscribe for %s', async (_label, reason) => {
    const response = await DELETE(
      deleteRequest({ endpoint: 'https://push.example/sub-1', reason }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updatedValues[0]?.revokedReason).toBe('user_unsubscribe');
  });

  it('accepts permission_revoked and leaves an already-revoked row untouched', async () => {
    const response = await DELETE(
      deleteRequest({
        endpoint: 'https://push.example/sub-1',
        reason: 'permission_revoked',
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updatedValues[0]?.revokedReason).toBe('permission_revoked');

    const condition = mocks.whereConditions[0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"push_subscriptions"."revoked_at" is null');
  });
});
