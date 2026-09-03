import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  statusRows: [] as Array<{ status: string }>,
  updatedValues: [] as Array<Record<string, unknown>>,
  updateReturning: [] as Array<{ id: number }>,
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [...mocks.statusRows],
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        mocks.updatedValues.push(v);
        return {
          where: () => ({
            returning: async () => [...mocks.updateReturning],
          }),
        };
      },
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        mocks.inserted.push(v);
      },
    }),
  },
}));

let GET: typeof import('@/app/api/outreach/unsubscribe/route').GET;
let POST: typeof import('@/app/api/outreach/unsubscribe/route').POST;
let makeUnsubscribeToken: typeof import('@/lib/outreach-tokens').makeUnsubscribeToken;

const BASE = 'https://app.ratetapmx.com/api/outreach/unsubscribe';

async function urlFor(id: number): Promise<string> {
  const token = await makeUnsubscribeToken(id);
  return `${BASE}?id=${id}&token=${token}`;
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function postRequest(url: string, oneClick = false): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: oneClick ? 'List-Unsubscribe=One-Click' : '',
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  process.env.SESSION_SECRET = 'test-session-secret-for-unsubscribe';
  const route = await import('@/app/api/outreach/unsubscribe/route');
  GET = route.GET;
  POST = route.POST;
  const tokens = await import('@/lib/outreach-tokens');
  makeUnsubscribeToken = tokens.makeUnsubscribeToken;
});

beforeEach(() => {
  mocks.statusRows = [{ status: 'in_sequence' }];
  mocks.updatedValues = [];
  mocks.updateReturning = [{ id: 1 }];
  mocks.inserted = [];
});

describe('GET /api/outreach/unsubscribe', () => {
  it('does NOT unsubscribe: it renders a confirmation page and writes nothing', async () => {
    const res = await GET(getRequest(await urlFor(1)));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('Confirmar baja');
    expect(html).toContain('<form method="post"');
    expect(mocks.updatedValues).toEqual([]);
    expect(mocks.inserted).toEqual([]);
  });

  it('rejects an invalid token without writing anything', async () => {
    const res = await GET(getRequest(`${BASE}?id=1&token=deadbeef`));
    const html = await res.text();

    expect(html).not.toContain('Confirmar baja');
    expect(html).toContain('no es válido');
    expect(mocks.updatedValues).toEqual([]);
    expect(mocks.inserted).toEqual([]);
  });

  it('rejects a missing/invalid id', async () => {
    const res = await GET(getRequest(`${BASE}?id=abc&token=x`));
    const html = await res.text();

    expect(html).toContain('no es válido');
    expect(mocks.updatedValues).toEqual([]);
  });
});

describe('POST /api/outreach/unsubscribe', () => {
  it('unsubscribes and records exactly one event', async () => {
    const res = await POST(postRequest(await urlFor(1)));
    const html = await res.text();

    expect(html).toContain('Listo');
    expect(mocks.updatedValues).toEqual([{ status: 'opted_out' }]);
    expect(mocks.inserted).toEqual([{ prospectId: 1, type: 'unsubscribed' }]);
  });

  it('supports the one-click List-Unsubscribe=One-Click body', async () => {
    const res = await POST(postRequest(await urlFor(1), true));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('Listo');
    expect(mocks.inserted).toHaveLength(1);
  });

  it('a second POST adds no event and says the prospect was already unsubscribed', async () => {
    await POST(postRequest(await urlFor(1)));
    expect(mocks.inserted).toHaveLength(1);

    // Prospect is now opted_out.
    mocks.statusRows = [{ status: 'opted_out' }];
    const res = await POST(postRequest(await urlFor(1)));
    const html = await res.text();

    expect(html).toContain('Ya estaba dado de baja');
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.updatedValues).toHaveLength(1);
  });

  it('rejects an invalid token without writing anything', async () => {
    const res = await POST(postRequest(`${BASE}?id=1&token=deadbeef`));
    const html = await res.text();

    expect(html).toContain('no es válido');
    expect(mocks.updatedValues).toEqual([]);
    expect(mocks.inserted).toEqual([]);
  });
});
