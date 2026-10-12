import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  // These tests cover the WhatsApp channel too; production has it off by default.
  process.env.WHATSAPP_API_ENABLED = '1';
  process.env.CRON_SECRET = 'test-secret';
  return {
    sendMail: vi.fn(),
    restaurants: [] as Array<Record<string, unknown>>,
    events: [] as string[],
    staffCount: 0,
    ratingCount: 0,
  };
});

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
}));
vi.mock('@/lib/mailer', () => ({ FROM: 'RateTap <hello@test>', sendMail: h.sendMail }));
vi.mock('@/lib/mercadopago', () => ({
  getPriceBreakdown: () => ({ base: 700, processingCharge: 27, tax: 0, total: 727 }),
}));
vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  const rowsFor = (table: unknown) => {
    if (table === schema.restaurants) return h.restaurants;
    if (table === schema.nurtureEvents) return h.events.map((event) => ({ event }));
    if (table === schema.staff) return [{ n: h.staffCount }];
    if (table === schema.reviews) return [{ n: h.ratingCount }];
    throw new Error('unexpected table');
  };
  const eventOf = (pred: unknown): string => {
    const list = Array.isArray(pred) ? pred : [pred];
    return (list.find((p) => p.col?.name === 'event') as { val: string }).val;
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => ({ where: async () => rowsFor(table) }) }),
      insert: () => ({
        values: async (v: { event: string }) => {
          if (h.events.includes(v.event)) throw new Error('unique');
          h.events.push(v.event);
        },
      }),
      delete: () => ({
        where: async (pred: unknown) => {
          const key = eventOf(pred);
          h.events = h.events.filter((e) => e !== key);
        },
      }),
    },
  };
});

import { GET } from '../app/api/cron/trial-nurture/route';

const DAY = 86_400_000;
const request = () =>
  new NextRequest('https://example.test/api/cron/trial-nurture', {
    headers: { authorization: 'Bearer test-secret' },
  });

function restaurant(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Taquería Uno',
    slug: 'taqueria-uno',
    managerEmail: 'owner@example.test',
    managerPhone: '4771234567',
    pilot: false,
    googlePlaceId: 'place-1',
    googleReviewUrl: null,
    createdAt: new Date(Date.now() - 1.5 * DAY),
    trialEndsAt: new Date(Date.now() + 20 * DAY),
    ...over,
  };
}

const fetchMock = vi.fn();
const mails = () => h.sendMail.mock.calls.map((c) => c[0] as { subject: string; html: string });
const whatsapps = () =>
  fetchMock.mock.calls.map((c) => new URLSearchParams(c[1].body as string).get('Body') as string);
const words = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

