import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectCalls: 0,
  // FIFO queue: each db.select() call shifts one result set.
  // runOutreachBatch selects in this order:
  //   1. first 'sent' event date, 2. today's sent count,
  //   3. touch1 prospects, 4. touch2 prospects, 5. touch3 prospects.
  selectResults: [] as unknown[][],
  // FIFO queue of claim results: each db.update().set().where().returning()
  // shifts one. Default when empty: the claim succeeds.
  claimResults: [] as Array<Array<{ id: number }>>,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  sendEmail: vi.fn(async () => ({ provider: 'smtp' as const })),
}));

vi.mock('@/db', () => {
  type Chain = {
    where: () => Chain;
    orderBy: () => Chain;
    limit: () => Chain;
    then: Promise<unknown[]>['then'];
  };
  const makeChain = (rows: unknown[]): Chain => {
    const chain: Chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  };
  return {
    db: {
      select: () => {
        mocks.selectCalls++;
        const rows = mocks.selectResults.shift() ?? [];
        return { from: () => makeChain(rows) };
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          mocks.inserted.push(v);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          mocks.updated.push(v);
          return {
            where: () => ({
              returning: async () =>
                mocks.claimResults.length > 0 ? mocks.claimResults.shift()! : [{ id: 1 }],
            }),
          };
        },
      }),
    },
  };
});

