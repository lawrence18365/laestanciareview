import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  updatedValues: [] as Array<Record<string, unknown>>,
  whereConditions: [] as unknown[],
  selectedRows: [] as Array<{ id: number }>,
  selectWhereConditions: [] as unknown[],
  insertedValues: [] as Array<Record<string, unknown>>,
  conflictUpdates: [] as Array<Record<string, unknown>>,
  insertReturningRows: [] as Array<{ id: number }>,
  dbUpdate: vi.fn(),
  dbSelect: vi.fn(),
  dbInsert: vi.fn(),
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
    insert: mocks.dbInsert.mockImplementation(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
        return {
          onConflictDoUpdate: vi.fn((config: Record<string, unknown>) => {
            mocks.conflictUpdates.push(config);
            return {
              returning: vi.fn(async () => [...mocks.insertReturningRows]),
            };
          }),
        };
      }),
    })),
  },
}));

vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));

import { DELETE, GET, POST } from '@/app/api/push/subscribe/route';

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

function postRequest(endpoint = 'https://push.example/sub-1'): NextRequest {
  return new NextRequest('https://app.ratetapmx.com/api/push/subscribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15)',
    },
    body: JSON.stringify({
      endpoint,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      display_mode: 'browser',
    }),
  });
}

function getConflictWhereSql(): string {
  const condition = mocks.conflictUpdates[0]?.setWhere as SQL;
  return new PgDialect().sqlToQuery(condition).sql;
}

/** One row of push_subscriptions, enough to evaluate the route's predicates. */
interface SubscriptionRecord {
  id: number;
  restaurantId: number;
  endpoint: string;
  revokedAt: Date | null;
}

const FIELD_BY_COLUMN: Record<string, keyof SubscriptionRecord> = {
  restaurant_id: 'restaurantId',
  endpoint: 'endpoint',
  revoked_at: 'revokedAt',
};

/**
 * Strip parentheses that wrap the whole expression, so `and(...)` renders as
 * `(a and b)` but can still be split on its top-level operator.
 */
function stripOuterParens(expression: string): string {
  let text = expression.trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') {
        depth--;
        if (depth === 0 && i !== text.length - 1) {
          wrapsWholeExpression = false;
          break;
        }
      }
    }
    if (!wrapsWholeExpression) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function splitTopLevel(expression: string, separator: ' or ' | ' and '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && expression.startsWith(separator, i)) {
      parts.push(expression.slice(start, i).trim());
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts;
}

function evaluatePredicate(
  expression: string,
  params: unknown[],
  row: SubscriptionRecord,
): boolean {
  const text = stripOuterParens(expression);

  const orParts = splitTopLevel(text, ' or ');
  if (orParts.length > 1) {
    return orParts.some((part) => evaluatePredicate(part, params, row));
  }

  const andParts = splitTopLevel(text, ' and ');
  if (andParts.length > 1) {
    return andParts.every((part) => evaluatePredicate(part, params, row));
  }

  const equality = /^(?:"[^"]+"\.)?"([a-z_]+)"\s*=\s*\$(\d+)$/.exec(text);
  if (equality) {
    const field = FIELD_BY_COLUMN[equality[1]];
    return row[field] === params[Number(equality[2]) - 1];
  }

  const nullCheck = /^(?:"[^"]+"\.)?"([a-z_]+)"\s+is\s+(not\s+)?null$/i.exec(text);
  if (nullCheck) {
    const isNull = row[FIELD_BY_COLUMN[nullCheck[1]]] === null;
    return nullCheck[2] ? !isNull : isNull;
  }

  throw new Error(`Unsupported predicate in test db stand-in: ${text}`);
}

/** Evaluate a drizzle predicate against an in-memory row, like Postgres would. */
function matchesCondition(row: SubscriptionRecord, condition: unknown): boolean {
  const query = new PgDialect().sqlToQuery(condition as SQL);
  return evaluatePredicate(query.sql, query.params, row);
}

/** GET: the route selects the row scoped to its restaurant and endpoint. */
function selectFromTable(rows: SubscriptionRecord[]): void {
  mocks.dbSelect.mockImplementationOnce(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        mocks.selectWhereConditions.push(condition);
        const matched = rows.filter((row) => matchesCondition(row, condition));
        return { limit: vi.fn(async () => matched.map((row) => ({ id: row.id }))) };
      }),
    })),
  }));
}

