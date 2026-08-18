import { describe, it, expect, beforeAll } from 'vitest';

describe('daily digest skip-when-empty', () => {
  let digestIsEmpty: (input: {
    views: unknown[];
    sentCounts: { touchNumber: number | null; count: number }[];
    unsubscribes: number;
    pilotCount: number;
    followUps: unknown[];
  }) => boolean;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const mod = await import('@/lib/outreach-notifications');
    digestIsEmpty = mod.digestIsEmpty;
  });

  it('skips when every section is zero', () => {
    expect(
      digestIsEmpty({
        views: [],
        sentCounts: [],
        unsubscribes: 0,
        pilotCount: 0,
        followUps: [],
      }),
    ).toBe(true);
  });

  it('does not skip when there are audit views', () => {
    expect(
      digestIsEmpty({
        views: [{ id: 1 }],
        sentCounts: [],
        unsubscribes: 0,
        pilotCount: 0,
        followUps: [],
      }),
    ).toBe(false);
  });

  it('does not skip when there are sent emails', () => {
    expect(
      digestIsEmpty({
        views: [],
        sentCounts: [{ touchNumber: 1, count: 3 }],
        unsubscribes: 0,
        pilotCount: 0,
        followUps: [],
      }),
    ).toBe(false);
  });

  it('does not skip when there are unsubscribes, pilots, or follow-ups', () => {
    expect(
      digestIsEmpty({
        views: [],
        sentCounts: [],
        unsubscribes: 1,
        pilotCount: 0,
        followUps: [],
      }),
    ).toBe(false);

    expect(
      digestIsEmpty({
        views: [],
        sentCounts: [],
        unsubscribes: 0,
        pilotCount: 2,
        followUps: [],
      }),
    ).toBe(false);

    expect(
      digestIsEmpty({
        views: [],
        sentCounts: [],
        unsubscribes: 0,
        pilotCount: 0,
        followUps: [{ id: 1 }],
      }),
    ).toBe(false);
  });
});