vi.mock('@/lib/email', () => ({
  sendEmail: mocks.sendEmail,
  escapeHtml: (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

let runOutreachBatch: typeof import('@/lib/outreach-engine').runOutreachBatch;

// Monday 2026-08-03 17:00 UTC = 11:00 in Mexico City, inside the send window.
const IN_WINDOW = new Date('2026-08-03T17:00:00.000Z');

function makeProspect(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Prospect ${id}`,
    email: `p${id}@example.com`,
    kind: 'leon' as const,
    placeId: 'ChIJ123',
    phone: null,
    city: 'León',
    rating: '4.2',
    sourceUrl: null,
    confidence: null,
    status: 'queued' as const,
    touchesSent: 0,
    lastTouchAt: null,
    nextTouchAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  process.env.SESSION_SECRET = 'test-session-secret-for-outreach-run';
  const mod = await import('@/lib/outreach-engine');
  runOutreachBatch = mod.runOutreachBatch;
});

beforeEach(() => {
  mocks.selectCalls = 0;
  mocks.selectResults = [];
  mocks.claimResults = [];
  mocks.inserted = [];
  mocks.updated = [];
  mocks.sendEmail.mockClear();
  mocks.sendEmail.mockImplementation(async () => ({ provider: 'smtp' as const }));
  vi.useFakeTimers();
  vi.setSystemTime(IN_WINDOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runOutreachBatch safety switch', () => {
  it('does nothing when OUTREACH_EMAIL_ENABLED is not true', async () => {
    delete process.env.OUTREACH_EMAIL_ENABLED;

    const result = await runOutreachBatch({ send: true });

    expect(result.enabled).toBe(false);
    expect(result.skipped).toBe('disabled');
    expect(result.planned).toEqual([]);
    expect(result.sent).toBe(0);
    expect(mocks.selectCalls).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.inserted).toEqual([]);
    expect(mocks.updated).toEqual([]);
  });

  it('does nothing when the flag is set to a non-true value', async () => {
    vi.stubEnv('OUTREACH_EMAIL_ENABLED', '1');

    const result = await runOutreachBatch({ send: true });

    expect(result.enabled).toBe(false);
    expect(result.skipped).toBe('disabled');
    expect(mocks.selectCalls).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('skips outside the send window unless ignoreWindow is set', async () => {
    vi.stubEnv('OUTREACH_EMAIL_ENABLED', 'true');
    // Monday 15:00 UTC = 09:00 Mexico City, before the window.
    vi.setSystemTime(new Date('2026-08-03T15:00:00.000Z'));

    const result = await runOutreachBatch({ send: true });

    expect(result.enabled).toBe(true);
    expect(result.inWindow).toBe(false);
    expect(result.skipped).toBe('outside_window');
    expect(mocks.selectCalls).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe('runOutreachBatch planning', () => {
  beforeEach(() => {
    vi.stubEnv('OUTREACH_EMAIL_ENABLED', 'true');
  });

  function queueSelects(opts: {
    firstSent?: Date | null;
    todayCount?: number;
    touch1?: unknown[];
    touch2?: unknown[];
    touch3?: unknown[];
  }) {
    mocks.selectResults = [
      opts.firstSent ? [{ createdAt: opts.firstSent }] : [],
      [{ count: opts.todayCount ?? 0 }],
      opts.touch1 ?? [],
      opts.touch2 ?? [],
      opts.touch3 ?? [],
    ];
  }

  it('dry run plans follow-ups before touch 1 and sends nothing', async () => {
    queueSelects({
      touch1: [makeProspect(1)],
      touch2: [makeProspect(2, { status: 'in_sequence', touchesSent: 1 })],
      touch3: [makeProspect(3, { status: 'in_sequence', touchesSent: 2 })],
    });

    const result = await runOutreachBatch({ send: false });

    expect(result.enabled).toBe(true);
    expect(result.inWindow).toBe(true);
    expect(result.cap).toBe(8);
    expect(result.alreadySentToday).toBe(0);
    expect(result.planned.map((p) => p.touchNumber)).toEqual([3, 2, 1]);
    expect(result.planned.map((p) => p.prospectId)).toEqual([3, 2, 1]);
    for (const item of result.planned) {
      expect(item.subject.length).toBeGreaterThan(0);
      expect(item.subject).not.toContain('—');
      expect(item.email).toContain('@example.com');
    }
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.inserted).toEqual([]);
    expect(mocks.updated).toEqual([]);
  });

  it('truncates the plan to the remaining daily cap', async () => {
    // First sent event today => day 1 => cap 8. 7 already sent => 1 remaining.
    queueSelects({
      firstSent: IN_WINDOW,
      todayCount: 7,
      touch1: [makeProspect(1)],
      touch2: [makeProspect(2, { status: 'in_sequence', touchesSent: 1 })],
      touch3: [
        makeProspect(3, { status: 'in_sequence', touchesSent: 2 }),
        makeProspect(4, { status: 'in_sequence', touchesSent: 2 }),
      ],
    });

    const result = await runOutreachBatch({ send: false });

    expect(result.cap).toBe(1);
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].touchNumber).toBe(3);
    expect(result.planned[0].prospectId).toBe(3);
  });

  it('skips when the daily cap is already reached', async () => {
    queueSelects({ firstSent: IN_WINDOW, todayCount: 8 });

    const result = await runOutreachBatch({ send: true });

    expect(result.skipped).toBe('cap_reached');
    expect(result.cap).toBe(0);
    expect(result.planned).toEqual([]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.inserted).toEqual([]);
  });
});

describe('runOutreachBatch sending', () => {
  beforeEach(() => {
    vi.stubEnv('OUTREACH_EMAIL_ENABLED', 'true');
  });

  it('sends, records sent events, and advances prospects', async () => {
    mocks.selectResults = [
      [],
      [{ count: 0 }],
      [makeProspect(1)],
      [makeProspect(2, { status: 'in_sequence', touchesSent: 1 })],
      [],
    ];

    const result = await runOutreachBatch({ send: true });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skippedClaimed).toBe(0);
    expect(result.planned.map((p) => p.touchNumber)).toEqual([2, 1]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

    const sentEvents = mocks.inserted.filter((v) => v.type === 'sent');
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents.map((v) => v.touchNumber)).toEqual([2, 1]);
    expect(typeof sentEvents[0].meta).toBe('object');

    // Each prospect was claimed with an atomic UPDATE before sending.
    expect(mocks.updated).toHaveLength(2);
    // Touch 2 prospect stays in_sequence with touchesSent=2.
    expect(mocks.updated[0]).toMatchObject({ status: 'in_sequence', touchesSent: 2 });
    // Touch 1 prospect moves to in_sequence with touchesSent=1.
    expect(mocks.updated[1]).toMatchObject({ status: 'in_sequence', touchesSent: 1 });
  });

  it('records a failed event and continues when one send throws', async () => {
    mocks.selectResults = [
      [],
      [{ count: 0 }],
      [makeProspect(1), makeProspect(2)],
      [],
      [],
    ];
    mocks.sendEmail
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockImplementation(async () => ({ provider: 'smtp' as const }));

    const result = await runOutreachBatch({ send: true });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

    const failedEvents = mocks.inserted.filter((v) => v.type === 'failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].prospectId).toBe(1);
    expect((failedEvents[0].meta as { error: string }).error).toContain('SMTP down');

    const sentEvents = mocks.inserted.filter((v) => v.type === 'sent');
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].prospectId).toBe(2);
  });

  it('skips a prospect whose claim fails: no send, no event', async () => {
    mocks.selectResults = [
      [],
      [{ count: 0 }],
      [makeProspect(1)],
      [],
      [],
    ];
    // The atomic UPDATE returns 0 rows: another batch already claimed it.
    mocks.claimResults = [[]];

    const result = await runOutreachBatch({ send: true });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skippedClaimed).toBe(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.inserted).toEqual([]);
    // The claim UPDATE still ran (it just matched 0 rows).
    expect(mocks.updated).toHaveLength(1);
    expect(mocks.updated[0]).toMatchObject({ status: 'in_sequence', touchesSent: 1 });
  });

  it('claims before sending and sends only after a successful claim', async () => {
    mocks.selectResults = [
      [],
      [{ count: 0 }],
      [makeProspect(1)],
      [],
      [],
    ];
    mocks.claimResults = [[{ id: 1 }]];
    mocks.sendEmail.mockImplementation(async () => {
      // The claim UPDATE must already have run before any send.
      expect(mocks.updated).toHaveLength(1);
      expect(mocks.updated[0]).toMatchObject({ touchesSent: 1 });
      return { provider: 'smtp' as const };
    });

    const result = await runOutreachBatch({ send: true });

    expect(result.sent).toBe(1);
    const sentEvents = mocks.inserted.filter((v) => v.type === 'sent');
    expect(sentEvents).toHaveLength(1);
  });

  it('on send failure records a failed event and leaves the claim in place', async () => {
    mocks.selectResults = [
      [],
      [{ count: 0 }],
      [makeProspect(1)],
      [],
      [],
    ];
    mocks.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await runOutreachBatch({ send: true });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    const failedEvents = mocks.inserted.filter((v) => v.type === 'failed');
    expect(failedEvents).toHaveLength(1);
    expect(mocks.inserted.filter((v) => v.type === 'sent')).toHaveLength(0);

    // The claim stays: exactly one UPDATE, setting touchesSent to 1, and
    // no follow-up update reverts it.
    expect(mocks.updated).toHaveLength(1);
    expect(mocks.updated[0]).toMatchObject({ status: 'in_sequence', touchesSent: 1 });
  });
});
