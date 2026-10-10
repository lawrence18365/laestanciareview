import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ values: Record<string, unknown>; condition: unknown }>,
  selectedFields: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/db', () => {
  // `where(...)` is awaited directly (ownership/readout) or continued with
  // .limit() (lookups); update's `where(...)` may also chain .returning().
  const rowsThenable = () =>
    Object.assign(Promise.resolve([...mocks.rows]), {
      limit: async () => [...mocks.rows],
    });
  return {
    db: {
      select: vi.fn((fields?: Record<string, unknown>) => {
        if (fields) mocks.selectedFields.push(fields);
        return { from: () => ({ where: rowsThenable }) };
      }),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            mocks.updates.push({ values, condition });
            return Object.assign(Promise.resolve(), {
              returning: async () => [
                { id: 3, status: 'won', createdAt: new Date(), claimedAt: new Date(), externalCreatedAt: null },
              ],
            });
          },
        }),
      })),
    },
  };
});

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'estancia-leon', role: 'gm' })),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => ({ id: 77, slug: 'estancia-leon' })),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));

import { POST as setLeadStatus } from '@/app/api/leads/[id]/status/route';
import { PUT as saveQuote } from '@/app/api/quotes/[id]/route';
import { getQuoteConversion } from '@/lib/quote-lifecycle';
import {
  QUOTE_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
} from '@/lib/quote-status';
import { quoteUpdateSchema } from '@/lib/validations';

const dialect = new PgDialect();

function post(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`https://app.ratetapmx.com${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const quoteBody = {
  clientName: 'Ana',
  guestCount: 40,
  configJson: { menu: 'x' },
};

beforeEach(() => {
  mocks.rows = [];
  mocks.updates = [];
  mocks.selectedFields = [];
});

describe('lead won -> quote status', () => {
  it('writes the canonical won status with outcome columns the readout counts', async () => {
    mocks.rows = [{ id: 3, status: 'quoted', claimedAt: new Date(), createdAt: new Date(), externalCreatedAt: null }];

    const res = await setLeadStatus(
      post('/api/leads/3/status', 'POST', { status: 'won' }),
      { params: Promise.resolve({ id: '3' }) },
    );
    expect(res.status).toBe(200);

    // Second update = the linked-quote write (first is the lead itself).
    const quoteWrite = mocks.updates[1];
    const status = quoteWrite.values.status as string;
    expect(status).toBe('won');
    expect(QUOTE_STATUSES as readonly string[]).toContain(status);
    expect(quoteWrite.values.outcomeAt).toBeInstanceOf(Date);
    expect(quoteWrite.values.outcomeAmountMxn).toBeDefined();

    // The readout's won filter is the same literal the lead flow wrote.
    mocks.rows = [{}];
    await getQuoteConversion(77, new Date('2026-10-01'), new Date('2026-11-01'));
    const wonSql = dialect.sqlToQuery(mocks.selectedFields[0].won as SQL).sql;
    expect(wonSql).toContain(`= 'won'`);
    expect(wonSql).toContain('outcome_at');
  });
});

describe('PUT /api/quotes/[id]', () => {
  const ctx = { params: Promise.resolve({ id: '9' }) };

  it('keeps the current status when the payload sets none', async () => {
    mocks.rows = [{ id: 9 }];
    const res = await saveQuote(post('/api/quotes/9', 'PUT', quoteBody), ctx);
    expect(res.status).toBe(200);
    expect(mocks.updates).toHaveLength(1);
    // undefined is skipped by drizzle's .set(), so 'sent' stays 'sent'.
    expect(mocks.updates[0].values.status).toBeUndefined();
  });

  it('changes status only when the payload sets one explicitly', async () => {
    mocks.rows = [{ id: 9 }];
    await saveQuote(post('/api/quotes/9', 'PUT', { ...quoteBody, status: 'declined' }), ctx);
    expect(mocks.updates[0].values.status).toBe('declined');
  });

  it('uses the canonical vocabulary: accepted is gone', () => {
    expect(quoteUpdateSchema.safeParse({ ...quoteBody, status: 'accepted' }).success).toBe(false);
    for (const s of ['draft', 'sent', 'declined', 'expired']) {
      expect(quoteUpdateSchema.safeParse({ ...quoteBody, status: s }).success).toBe(true);
    }
  });
});

describe('quote list labels', () => {
  it('has a label and colour for every status', () => {
    for (const s of QUOTE_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_COLORS[s].text).toBeTruthy();
    }
  });
});
