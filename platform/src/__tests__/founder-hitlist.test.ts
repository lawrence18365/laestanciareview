import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    hitListRows: [] as Array<Record<string, unknown>>,
    statsRows: [{ contacted: 3, replied: 1, demos: 1, won: 0, remaining: 42 }],
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    sendEmail: vi.fn(async () => ({ provider: 'smtp' as const })),
  };
});

vi.mock('@/db', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('@/lib/email', () => ({
  sendEmail: mocks.sendEmail,
  escapeHtml: (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

let selectDailyHitList: (limit?: number) => Promise<unknown[]>;
let sendFounderDailyHitList: (now?: Date) => Promise<Record<string, unknown>>;
let weekdayMexico: (now?: Date) => number;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  delete process.env.FOUNDER_HITLIST_EMAILS;
  delete process.env.OWNER_NOTIFICATION_EMAIL;
  delete process.env.ADMIN_EMAIL;
  const mod = await import('@/lib/outreach-notifications');
  selectDailyHitList = mod.selectDailyHitList;
  sendFounderDailyHitList = mod.sendFounderDailyHitList;
  const tz = await import('@/lib/mexico-tz');
  weekdayMexico = tz.weekdayMexico;
});

beforeEach(() => {
  mocks.select.mockClear();
  mocks.from.mockClear();
  mocks.where.mockClear();
  mocks.orderBy.mockClear();
  mocks.limit.mockClear();
  mocks.hitListRows = [];
  mocks.statsRows = [{ contacted: 3, replied: 1, demos: 1, won: 0, remaining: 42 }];
  mocks.limit.mockImplementation(async () => mocks.hitListRows);
  mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.from.mockImplementation(() => ({
    where: mocks.where,
    // The stats query awaits select().from() directly (no .where), so the
    // builder must be thenable.
    then: (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(mocks.statsRows).then(resolve, reject),
  }));
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.sendEmail.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// 2026-09-07 15:00 UTC = Monday 09:00 in Mexico City (UTC-6)
const MONDAY = new Date('2026-09-07T15:00:00.000Z');
// 2026-09-05 15:00 UTC = Saturday 09:00 in Mexico City (UTC-6)
const SATURDAY = new Date('2026-09-05T15:00:00.000Z');

describe('weekdayMexico', () => {
  it('maps instants to the Mexico City day of week', () => {
    expect(weekdayMexico(MONDAY)).toBe(1);
    expect(weekdayMexico(SATURDAY)).toBe(6);
    expect(weekdayMexico(new Date('2026-09-06T15:00:00.000Z'))).toBe(0);
  });
});

describe('sendFounderDailyHitList weekday gate', () => {
  it('skips on weekends without touching the DB or email', async () => {
    const result = await sendFounderDailyHitList(SATURDAY);
    expect(result).toEqual({ sent: false, skipped: true, reason: 'weekend' });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('proceeds on weekdays and reports empty when there is nothing to send', async () => {
    vi.stubEnv('FOUNDER_HITLIST_EMAILS', 'founder@example.com');
    const result = await sendFounderDailyHitList(MONDAY);
    expect(result).toEqual({ sent: false, skipped: true, reason: 'empty' });
    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('skips when no recipient env var is configured', async () => {
    const result = await sendFounderDailyHitList(MONDAY);
    expect(result).toEqual({ sent: false, skipped: true, reason: 'no_recipients' });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

describe('selectDailyHitList', () => {
  it('filters status/phone and applies the default limit of 25', async () => {
    mocks.hitListRows = [
      {
        placeId: 'p1',
        restaurantName: 'El Fondón',
        rating: '4.2',
        reviewCount: 57,
        phone: '4771234567',
        city: 'León',
      },
    ];

    const rows = await selectDailyHitList();

    expect(mocks.where).toHaveBeenCalledTimes(1);
    expect(mocks.limit).toHaveBeenCalledWith(25);
    expect(rows).toHaveLength(1);
  });

  it('passes a custom limit through', async () => {
    await selectDailyHitList(5);
    expect(mocks.limit).toHaveBeenCalledWith(5);
  });
});
