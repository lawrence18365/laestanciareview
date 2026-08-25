import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  updatedValues: [] as Array<Record<string, unknown>>,
  whereConditions: [] as unknown[],
  selectedRows: [] as Array<{ id: number }>,
  selectWhereConditions: [] as unknown[],
  dbUpdate: vi.fn(),
  dbSelect: vi.fn(),
  verifySession: vi.fn(
    async (): Promise<{ slug: string; role: 'gm' } | null> => ({
      slug: 'estancia-leon',
      role: 'gm',
    }),
  ),
  getRestaurantBySlug: vi.fn(async () => ({ id: 77, slug: 'estancia-leon' })),
}));

vi.mock('@/db', () => ({
  db: {
    select: mocks.dbSelect.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          mocks.selectWhereConditions.push(condition);
          return { limit: vi.fn(async () => [...mocks.selectedRows]) };
        }),
      })),
    })),
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

import { DELETE, GET } from '@/app/api/push/subscribe/route';

function getRequest(endpoint: string): NextRequest {
  const query = new URLSearchParams({ endpoint });
  return new NextRequest(`https://app.ratetapmx.com/api/push/subscribe?${query}`);
}

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
    mocks.selectedRows.length = 0;
    mocks.selectWhereConditions.length = 0;
    mocks.dbUpdate.mockClear();
    mocks.dbSelect.mockClear();
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

describe('GET /api/push/subscribe', () => {
  beforeEach(() => {
    mocks.selectedRows.length = 0;
    mocks.selectWhereConditions.length = 0;
    mocks.dbSelect.mockClear();
    mocks.verifySession.mockClear();
    mocks.getRestaurantBySlug.mockClear();
  });

  it('returns active for an active endpoint scoped to the session restaurant', async () => {
    mocks.selectedRows.push({ id: 12 });

    const response = await GET(getRequest('https://push.example/active'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: true });

    const condition = mocks.selectWhereConditions[0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"push_subscriptions"."restaurant_id" =');
    expect(query.sql).toContain('"push_subscriptions"."revoked_at" is null');
    expect(query.params).toEqual([77, 'https://push.example/active']);
  });

  it('returns inactive for an unknown endpoint', async () => {
    const response = await GET(getRequest('https://push.example/unknown'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it('returns inactive for a revoked endpoint', async () => {
    const response = await GET(getRequest('https://push.example/revoked'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });

    const condition = mocks.selectWhereConditions[0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"push_subscriptions"."revoked_at" is null');
  });

  it('rejects unauthenticated access without querying subscriptions', async () => {
    mocks.verifySession.mockResolvedValueOnce(null);

    const response = await GET(getRequest('https://push.example/active'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'No autorizado' });
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });
});
