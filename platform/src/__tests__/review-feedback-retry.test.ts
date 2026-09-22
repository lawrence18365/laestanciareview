/**
 * POST /api/reviews/feedback — what a retry does to an already-stored submission.
 *
 * The guest-facing form is reached over a flaky phone connection and can be
 * submitted twice for reasons the server never sees: a double tap, a retry after
 * a response that was dropped on the way back, a second tab, a re-open from the
 * link in the resume banner. Before this route knew the difference, the second
 * submission hit `feedback IS NULL`, matched no row, and returned the 404 that
 * means "review not found or already submitted" — so a guest whose first POST
 * actually succeeded was told their submission failed, and the retry UI invited
 * them to send it again.
 *
 * What is pinned here:
 *   - the double-submit guard lives in the UPDATE statement (`id` AND token hash
 *     AND `feedback IS NULL`), not in a read-then-write in the route, so there is
 *     no window for two concurrent submissions to both pass it;
 *   - a retry with the correct token is a SUCCESS with the same shape as the
 *     first submission, and it neither overwrites the stored feedback nor
 *     replays the post-write effects (alert dispatch, commercial event, SLA
 *     sweep) — those belong to the write that actually happened;
 *   - a wrong or missing token stays a non-success and cannot write;
 *   - the diagnostic below records, without repairing, what happens when the
 *     post-write alert dispatch throws.
 *
 * NOT CLAIMED HERE. Nothing in these tests proves why a particular production
 * screenshot shows a guest being told "ya recibimos su opinión" or an error:
 * idempotent retries are consistent with that symptom, they do not establish it.
 * The identity of the reporter, the rating on screen and the deploy are all
 * outside what a unit test of this route can see.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const REVIEW_ID = 42;
const RESTAURANT_ID = 17;
const UNKNOWN_REVIEW_ID = 99;
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 chars, like randomToken()
const OTHER_TOKEN = 'fedcba98'.repeat(8);
const FEEDBACK_FIRST = 'La sopa llegó fría y nadie pasó a preguntar.';
const FEEDBACK_RETRY = 'La sopa llegó fría y nadie pasó a preguntar. (reenviado)';
/** The route's one public failure body: deliberately undifferentiated. */
const NOT_FOUND_BODY = { error: 'Review not found or feedback already submitted' };

/** A review row, as much of it as the feedback route reads or hands on. */
interface FeedbackRow {
  id: number;
  feedbackTokenHash: string;
  feedback: string | null;
  customerName: string | null;
  customerEmail: string | null;
  restaurantId: number;
  rating: number;
  staffCode: string | null;
}

/** The row the route passes to dispatchFeedbackAlerts — always the stored one. */
interface DispatchedReview {
  id: number;
  restaurantId: number;
  rating: number;
  feedback: string | null;
  customerName: string | null;
  customerEmail: string | null;
  staffCode: string | null;
}

