import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

describe('outreach engine cap math', () => {
  let engine: typeof import('@/lib/outreach-engine');

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    engine = await import('@/lib/outreach-engine');
  });

  it('returns 8 for days 1-7 of operation', () => {
    expect(engine.dailyCap(1)).toBe(8);
    expect(engine.dailyCap(7)).toBe(8);
  });

  it('returns 15 for days 8-14 of operation', () => {
    expect(engine.dailyCap(8)).toBe(15);
    expect(engine.dailyCap(14)).toBe(15);
  });

  it('returns 20 after day 14', () => {
    expect(engine.dailyCap(15)).toBe(20);
    expect(engine.dailyCap(100)).toBe(20);
  });

  it('computes operation day from first sent event', () => {
    const first = new Date('2026-08-01T10:00:00-06:00');
    expect(engine.dayOfOperation(first, new Date('2026-08-01T11:00:00-06:00'))).toBe(1);
    expect(engine.dayOfOperation(first, new Date('2026-08-07T11:00:00-06:00'))).toBe(7);
    expect(engine.dayOfOperation(first, new Date('2026-08-08T11:00:00-06:00'))).toBe(8);
  });
});

describe('outreach engine send window gating', () => {
  let engine: typeof import('@/lib/outreach-engine');

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    engine = await import('@/lib/outreach-engine');
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows Monday 10:00 America/Mexico_City', () => {
    vi.setSystemTime(new Date('2026-08-03T15:00:00Z'));
    expect(engine.isInSendWindow()).toBe(true);
  });

  it('allows Saturday 12:59 America/Mexico_City', () => {
    vi.setSystemTime(new Date('2026-08-08T17:59:00Z'));
    expect(engine.isInSendWindow()).toBe(true);
  });

  it('skips Sunday', () => {
    vi.setSystemTime(new Date('2026-08-09T15:00:00Z'));
    expect(engine.isInSendWindow()).toBe(false);
  });

  it('skips before 10:00 Mexico City', () => {
    vi.setSystemTime(new Date('2026-08-03T14:59:00Z'));
    expect(engine.isInSendWindow()).toBe(false);
  });

  it('skips after 12:59 Mexico City', () => {
    vi.setSystemTime(new Date('2026-08-03T18:00:00Z'));
    expect(engine.isInSendWindow()).toBe(false);
  });
});

describe('outreach engine cadence helpers', () => {
  let engine: typeof import('@/lib/outreach-engine');

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    engine = await import('@/lib/outreach-engine');
  });

  it('delays touch 1 by 4 days and touch 2 by 5 days', () => {
    expect(engine.nextTouchDelayDays(1)).toBe(4);
    expect(engine.nextTouchDelayDays(2)).toBe(5);
    expect(engine.nextTouchDelayDays(3)).toBeNull();

    const now = new Date('2026-08-01T10:00:00Z');
    const next1 = engine.computeNextTouchAt(1, now);
    const next2 = engine.computeNextTouchAt(2, now);
    expect(next1?.toISOString()).toBe('2026-08-05T10:00:00.000Z');
    expect(next2?.toISOString()).toBe('2026-08-06T10:00:00.000Z');
    expect(engine.computeNextTouchAt(3, now)).toBeNull();
  });
});