/** DELETE: only rows matching the whole where clause are revoked. */
function revokeInTable(rows: SubscriptionRecord[]): void {
  mocks.dbUpdate.mockImplementationOnce(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      mocks.updatedValues.push(values);
      return {
        where: vi.fn(async (condition: unknown) => {
          mocks.whereConditions.push(condition);
          for (const row of rows) {
            if (matchesCondition(row, condition)) row.revokedAt = new Date();
          }
        }),
      };
    }),
  }));
}

/**
 * POST: emulates `insert … on conflict (endpoint) do update … setWhere` — the
 * guard decides whether an existing endpoint may be claimed, and an empty
 * returning list is what the route reads as a conflict.
 */
function upsertIntoTable(rows: SubscriptionRecord[]): void {
  let nextId = 100;
  mocks.dbInsert.mockImplementationOnce(() => ({
    values: vi.fn((values: Record<string, unknown>) => {
      mocks.insertedValues.push(values);
      return {
        onConflictDoUpdate: vi.fn((config: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            mocks.conflictUpdates.push(config);
            const endpoint = values.endpoint as string;
            const existing = rows.find((row) => row.endpoint === endpoint);
            if (!existing) {
              const created: SubscriptionRecord = {
                id: nextId++,
                restaurantId: values.restaurantId as number,
                endpoint,
                revokedAt: null,
              };
              rows.push(created);
              return [{ id: created.id }];
            }
            if (!matchesCondition(existing, config.setWhere)) return [];
            existing.restaurantId = values.restaurantId as number;
            existing.revokedAt = null;
            return [{ id: existing.id }];
          }),
        })),
      };
    }),
  }));
}

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    mocks.insertedValues.length = 0;
    mocks.conflictUpdates.length = 0;
    mocks.insertReturningRows.length = 0;
    mocks.dbInsert.mockClear();
    mocks.verifySession.mockClear();
    mocks.getRestaurantBySlug.mockClear();
  });

  it('revives an endpoint for the same restaurant', async () => {
    mocks.insertReturningRows.push({ id: 12 });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.insertedValues[0]?.restaurantId).toBe(77);
    expect(mocks.conflictUpdates[0]?.set).toMatchObject({
      restaurantId: 77,
      revokedAt: null,
      revokedReason: null,
      role: 'gm',
    });
    expect(getConflictWhereSql()).toContain('"push_subscriptions"."restaurant_id" =');
  });

  it('refuses to move an active endpoint from another restaurant', async () => {
    const response = await POST(postRequest('https://push.example/owned-elsewhere'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Este dispositivo ya recibe notificaciones de otra cuenta',
      code: 'push_device_conflict',
    });
    const conflictWhere = getConflictWhereSql();
    expect(conflictWhere).toContain('"push_subscriptions"."restaurant_id" =');
    expect(conflictWhere).toContain('"push_subscriptions"."revoked_at" is not null');
  });

  it('refuses restaurant B an endpoint actively owned by restaurant A', async () => {
    const endpoint = 'https://push.example/owned-by-a';
    const table: SubscriptionRecord[] = [
      { id: 12, restaurantId: 77, endpoint, revokedAt: null },
    ];
    mocks.verifySession.mockResolvedValueOnce({ slug: 'otra-cocina', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValueOnce({ id: 88, slug: 'otra-cocina' });
    upsertIntoTable(table);

    const response = await POST(postRequest(endpoint));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Este dispositivo ya recibe notificaciones de otra cuenta',
      code: 'push_device_conflict',
    });
    // The upsert guard is what refuses the move: only rows this account already
    // owns, or revoked rows, may be claimed.
    const conflictWhere = getConflictWhereSql();
    expect(conflictWhere).toContain('"push_subscriptions"."restaurant_id" =');
    expect(conflictWhere).toContain('"push_subscriptions"."revoked_at" is not null');
    expect(table).toEqual([{ id: 12, restaurantId: 77, endpoint, revokedAt: null }]);
  });

  it('keeps several devices of the same account subscribed side by side', async () => {
    // push_subscriptions is unique per endpoint, so "one alert per location" is
    // one row per phone/iPad: a second device must not evict the first.
    mocks.insertReturningRows.push({ id: 12 });

    const tablet = await POST(postRequest('https://push.example/ipad-caja'));
    const phone = await POST(postRequest('https://push.example/telefono-gerente'));

    expect(tablet.status).toBe(200);
    expect(phone.status).toBe(200);
    expect(mocks.insertedValues).toHaveLength(2);
    expect(mocks.insertedValues[0]?.restaurantId).toBe(77);
    expect(mocks.insertedValues[1]?.restaurantId).toBe(77);
    expect(mocks.insertedValues[0]?.endpoint).toBe('https://push.example/ipad-caja');
    expect(mocks.insertedValues[1]?.endpoint).toBe('https://push.example/telefono-gerente');
  });

  it('allows a revoked endpoint to move to another restaurant', async () => {
    mocks.insertReturningRows.push({ id: 12 });

    const response = await POST(postRequest('https://push.example/revoked-elsewhere'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getConflictWhereSql()).toContain(
      '"push_subscriptions"."revoked_at" is not null',
    );
    expect(mocks.conflictUpdates[0]?.set).toMatchObject({
      restaurantId: 77,
      revokedAt: null,
      revokedReason: null,
    });
  });
});

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

  it('revokes only this restaurant’s matching endpoint', async () => {
    const endpoint = 'https://push.example/telefono-a';
    const otherDevice = 'https://push.example/ipad-a';
    const table: SubscriptionRecord[] = [
      { id: 12, restaurantId: 77, endpoint, revokedAt: null },
      { id: 13, restaurantId: 77, endpoint: otherDevice, revokedAt: null },
    ];
    revokeInTable(table);

    const response = await DELETE(deleteRequest({ endpoint, reason: 'user_unsubscribe' }));

    expect(response.status).toBe(200);
    // The where clause scopes the revocation to BOTH the session restaurant and
    // the endpoint, so this account's other device is never touched.
    const query = new PgDialect().sqlToQuery(mocks.whereConditions[0] as SQL);
    expect(query.sql).toContain('"push_subscriptions"."restaurant_id" =');
    expect(query.sql).toContain('"push_subscriptions"."endpoint" =');
    expect(query.sql).toContain('"push_subscriptions"."revoked_at" is null');
    expect(query.params).toEqual([77, endpoint]);
    expect(table.map((row) => [row.id, row.revokedAt !== null])).toEqual([
      [12, true],
      [13, false],
    ]);
  });

  it('does not revoke an endpoint owned by another restaurant', async () => {
    const endpoint = 'https://push.example/telefono-b';
    const table: SubscriptionRecord[] = [
      { id: 14, restaurantId: 88, endpoint, revokedAt: null },
    ];
    revokeInTable(table);

    const response = await DELETE(
      deleteRequest({ endpoint, reason: 'permission_revoked' }),
    );

    expect(response.status).toBe(200);
    const query = new PgDialect().sqlToQuery(mocks.whereConditions[0] as SQL);
    expect(query.params).toEqual([77, endpoint]);
    expect(table[0].revokedAt).toBeNull();
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

  it('scopes the ownership lookup to the session restaurant', async () => {
    const endpoint = 'https://push.example/telefono-compartido';
    const table: SubscriptionRecord[] = [
      { id: 12, restaurantId: 77, endpoint, revokedAt: null },
    ];
    selectFromTable(table);
    selectFromTable(table);

    // The owner reads its own row as active…
    const owned = await GET(getRequest(endpoint));
    expect(owned.status).toBe(200);
    await expect(owned.json()).resolves.toEqual({ active: true });

    // …while restaurant B on the same endpoint sees it as inactive, so it can
    // never claim another location's device.
    mocks.verifySession.mockResolvedValueOnce({ slug: 'otra-cocina', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValueOnce({ id: 88, slug: 'otra-cocina' });
    const other = await GET(getRequest(endpoint));
    expect(other.status).toBe(200);
    await expect(other.json()).resolves.toEqual({ active: false });

    const ownerQuery = new PgDialect().sqlToQuery(mocks.selectWhereConditions[0] as SQL);
    const otherQuery = new PgDialect().sqlToQuery(mocks.selectWhereConditions[1] as SQL);
    expect(ownerQuery.params).toEqual([77, endpoint]);
    expect(otherQuery.params).toEqual([88, endpoint]);
  });

  it('rejects unauthenticated access without querying subscriptions', async () => {
    mocks.verifySession.mockResolvedValueOnce(null);

    const response = await GET(getRequest('https://push.example/active'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'No autorizado' });
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });
});