const mocks = vi.hoisted(() => {
  const state = {
    /** The single review row this fake database holds. */
    row: null as FeedbackRow | null,
    /** The restaurant row, or null for a location that cannot be read. */
    restaurant: null as Record<string, unknown> | null,
    /** Every UPDATE the route sent, matched or not. */
    updateStatements: [] as Array<{ set: Record<string, unknown>; sql: string; params: unknown[] }>,
    /** How many of those statements actually moved the row. */
    appliedWrites: 0,
    /** Select projections the route used, sorted and joined, for assertions. */
    selectProjections: [] as string[],
    /**
     * Serialises UPDATEs the way a row lock does: models READ COMMITTED, where a
     * concurrent second UPDATE waits for the first to commit and only then
     * re-evaluates its WHERE against the new row version.
     */
    lock: Promise.resolve() as Promise<void>,
  };

  function serialize(condition: unknown): { sql: string; params: unknown[] } {
    const query = new PgDialect().sqlToQuery(condition as SQL);
    return { sql: query.sql, params: [...query.params] };
  }

  async function withRowLock<T>(work: () => T): Promise<T> {
    const previous = state.lock;
    let release!: () => void;
    state.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return work();
    } finally {
      release();
    }
  }

  async function applyUpdate(values: Record<string, unknown>, condition: unknown) {
    const query = serialize(condition);
    state.updateStatements.push({ set: values, sql: query.sql, params: query.params });

    return withRowLock(() => {
      const row = state.row;
      if (!row) return [];

      const reviewId = query.params.find((param): param is number => typeof param === 'number');
      const tokenHash = query.params.find((param): param is string => typeof param === 'string');
      if (reviewId === undefined || tokenHash === undefined) {
        throw new Error(`unrecognised UPDATE condition: ${query.sql}`);
      }

      if (row.id !== reviewId) return [];
      if (row.feedbackTokenHash !== tokenHash) return [];
      // The clause that makes the retry safe. If it is ever dropped from the
      // statement, the retry stops being a no-op and every test below fails.
      if (/is null/i.test(query.sql) && row.feedback !== null) return [];

      row.feedback = String(values.feedback);
      row.customerName = (values.customerName as string | null) ?? null;
      row.customerEmail = (values.customerEmail as string | null) ?? null;
      state.appliedWrites += 1;
      return [{ ...row }];
    });
  }

  async function rowsFor(projection: string, condition: unknown): Promise<unknown[]> {
    // The retry lookup: the same id + token hash pair the UPDATE used, never the
    // id alone.
    if (projection === 'feedback,id') {
      const row = state.row;
      if (!row) return [];
      const query = serialize(condition);
      const reviewId = query.params.find((param): param is number => typeof param === 'number');
      const tokenHash = query.params.find((param): param is string => typeof param === 'string');
      if (row.id !== reviewId || row.feedbackTokenHash !== tokenHash) return [];
      return [{ id: row.id, feedback: row.feedback }];
    }

    // The restaurant lookup that precedes the alert dispatch.
    if (projection.includes('alertPreference')) {
      return state.restaurant ? [state.restaurant] : [];
    }

    throw new Error(`unexpected select projection: ${projection}`);
  }

  return {
    state,
    dbUpdate: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn((condition: unknown) => ({
          returning: vi.fn(() => applyUpdate(values, condition)),
        })),
      })),
    })),
    dbSelect: vi.fn((projection: Record<string, unknown>) => {
      const keys = Object.keys(projection).sort().join(',');
      state.selectProjections.push(keys);
      return {
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => ({
            limit: vi.fn(() => rowsFor(keys, condition)),
          })),
        })),
      };
    }),
    dispatchFeedbackAlerts: vi.fn<
      (review: DispatchedReview, restaurant: Record<string, unknown>) => Promise<unknown>
    >(async () => undefined),
    trackCommercialEvent: vi.fn<(input: Record<string, unknown>) => Promise<void>>(
      async () => undefined,
    ),
    scheduleComplaintSlaSweep: vi.fn(),
    checkRateLimitAsync: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60_000,
    })),
    tokenHash: vi.fn<(token: string) => Promise<string>>(async (token) => hashToken(token)),
  };
});