beforeEach(() => {
  h.restaurants = [];
  h.events = [];
  h.staffCount = 0;
  h.ratingCount = 0;
  h.sendMail.mockReset().mockResolvedValue({ success: true });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok');
  vi.stubEnv('TWILIO_WHATSAPP_FROM', '+14155550000');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('trial nurture day1 activation nudge', () => {
  it('sends the staff link by email and WhatsApp when the restaurant has zero active staff', async () => {
    h.restaurants = [restaurant()];
    h.staffCount = 0;
    await GET(request());
    expect(mails()).toHaveLength(1);
    expect(mails()[0].html).toContain('/staff');
    expect(mails()[0].html).not.toContain('/settings');
    expect(whatsapps()).toHaveLength(1);
    expect(whatsapps()[0]).toContain('/staff');
    expect(whatsapps()[0]).not.toContain('/settings');
    expect(h.events.sort()).toEqual(['day1:email', 'day1:whatsapp']);
  });

  it('asks for Google when staff exist but there is no place id or review url', async () => {
    h.restaurants = [restaurant({ googlePlaceId: null })];
    h.staffCount = 3;
    await GET(request());
    expect(mails()).toHaveLength(1);
    expect(mails()[0].html).toContain('/settings');
    expect(mails()[0].html).not.toContain('/staff');
  });

  it('treats a review url alone as a Google listing', async () => {
    h.restaurants = [restaurant({ googlePlaceId: null, googleReviewUrl: 'https://g.page/r/x' })];
    h.staffCount = 3;
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('sends nothing on day1 when staff and Google are both set up', async () => {
    h.restaurants = [restaurant()];
    h.staffCount = 3;
    await GET(request());
    expect(mails()).toHaveLength(0);
    expect(whatsapps()).toHaveLength(0);
    expect(h.events).toEqual([]);
  });

  it('does not send before the restaurant is one day old', async () => {
    h.restaurants = [restaurant({ createdAt: new Date(Date.now() - 0.5 * DAY) })];
    await GET(request());
    expect(mails()).toHaveLength(0);
  });
});

describe('trial nurture channel separation', () => {
  it('keeps the email claim when WhatsApp fails and only retries WhatsApp next run', async () => {
    h.restaurants = [restaurant()];
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await GET(request());
    expect(mails()).toHaveLength(1);
    expect(h.events).toEqual(['day1:email']);

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await GET(request());
    expect(mails()).toHaveLength(1); // email did not resend
    expect(fetchMock).toHaveBeenCalledTimes(2); // WhatsApp retried
    expect(h.events.sort()).toEqual(['day1:email', 'day1:whatsapp']);
  });

  it('keeps the WhatsApp claim when email fails and only retries email next run', async () => {
    h.restaurants = [restaurant()];
    h.sendMail.mockResolvedValue({ success: false, error: { message: 'smtp down' } });

    await GET(request());
    expect(h.events).toEqual(['day1:whatsapp']);

    h.sendMail.mockResolvedValue({ success: true });
    await GET(request());
    expect(h.sendMail).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // WhatsApp did not resend
    expect(h.events.sort()).toEqual(['day1:email', 'day1:whatsapp']);
  });

  it('treats a legacy plain event row as both channels already sent', async () => {
    h.restaurants = [restaurant()];
    h.events = ['day1'];
    await GET(request());
    expect(mails()).toHaveLength(0);
    expect(whatsapps()).toHaveLength(0);
  });

  it('sends only the missing channel when one channel row already exists', async () => {
    h.restaurants = [restaurant()];
    h.events = ['day1:email'];
    await GET(request());
    expect(mails()).toHaveLength(0);
    expect(whatsapps()).toHaveLength(1);
  });
});

describe('trial nurture day3 / day7 activation variant', () => {
  const at = (days: number) => restaurant({ createdAt: new Date(Date.now() - (days + 0.5) * DAY) });
  const dayMails = (subject: RegExp) => mails().filter((m) => subject.test(m.subject));

  it('sends the activation variant on day3 when there are no guest ratings', async () => {
    h.restaurants = [at(3)];
    h.staffCount = 2;
    h.ratingCount = 0;
    await GET(request());
    const [m] = dayMails(/Activa tu RateTap/);
    expect(m.html).toContain('/staff');
    expect(m.html).toContain('/qr-codes');
    expect(m.html).not.toContain('/dashboard');
  });

  it('keeps the normal day3 tip once staff and ratings exist', async () => {
    h.restaurants = [at(3)];
    h.staffCount = 2;
    h.ratingCount = 5;
    await GET(request());
    const [m] = dayMails(/Tip del día 3/);
    expect(m.html).toContain('/dashboard');
    expect(m.html).not.toContain('/qr-codes');
  });

  it('sends the activation variant on day7 when there are no active staff', async () => {
    h.restaurants = [at(7)];
    h.staffCount = 0;
    h.ratingCount = 4;
    await GET(request());
    const [m] = dayMails(/Aún no hay calificaciones/);
    expect(m.html).toContain('/staff');
    expect(m.html).toContain('/qr-codes');
  });
});

describe('trial nurture price copy', () => {
  it('builds the day12 amount from getPriceBreakdown total and drops the retired setup fee', async () => {
    for (const pilot of [true, false]) {
      h.events = [];
      h.sendMail.mockClear();
      fetchMock.mockClear();
      h.restaurants = [
        restaurant({
          pilot,
          createdAt: new Date(Date.now() - 12.5 * DAY),
          trialEndsAt: new Date(Date.now() + 2.5 * DAY),
        }),
      ];
      h.staffCount = 2;
      h.ratingCount = 5;
      await GET(request());
      const [m] = mails().filter((x) => /termina en 3 días/.test(x.subject));
      const wa = whatsapps().find((b) => /termina en 3 días/.test(b)) as string;
      for (const text of [m.html, wa]) {
        expect(text).toContain('$727');
        expect(text).not.toContain('$700');
        expect(text).not.toMatch(/1,500|setup/i);
      }
    }
  });
});

describe('trial nurture copy length', () => {
  it('keeps every email at 60 words or fewer', async () => {
    const scenarios: Array<[Record<string, unknown>, number, number]> = [
      [{}, 0, 0], // day1 + activation variants + day12
      [{ googlePlaceId: null }, 2, 5], // day1 Google only + normal copy
      [{ slug: 'estancia-leon' }, 2, 5], // case-study copy
      [{ pilot: true }, 2, 5], // pilot day12
    ];
    const collected: string[] = [];
    for (const [over, staffCount, ratingCount] of scenarios) {
      h.events = [];
      h.sendMail.mockClear();
      h.staffCount = staffCount;
      h.ratingCount = ratingCount;
      h.restaurants = [
        restaurant({
          ...over,
          createdAt: new Date(Date.now() - 12.5 * DAY),
          trialEndsAt: new Date(Date.now() + 2.5 * DAY),
        }),
      ];
      await GET(request());
      collected.push(...mails().map((m) => m.html));
    }
    expect(collected.length).toBeGreaterThanOrEqual(10);
    for (const html of collected) expect(words(html)).toBeLessThanOrEqual(60);
  });
});
