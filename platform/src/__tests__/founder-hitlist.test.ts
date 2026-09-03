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
        tier: null,
        locations: null,
        ownerName: null,
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

  it('orders groups before single restaurants', async () => {
    await selectDailyHitList();
    const orderArgs = mocks.orderBy.mock.calls[0] as unknown[];
    expect(orderArgs).toHaveLength(2);
    // First key must be the CASE-WHEN tier expression (string chunks only;
    // column chunks carry the table reference and are not JSON-safe).
    const first = orderArgs[0] as { queryChunks: Array<{ value?: unknown }> };
    const text = first.queryChunks
      .map((c) => (Array.isArray(c.value) ? (c.value as string[]).join('') : ''))
      .join('');
    expect(text).toContain('CASE WHEN');
    expect(text).toContain("'group'");
  });
});

describe('hit-list email rows', () => {
  it('renders the GRUPO badge and owner line for a tier=group prospect', async () => {
    vi.stubEnv('FOUNDER_HITLIST_EMAILS', 'founder@example.com');
    mocks.hitListRows = [
      {
        placeId: 'group:grupo-anderson',
        restaurantName: 'Grupo Anderson',
        rating: null,
        reviewCount: null,
        phone: '524771234567',
        city: 'CDMX',
        tier: 'group',
        locations: 8,
        ownerName: 'Carlos Anderson',
      },
    ];

    const result = await sendFounderDailyHitList(MONDAY);
    expect(result).toMatchObject({ sent: true, count: 1 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const html = (mocks.sendEmail.mock.calls[0] as unknown as [{ html: string }])[0].html;
    expect(html).toContain('GRUPO · 8 sucursales');
    expect(html).toContain('Dueño: Carlos Anderson');
    // Group rows get the sucursales opener in the (URL-encoded) WhatsApp link.
    expect(html).toContain(encodeURIComponent('opera 8 sucursales'));
    expect(html).toContain(encodeURIComponent('15 minutos'));
  });

  it('omits the locations count when null and never badges non-group rows', async () => {
    vi.stubEnv('FOUNDER_HITLIST_EMAILS', 'founder@example.com');
    mocks.hitListRows = [
      {
        placeId: 'group:no-count',
        restaurantName: 'Grupo Sin Cifra',
        rating: null,
        reviewCount: null,
        phone: '4771234567',
        city: 'León',
        tier: 'group',
        locations: null,
        ownerName: null,
      },
      {
        placeId: 'p2',
        restaurantName: 'El Fondón',
        rating: '4.2',
        reviewCount: 57,
        phone: '4771234567',
        city: 'León',
        tier: null,
        locations: null,
        ownerName: null,
      },
    ];

    await sendFounderDailyHitList(MONDAY);
    const html = (mocks.sendEmail.mock.calls[0] as unknown as [{ html: string }])[0].html;
    expect(html).toContain('>GRUPO</span>');
    expect(html).not.toContain('sucursales</span>');
    expect(html).not.toContain('Dueño:');
    expect(html.match(/GRUPO/g)).toHaveLength(1);
  });
});
