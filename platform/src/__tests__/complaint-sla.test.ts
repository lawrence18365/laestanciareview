import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updatedValues: [] as Record<string, unknown>[],
  /** Queue of results for the `.returning()` of the claim statement. */
  claimResults: [] as unknown[][],
  sendPushToRestaurant: vi.fn(),
  sendFeedbackAlert: vi.fn(),
}));

vi.mock('@/db', () => {
  function query(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return builder;
  }

  function thenable(value: unknown) {
    return {
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(value).then(resolve, reject),
    };
  }

  return {
    db: {
      select: vi.fn(() => query(mocks.selectRows.shift() ?? [])),
      update: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.set = vi.fn((values: Record<string, unknown>) => {
          mocks.updatedValues.push(values);
          return builder;
        });
        builder.where = vi.fn(() => builder);
        // Only the claim statement asks for rows back. Default: this sweep won
        // the claim; a test can push `[]` to simulate losing it to a race.
        builder.returning = vi.fn(() =>
          thenable(mocks.claimResults.length > 0 ? mocks.claimResults.shift() : [{ id: 41 }]));
        builder.then = (
          resolve: (value: undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(undefined).then(resolve, reject);
        return builder;
      }),
    },
  };
});

vi.mock('@/lib/push', () => ({
  sendPushToRestaurant: mocks.sendPushToRestaurant,
}));

vi.mock('@/lib/email', () => ({
  sendFeedbackAlert: mocks.sendFeedbackAlert,
}));

import {
  escalateOverdueComplaints,
  getComplaintSlaStats,
  getOverdueComplaints,
} from '@/lib/complaint-sla';
import { GET } from '@/app/api/cron/complaint-sla/route';

const now = new Date('2026-09-04T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * HOUR_MS);
}

function complaint(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    restaurantId: 7,
    rating: 2,
    feedback: 'La comida llegó fría y esperamos demasiado tiempo.',
    customerName: 'María',
    customerEmail: 'maria@example.com',
    staffName: 'Ana',
    status: 'new',
    createdAt: new Date('2026-09-03T06:00:00.000Z'),
    reviewedAt: null,
    resolvedAt: null,
    escalatedAt: null,
    restaurantName: 'Centro',
    region: 'centro',
    restaurantIsOwner: false,
    restaurantIsRegional: false,
    ...overrides,
  };
}

const ownerAccount = {
  id: 90,
  isOwner: true,
  isRegional: false,
  region: null,
  managerEmail: 'owner@example.com',
};

const emailSuccess = {
  success: true,
  skipped: false,
  messageId: 'message-1',
  response: null,
  error: null,
};

