import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updatedValues: [] as Record<string, unknown>[],
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
    escalatedAt: null,
    restaurantName: 'Centro',
    region: 'centro',
    restaurantIsOwner: false,
    restaurantIsRegional: false,
    ...overrides,
  };
}

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

  it('excludes resolved, 3-star, young, escalated, and account rows', async () => {
    mocks.selectRows.push([
      complaint({ id: 1 }),
      complaint({ id: 2, status: 'resolved' }),
      complaint({ id: 3, rating: 3 }),
      complaint({ id: 4, createdAt: new Date('2026-09-04T00:00:01.000Z') }),
      complaint({ id: 5, escalatedAt: new Date('2026-09-04T10:00:00.000Z') }),
      complaint({ id: 6, restaurantIsOwner: true }),
      complaint({ id: 7, restaurantIsRegional: true }),
    ]);

    const result = await getOverdueComplaints(now);

    expect(result.map((row) => row.id)).toEqual([1]);
  });

  it('targets the location, all owners, and only the matching regional account once', async () => {
    mocks.selectRows.push(
      [complaint()],
      [
        { id: 90, isOwner: true, isRegional: false, region: null, managerEmail: 'owner@example.com' },
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
        title: 'Queja de 2 estrellas sin atender desde hace 30 h',
        url: '/inbox',
        tag: 'overdue-41',
      }),
      { kind: 'complaint_overdue', subjectType: 'review', subjectId: 41 },
    );
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      91,
      expect.objectContaining({
        title: 'Centro: queja sin atender 30 h',
        url: '/intercepted',
      }),
      { kind: 'complaint_escalation', subjectType: 'review', subjectId: 41 },
    );
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        subjectPrefix: '[Escalada]',
      }),
    );
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'norte@example.com' }),
    );
    expect(mocks.updatedValues).toHaveLength(1);
    expect(mocks.updatedValues[0]).toMatchObject({ escalatedAt: now });

    mocks.selectRows.push(
      [complaint({ escalatedAt: now })],
      [{ id: 90, isOwner: true, isRegional: false, region: null, managerEmail: 'owner@example.com' }],
    );
    const secondRun = await escalateOverdueComplaints(new Date('2026-09-04T13:00:00.000Z'));

    expect(secondRun.escalated).toBe(0);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledTimes(3);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
  });

  it('leaves escalated_at null when no channel is targeted and skips missing emails', async () => {
    mocks.selectRows.push(
      [complaint()],
      [{ id: 91, isOwner: false, isRegional: true, region: 'centro', managerEmail: null }],
    );

    const result = await escalateOverdueComplaints(now);

    expect(result).toMatchObject({ escalated: 0, noChannel: 1 });
    expect(mocks.updatedValues).toHaveLength(1);
    expect(mocks.updatedValues[0]).not.toHaveProperty('escalatedAt');
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(result.details[0].channels.regional_91_email).toEqual({
      ok: false,
      skipped: 'no_email',
    });
  });

  it('returns 401 when the cron request has no authorization secret', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';

    const response = await GET(new NextRequest('http://localhost/api/cron/complaint-sla'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.sendPushToRestaurant).not.toHaveBeenCalled();
  });
});