vi.mock('@/db', () => ({ db: { update: mocks.dbUpdate, select: mocks.dbSelect } }));
vi.mock('@/lib/feedback-alerts', () => ({
  dispatchFeedbackAlerts: mocks.dispatchFeedbackAlerts,
}));
vi.mock('@/lib/complaint-sla', () => ({
  scheduleComplaintSlaSweep: mocks.scheduleComplaintSlaSweep,
}));
vi.mock('@/lib/commercial-tracking', () => ({
  trackCommercialEvent: mocks.trackCommercialEvent,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIP: vi.fn(() => '203.0.113.10'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/tokens', () => ({ tokenHash: mocks.tokenHash }));

import { POST } from '@/app/api/reviews/feedback/route';

const ROUTE_SOURCE = readFileSync(
  path.resolve(__dirname, '../app/api/reviews/feedback/route.ts'),
  'utf8',
);

/**
 * The real tokenHash() is sha256-based; the fake mirrors that shape so no
 * assertion below can accidentally pass by finding the raw token inside a
 * prefixed string.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function storedRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: REVIEW_ID,
    feedbackTokenHash: hashToken(TOKEN),
    feedback: null,
    customerName: null,
    customerEmail: null,
    restaurantId: RESTAURANT_ID,
    rating: 2,
    staffCode: 'ANA-01',
    ...overrides,
  };
}

function readableRestaurant(): Record<string, unknown> {
  return {
    name: 'La Estancia',
    managerEmail: 'gerencia@laestancia.mx',
    managerPhone: null,
    alertPreference: 'all',
    smsAlerts: false,
    whatsappAlerts: false,
    googleThreshold: 4,
    region: 'mx',
  };
}

function feedbackRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.ratetapmx.com/api/reviews/feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reviewId: REVIEW_ID,
    feedbackToken: TOKEN,
    feedback: FEEDBACK_FIRST,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.state.row = storedRow();
  mocks.state.restaurant = readableRestaurant();
  mocks.state.updateStatements.length = 0;
  mocks.state.selectProjections.length = 0;
  mocks.state.appliedWrites = 0;
  mocks.state.lock = Promise.resolve();
  mocks.dbUpdate.mockClear();
  mocks.dbSelect.mockClear();
  mocks.dispatchFeedbackAlerts.mockClear();
  mocks.trackCommercialEvent.mockClear();
  mocks.scheduleComplaintSlaSweep.mockClear();
  mocks.checkRateLimitAsync.mockClear();
  mocks.tokenHash.mockClear();
});

describe('POST /api/reviews/feedback, first submission', () => {
  it('stores the feedback once and dispatches to the GM exactly once', async () => {
    const response = await POST(feedbackRequest(validBody({ customerName: 'Marta' })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, reviewId: REVIEW_ID });

    expect(mocks.state.appliedWrites).toBe(1);
    expect(mocks.state.row).toMatchObject({
      feedback: FEEDBACK_FIRST,
      customerName: 'Marta',
    });

    // The alert describes the row that was written, with the fields the
    // statement set — not a snapshot taken from the request body.
    expect(mocks.dispatchFeedbackAlerts).toHaveBeenCalledTimes(1);
    const [dispatched, restaurant] = mocks.dispatchFeedbackAlerts.mock.calls[0];
    expect(dispatched).toMatchObject({
      id: REVIEW_ID,
      restaurantId: RESTAURANT_ID,
      rating: 2,
      feedback: FEEDBACK_FIRST,
      customerName: 'Marta',
    });
    expect(restaurant).toMatchObject({ name: 'La Estancia' });

    expect(mocks.trackCommercialEvent).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleComplaintSlaSweep).toHaveBeenCalledTimes(1);
  });

  it('writes without reading the row first, so there is no window between check and write', async () => {
    await POST(feedbackRequest(validBody()));

    // One statement, and the only select on this path is the restaurant that
    // feeds the alert. A read-then-write guard would show up here as a
    // `feedback,id` lookup before the UPDATE.
    expect(mocks.state.updateStatements).toHaveLength(1);
    expect(mocks.state.selectProjections).not.toContain('feedback,id');
  });
});

describe('the double-submit guard is the UPDATE statement', () => {
  it('scopes the write to the review id, the token hash and feedback IS NULL', async () => {
    await POST(feedbackRequest(validBody()));

    const [statement] = mocks.state.updateStatements;
    expect(statement.sql).toMatch(/feedback_token_hash/i);
    expect(statement.sql).toMatch(/is null/i);
    // Both bindings, in the statement. The token hash is what stops a guest who
    // guesses a review id from touching someone else's row.
    expect(statement.params).toEqual([REVIEW_ID, hashToken(TOKEN)]);
  });

  it('binds the hash of the submitted token, not the token itself', async () => {
    await POST(feedbackRequest(validBody()));

    expect(mocks.tokenHash).toHaveBeenCalledWith(TOKEN);
    const [statement] = mocks.state.updateStatements;
    expect(statement.params).not.toContain(TOKEN);
    expect(JSON.stringify(statement)).not.toContain(TOKEN);
  });
});

describe('a correct-token retry is a success, and only the first write counts', () => {
  it('answers the retry with the same shape as the first submission', async () => {
    const first = await POST(feedbackRequest(validBody({ customerName: 'Marta' })));
    const retry = await POST(feedbackRequest(validBody({ feedback: FEEDBACK_RETRY })));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ success: true, reviewId: REVIEW_ID });
    await expect(retry.json()).resolves.toEqual({ success: true, reviewId: REVIEW_ID });
  });

  it('never overwrites the stored feedback with the retry body', async () => {
    await POST(feedbackRequest(validBody({ customerName: 'Marta' })));
    await POST(feedbackRequest(validBody({ customerName: 'Alguien más', feedback: FEEDBACK_RETRY })));

    // Both statements were sent; one row moved. The second re-evaluated its
    // WHERE after the first committed and matched nothing.
    expect(mocks.state.updateStatements).toHaveLength(2);
    expect(mocks.state.appliedWrites).toBe(1);
    expect(mocks.state.row?.feedback).toBe(FEEDBACK_FIRST);
    expect(mocks.state.row?.customerName).toBe('Marta');
  });

  it('does not replay the post-write effects of the first submission', async () => {
    await POST(feedbackRequest(validBody({ customerName: 'Marta' })));
    await POST(feedbackRequest(validBody({ feedback: FEEDBACK_RETRY })));

    // The alert dispatch, the commercial event and the SLA sweep belong to the
    // write that happened. Replaying them would tell the GM twice about one
    // complaint and double-count the funnel.
    expect(mocks.dispatchFeedbackAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.trackCommercialEvent).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleComplaintSlaSweep).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchFeedbackAlerts.mock.calls[0][0].feedback).toBe(FEEDBACK_FIRST);
  });

  it('resolves a concurrent double submit once, with one write and one set of effects', async () => {
    const [first, second] = await Promise.all([
      POST(feedbackRequest(validBody())),
      POST(feedbackRequest(validBody({ feedback: FEEDBACK_RETRY }))),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    await expect(Promise.all([first.json(), second.json()])).resolves.toEqual([
      { success: true, reviewId: REVIEW_ID },
      { success: true, reviewId: REVIEW_ID },
    ]);

    // Exactly one of the two statements moved the row, whichever won the lock.
    expect(mocks.state.updateStatements).toHaveLength(2);
    expect(mocks.state.appliedWrites).toBe(1);
    expect(mocks.state.row?.feedback).toBe(mocks.dispatchFeedbackAlerts.mock.calls[0][0].feedback);
    expect(mocks.dispatchFeedbackAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.trackCommercialEvent).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleComplaintSlaSweep).toHaveBeenCalledTimes(1);
  });
});

describe('a wrong or missing token is a non-success', () => {
  it('rejects a wrong token for a review that was already submitted, and writes nothing', async () => {
    mocks.state.row = storedRow({ feedback: FEEDBACK_FIRST, customerName: 'Marta' });

    const response = await POST(feedbackRequest(validBody({ feedbackToken: OTHER_TOKEN })));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
    expect(mocks.state.appliedWrites).toBe(0);
    expect(mocks.state.row?.feedback).toBe(FEEDBACK_FIRST);
    expect(mocks.dispatchFeedbackAlerts).not.toHaveBeenCalled();
    expect(mocks.trackCommercialEvent).not.toHaveBeenCalled();
    expect(mocks.scheduleComplaintSlaSweep).not.toHaveBeenCalled();
  });

  it('rejects a wrong token for a review that has no feedback yet', async () => {
    const response = await POST(
      feedbackRequest(validBody({ feedbackToken: OTHER_TOKEN, feedback: FEEDBACK_FIRST })),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
    // A token that does not belong to the row cannot open it.
    expect(mocks.state.row?.feedback).toBeNull();
    expect(mocks.state.appliedWrites).toBe(0);
    expect(mocks.dispatchFeedbackAlerts).not.toHaveBeenCalled();
  });

  it('rejects an unknown review id carrying a valid-looking token', async () => {
    const response = await POST(feedbackRequest(validBody({ reviewId: UNKNOWN_REVIEW_ID })));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
    expect(mocks.state.appliedWrites).toBe(0);
    expect(mocks.trackCommercialEvent).not.toHaveBeenCalled();
  });

  it('rejects a review id that does not exist at all', async () => {
    mocks.state.row = null;

    const response = await POST(feedbackRequest(validBody()));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
    expect(mocks.state.appliedWrites).toBe(0);
    expect(mocks.dispatchFeedbackAlerts).not.toHaveBeenCalled();
  });

  it('uses one undifferentiated failure for both, so the public form cannot probe ids', async () => {
    mocks.state.row = storedRow({ feedback: FEEDBACK_FIRST });
    const wrongToken = await POST(feedbackRequest(validBody({ feedbackToken: OTHER_TOKEN })));

    mocks.state.row = storedRow();
    const knownIdWrongToken = await POST(
      feedbackRequest(validBody({ feedbackToken: OTHER_TOKEN })),
    );

    expect(wrongToken.status).toBe(knownIdWrongToken.status);
    await expect(wrongToken.json()).resolves.toEqual(await knownIdWrongToken.json());
  });
});

describe('post-write seam: an alert dispatch that throws (recorded, not changed)', () => {
  it('has already committed the feedback when the dispatch rejects, and the rejection escapes POST', async () => {
    mocks.dispatchFeedbackAlerts.mockRejectedValueOnce(
      new Error('alert write-back failed: connection terminated'),
    );

    // Diagnostic, and the reason this test asserts a rejection instead of a
    // response: the guest's submission is committed BEFORE the dispatch, but the
    // dispatch is awaited unguarded, so the handler never returns and never
    // produces a status of its own. In production Next answers 500 with a
    // non-JSON body — a failure the guest sees for a write that succeeded.
    await expect(POST(feedbackRequest(validBody({ customerName: 'Marta' })))).rejects.toThrow(
      'alert write-back failed',
    );

    // Persistence survives the alert failure: no rollback, no partial row.
    expect(mocks.state.appliedWrites).toBe(1);
    expect(mocks.state.row?.feedback).toBe(FEEDBACK_FIRST);
    expect(mocks.state.row?.customerName).toBe('Marta');

    // Everything scheduled after the dispatch is skipped, because it comes after
    // the throw in the same handler body.
    expect(mocks.trackCommercialEvent).not.toHaveBeenCalled();
    expect(mocks.scheduleComplaintSlaSweep).not.toHaveBeenCalled();
  });

  it('answers the guest\'s retry with success, without re-dispatching the alert that failed', async () => {
    mocks.dispatchFeedbackAlerts.mockRejectedValueOnce(new Error('alert write-back failed'));
    await expect(POST(feedbackRequest(validBody()))).rejects.toThrow('alert write-back failed');

    const retry = await POST(feedbackRequest(validBody({ feedback: FEEDBACK_RETRY })));

    // Recorded behaviour, and it deserves to be looked at: the retry finds the
    // stored feedback and reports success, so the guest is told they are done,
    // while the alert for that row was never delivered and is not retried by
    // this path. The GM can be missing a complaint the guest believes was sent.
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({ success: true, reviewId: REVIEW_ID });
    expect(mocks.state.row?.feedback).toBe(FEEDBACK_FIRST);
    expect(mocks.dispatchFeedbackAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.trackCommercialEvent).not.toHaveBeenCalled();
    expect(mocks.scheduleComplaintSlaSweep).not.toHaveBeenCalled();
  });

  it('completes the submission without any dispatch when the restaurant row cannot be read', async () => {
    mocks.state.restaurant = null;

    const response = await POST(feedbackRequest(validBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, reviewId: REVIEW_ID });
    expect(mocks.state.appliedWrites).toBe(1);
    expect(mocks.dispatchFeedbackAlerts).not.toHaveBeenCalled();
    // The effects after the dispatch still run: this branch skips the alert, not
    // the bookkeeping.
    expect(mocks.trackCommercialEvent).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleComplaintSlaSweep).toHaveBeenCalledTimes(1);
  });

  it('keeps the alert policy as it is: unconditional once a restaurant row exists, and unguarded', () => {
    const normalized = ROUTE_SOURCE.replace(/\s+/g, ' ');

    // This asserts the seam above is exactly where it is: the dispatch is called
    // for every stored submission and is NOT wrapped, which is what lets its
    // rejection escape POST. Changing the alert policy is out of scope here, so
    // this test pins the current shape rather than a preferred one.
    expect(normalized).toContain(
      'if (restaurant) { await dispatchFeedbackAlerts(updated, restaurant); }',
    );
    // The only try/catch after the write is around the commercial event, so a
    // thrown alert is not absorbed anywhere.
    expect(normalized).toContain('try { await trackCommercialEvent(');
  });

  it('keeps the retry lookup scoped to the token hash, and success gated on stored feedback', () => {
    const normalized = ROUTE_SOURCE.replace(/\s+/g, ' ');

    // The lookup that tells "already submitted" apart from "unknown" uses the
    // same id AND token hash pair as the write. Scoping it by id alone would let
    // any token holder be told a review is theirs.
    expect(normalized).toContain('and( eq(reviews.id, reviewId), eq(reviews.feedbackTokenHash, feedbackTokenHash), )');
    // …and success requires feedback to actually be on the row.
    expect(normalized).toContain(
      'if (existing?.feedback) { return Response.json({ success: true, reviewId: existing.id }); }',
    );
  });
});