describe('complaint SLA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.length = 0;
    mocks.updatedValues.length = 0;
    mocks.claimResults.length = 0;
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 0, sent: 0, failed: 0 });
    mocks.sendFeedbackAlert.mockResolvedValue(emailSuccess);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('normalizes the conditional aggregate fixture into SLA stats', async () => {
    mocks.selectRows.push(
      [{
        received: '5',
        reviewedWithin2h: '3',
        resolvedWithin24h: '2',
        avgHoursToReview: '1.75',
        avgHoursToResolve: '11.5',
      }],
      [{ count: '1' }],
    );

    await expect(getComplaintSlaStats(7, now)).resolves.toEqual({
      received: 5,
      reviewedWithin2h: 3,
      resolvedWithin24h: 2,
      overdueOpen: 1,
      avgHoursToReview: 1.75,
      avgHoursToResolve: 11.5,
    });
  });

  it('excludes resolved, praise, young, escalated, and account rows — and includes actionable 4★', async () => {
    mocks.selectRows.push([
      // 2★, 30 h, nobody acted: urgent window (2 h) is long gone.
      complaint({ id: 1 }),
      complaint({ id: 2, status: 'resolved' }),
      complaint({ id: 3, rating: 5, feedback: 'Todo excelente, gracias' }),
      // 30 min old: younger than the shortest window of all (2 h).
      complaint({ id: 4, createdAt: new Date('2026-09-04T11:30:00.000Z') }),
      complaint({ id: 5, escalatedAt: new Date('2026-09-04T10:00:00.000Z') }),
      complaint({ id: 6, restaurantIsOwner: true }),
      complaint({ id: 7, restaurantIsRegional: true }),
      // 4★ complaint, 12 h untouched: rating <= 2 is NOT the gate any more.
      complaint({
        id: 8,
        rating: 4,
        feedback: 'La sopa no tenía sabor, deberían cuidar la calidad.',
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
      }),
    ]);

    const result = await getOverdueComplaints(now);

    expect(result.map((row) => row.id)).toEqual([1, 8]);
    expect(result[0].classification.actionable).toBe(true);
    expect(result[0].classification.severity).toBe('urgent');
    expect(result[1].classification.actionable).toBe(true);
    expect(result[1].classification.severity).toBe('complaint');
  });

  it('escalates a 4★ actionable review after 9 h, not after 3 h, and a 1★ after 3 h', async () => {
    const fourStar = complaint({
      id: 50,
      rating: 4,
      feedback: 'La sopa no tenía sabor, deberían cuidar la calidad.',
    });

    // 9 h untouched: the actionable window (8 h) has elapsed.
    mocks.selectRows.push([{ ...fourStar, createdAt: hoursAgo(9) }], [ownerAccount]);
    const atNine = await escalateOverdueComplaints(now);

    expect(atNine.escalated).toBe(1);
    expect(atNine.details[0].hoursOpen).toBe(9);
    expect(mocks.sendPushToRestaurant.mock.calls.map((call) => call[0])).toEqual([7, 90]);
    // Shared classification wording, with the overdue age preserved.
    expect(mocks.sendPushToRestaurant.mock.calls[0][1]).toMatchObject({
      title: '⚠️ Centro: queja de 4 estrellas sin atender desde hace 9 h',
    });
    expect(mocks.sendPushToRestaurant.mock.calls[0][2]).toMatchObject({ kind: 'low_review' });
    expect(mocks.sendFeedbackAlert.mock.calls[0][0]).toMatchObject({
      to: 'owner@example.com',
      severity: 'complaint',
      subjectPrefix: '[Escalada]',
    });

    // 3 h untouched: not due yet, the actionable window is 8 h.
    mocks.selectRows.push([{ ...fourStar, createdAt: hoursAgo(3) }], [ownerAccount]);
    const atThree = await escalateOverdueComplaints(now);

    expect(atThree.escalated).toBe(0);
    expect(atThree.details).toEqual([]);
    expect(mocks.sendPushToRestaurant.mock.calls.length).toBe(2);
    expect(mocks.sendFeedbackAlert.mock.calls.length).toBe(1);

    // 1★ at 3 h: the urgent window (2 h) has elapsed.
    mocks.selectRows.push(
      [{ ...complaint({ id: 51, rating: 1, feedback: 'Pésimo servicio' }), createdAt: hoursAgo(3) }],
      [ownerAccount],
    );
    const urgentAtThree = await escalateOverdueComplaints(now);

    expect(urgentAtThree.escalated).toBe(1);
    expect(urgentAtThree.details[0].hoursOpen).toBe(3);
    expect(mocks.sendPushToRestaurant.mock.calls.length).toBe(4);
    expect(mocks.sendPushToRestaurant.mock.calls[2][1]).toMatchObject({
      title: '🔴 Centro: queja urgente de 1 estrella sin atender desde hace 3 h',
    });
  });

  it('does not escalate a review that was opened until the preserved 24 h rule fires', async () => {
    const openedAt9h = {
      ...complaint({ id: 60, rating: 4, feedback: 'La sopa no tenía sabor, deberían cuidar la calidad.', status: 'reviewed' }),
      createdAt: hoursAgo(9),
      reviewedAt: hoursAgo(8),
    };

    // Rule (a) does not apply: reviewedAt is set. Nothing is claimed or written.
    expect((await getOverdueComplaints(now)).map((row) => row.id)).toEqual([]);
    mocks.selectRows.push([openedAt9h], [ownerAccount]);
    const atNine = await escalateOverdueComplaints(now);

    expect(atNine.escalated).toBe(0);
    expect(atNine.noChannel).toBe(0);
    expect(atNine.details).toEqual([]);
    expect(mocks.sendPushToRestaurant).not.toHaveBeenCalled();
    expect(mocks.updatedValues).toEqual([]);

    // 25 h: the preserved SLA rule still escalates it.
    mocks.selectRows.push(
      [{ ...openedAt9h, createdAt: hoursAgo(25), reviewedAt: hoursAgo(24) }],
      [ownerAccount],
    );
    const atTwentyFive = await escalateOverdueComplaints(now);

    expect(atTwentyFive.escalated).toBe(1);
    expect(atTwentyFive.details[0].hoursOpen).toBe(25);
  });

  it('targets the location, all owners, and only the matching regional account once', async () => {
    mocks.selectRows.push(
      [complaint()],
      [
        ownerAccount,
        { id: 91, isOwner: false, isRegional: true, region: 'centro', managerEmail: null },
        { id: 92, isOwner: false, isRegional: true, region: 'norte', managerEmail: 'norte@example.com' },
      ],
    );
    mocks.sendPushToRestaurant.mockImplementation(async (restaurantId: number) => ({
      targeted: restaurantId === 92 ? 0 : 1,
      sent: restaurantId === 92 ? 0 : 1,
      failed: 0,
    }));

    const result = await escalateOverdueComplaints(now);

    expect(result.escalated).toBe(1);
    expect(result.noChannel).toBe(0);
    expect(mocks.sendPushToRestaurant.mock.calls.map((call) => call[0])).toEqual([7, 90, 91]);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        title: '🔴 Centro: queja urgente de 2 estrellas sin atender desde hace 30 h',
        url: '/inbox',
        tag: 'overdue-41',
      }),
      { kind: 'low_review', subjectType: 'review', subjectId: 41 },
    );
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      91,
      expect.objectContaining({
        title: '🔴 Centro: queja urgente de 2 estrellas sin atender desde hace 30 h',
        url: '/intercepted',
      }),
      { kind: 'low_review', subjectType: 'review', subjectId: 41 },
    );
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        severity: 'urgent',
        subjectPrefix: '[Escalada]',
      }),
    );
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'norte@example.com' }),
    );

    // The row is claimed first, then the channel record is merged in.
    expect(mocks.updatedValues).toHaveLength(2);
    expect(mocks.updatedValues[0]).toEqual({ escalatedAt: now });
    expect(mocks.updatedValues[1]).toHaveProperty('alertChannels');
    expect(mocks.updatedValues[1]).not.toHaveProperty('escalatedAt');

    // Second sweep, same review already escalated: nothing to do.
    mocks.selectRows.push(
      [complaint({ escalatedAt: now })],
      [ownerAccount],
    );
    const secondRun = await escalateOverdueComplaints(new Date('2026-09-04T13:00:00.000Z'));

    expect(secondRun.escalated).toBe(0);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledTimes(3);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when no channel is targeted but keeps the channel record', async () => {
    mocks.selectRows.push(
      [complaint()],
      [{ id: 91, isOwner: false, isRegional: true, region: 'centro', managerEmail: null }],
    );

    const result = await escalateOverdueComplaints(now);

    expect(result).toMatchObject({ escalated: 0, noChannel: 1 });
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(result.details[0].channels.regional_91_email).toEqual({
      ok: false,
      skipped: 'no_email',
    });

    // Claim, then release: escalated_at goes back to NULL so a later sweep
    // retries, and the channel record is still written.
    expect(mocks.updatedValues).toHaveLength(2);
    expect(mocks.updatedValues[0]).toEqual({ escalatedAt: now });
    expect(mocks.updatedValues[1]).toMatchObject({ escalatedAt: null });
    expect(mocks.updatedValues[1]).toHaveProperty('alertChannels');
  });

  it('produces exactly one set of sends when a second sweep loses the claim', async () => {
    const overdueRow = complaint();

    // Sweep A wins the claim and sends.
    mocks.claimResults.push([{ id: 41 }]);
    mocks.selectRows.push([overdueRow], [ownerAccount]);
    const first = await escalateOverdueComplaints(now);

    const pushesAfterFirst = mocks.sendPushToRestaurant.mock.calls.length;
    const emailsAfterFirst = mocks.sendFeedbackAlert.mock.calls.length;
    expect(first.escalated).toBe(1);
    expect(pushesAfterFirst).toBe(2); // location + owner
    expect(emailsAfterFirst).toBe(1);

    // Sweep B saw the same review (its SELECT raced ahead of A's claim), but
    // the conditional claim returns nothing, so it must not send again.
    mocks.claimResults.push([]);
    mocks.selectRows.push([overdueRow], [ownerAccount]);
    const second = await escalateOverdueComplaints(now);

    expect(second.escalated).toBe(0);
    expect(second.noChannel).toBe(0);
    expect(second.details).toEqual([]);
    expect(mocks.sendPushToRestaurant.mock.calls.length).toBe(pushesAfterFirst);
    expect(mocks.sendFeedbackAlert.mock.calls.length).toBe(emailsAfterFirst);
    // B's conditional claim ran but matched nothing, so it wrote its claim
    // attempt and nothing else: exactly one channel merge exists in total.
    const merges = mocks.updatedValues.filter((values) => 'alertChannels' in values);
    expect(merges).toHaveLength(1);
  });

  it('returns 401 when the cron request has no authorization secret', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';

    const response = await GET(new NextRequest('http://localhost/api/cron/complaint-sla'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.sendPushToRestaurant).not.toHaveBeenCalled();
  });
});
