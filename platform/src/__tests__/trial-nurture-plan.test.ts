import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// US-15 / SQ-209: Plan Restaurante nurture. Day 25 of a self-serve trial, then
// 3 and 10 days after the trial ended (free plan). Counts only, <= 60 words,
// deduped through nurture_events, email-only unless WHATSAPP_API_ENABLED=1.

const h = vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.WHATSAPP_API_ENABLED;
  return {
    sendMail: vi.fn(),
    restaurants: [] as Array<Record<string, unknown>>,
    events: [] as string[],
    productEvents: [] as Array<Record<string, unknown>>,
    staffCount: 3,
    ratingCount: 0,
    sentToGoogleCount: 0,
    commentCount: 0,
    snapshotCount: null as number | null,
  };
});

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  ne: (col: unknown, val: unknown) => ({ col, val }),
  isNotNull: (col: unknown) => ({ col }),
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
}));
vi.mock('@/lib/mailer', () => ({ FROM: 'RateTap <hello@test>', sendMail: h.sendMail }));
vi.mock('@/lib/mercadopago', () => ({
  getPriceBreakdown: () => ({ base: 700, processingCharge: 27, tax: 0, total: 727 }),
}));
vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  const hasCol = (pred: unknown, name: string): boolean =>
    (Array.isArray(pred) ? pred : [pred]).some(
      (p) => (p as { col?: { name?: string } } | null)?.col?.name === name,
    );
  const rowsFor = (table: unknown, pred: unknown): unknown[] => {
    if (table === schema.restaurants) return h.restaurants;
    if (table === schema.nurtureEvents) return h.events.map((event) => ({ event }));
    if (table === schema.staff) return [{ n: h.staffCount }];
    if (table === schema.reviews) {
      if (hasCol(pred, 'sent_to_google')) return [{ n: h.sentToGoogleCount }];
      if (hasCol(pred, 'feedback')) return [{ n: h.commentCount }];
      return [{ n: h.ratingCount }];
    }
    if (table === schema.googleRatingSnapshots) {
      return h.snapshotCount === null ? [] : [{ n: h.snapshotCount }];
    }
    throw new Error('unexpected table');
  };
  const queryOf = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      orderBy: () => ({ limit: async () => rows.slice(0, 1) }),
    });
  const eventOf = (pred: unknown): string => {
    const list = Array.isArray(pred) ? pred : [pred];
    return (list.find((p) => p.col?.name === 'event') as { val: string }).val;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (pred: unknown) => queryOf(rowsFor(table, pred)),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (v: Record<string, unknown>) => {
          if (table === schema.productEvents) {
            h.productEvents.push(v);
            return;
          }
          if (h.events.includes(v.event as string)) throw new Error('unique');
          h.events.push(v.event as string);
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

/** Signup-age events already sent, so only the Plan Restaurante messages are in play. */
const EARLIER = ['day1', 'day3', 'day7'];

function restaurant(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Taquería Uno',
    slug: 'taqueria-uno',
    managerEmail: 'owner@example.test',
    managerPhone: '4771234567',
    pilot: false,
    teamMode: null,
    googlePlaceId: 'place-1',
    googleReviewUrl: null,
    googleReviewCount: null,
    subscriptionStatus: 'trialing',
    groupKey: null,
    locationsBand: null,
    createdAt: new Date(Date.now() - 26 * DAY),
    trialEndsAt: new Date(Date.now() + 4.5 * DAY),
    ...over,
  };
}
/** A self-serve restaurant whose trial ended `daysAgo` days ago and is now on the free plan. */
const lapsed = (daysAgo: number, over: Record<string, unknown> = {}) =>
  restaurant({
    subscriptionStatus: 'canceled',
    createdAt: new Date(Date.now() - (daysAgo + 31) * DAY),
    trialEndsAt: new Date(Date.now() - (daysAgo + 0.5) * DAY),
    ...over,
  });

const fetchMock = vi.fn();
const mails = () => h.sendMail.mock.calls.map((c) => c[0] as { subject: string; html: string; to: string });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const words = (html: string) => text(html).split(' ').filter(Boolean).length;
const shown = () => h.productEvents.filter((e) => e.eventName === 'upgrade_prompt_shown');

beforeEach(() => {
  // Noon in Mexico City: inside the send hours and outside the morning bump window.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));
  h.restaurants = [];
  h.events = [...EARLIER];
  h.productEvents = [];
  h.staffCount = 3;
  h.ratingCount = 12;
  h.sentToGoogleCount = 7;
  h.commentCount = 3;
  h.snapshotCount = 48;
  h.sendMail.mockReset().mockResolvedValue({ success: true });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('day 25: trial ending', () => {
  it('emails progress numbers, the end date, the price and a /plan link, within 60 words', async () => {
    h.restaurants = [restaurant()];

    await GET(request());

    expect(mails()).toHaveLength(1);
    const mail = mails()[0];
    const body = text(mail.html);
    expect(body).toContain('Llevas 12 calificaciones; 48 reseñas en Google.');
    expect(body).toMatch(/Tu prueba termina el \d{1,2} de \p{L}+\./u);
    expect(body).toContain('Plan Restaurante desde MX$299/mes');
    expect(body).toContain('Cancela cuando quieras.');
    expect(mail.html).toContain('https://app.ratetapmx.com/plan');
    expect(mail.subject).toMatch(/^Tu prueba termina el /);
    expect(words(mail.html)).toBeLessThanOrEqual(60);
    expect(h.events).toContain('day25:email');
    expect(fetchMock).not.toHaveBeenCalled(); // email-only: WHATSAPP_API_ENABLED is off
  });

  it('records upgrade_prompt_shown email_day25 once, and is deduped on the next run', async () => {
    h.restaurants = [restaurant()];

    await GET(request());
    await GET(request());

    expect(mails()).toHaveLength(1);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({
      eventName: 'upgrade_prompt_shown',
      restaurantId: 1,
      properties: { placement: 'email_day25', plan: 'trial' },
    });
  });

  it('is not sent before day 25 or after the trial ended', async () => {
    h.restaurants = [
      restaurant({ id: 1, createdAt: new Date(Date.now() - 20 * DAY) }),
      restaurant({ id: 2, trialEndsAt: new Date(Date.now() - 1 * DAY) }),
    ];

    await GET(request());

    expect(mails().filter((m) => /^Tu prueba termina el /.test(m.subject))).toHaveLength(0);
    expect(shown()).toHaveLength(0);
  });

  it('is not sent to a Grupo trial or a founder pilot, which keep today\'s flow', async () => {
    h.restaurants = [
      restaurant({ id: 1, groupKey: 'grupo-estancia' }),
      restaurant({ id: 2, pilot: true }),
    ];

    await GET(request());

    expect(h.events).not.toContain('day25:email');
    expect(shown()).toHaveLength(0);
  });

  it('replaces the day 12 warning when it was already sent, without double-nagging', async () => {
    h.restaurants = [restaurant({ trialEndsAt: new Date(Date.now() + 2.5 * DAY) })];

    await GET(request());

    expect(mails().map((m) => m.subject)).toEqual([expect.stringMatching(/^Tu prueba termina el /)]);
    expect(h.events).toContain('day25:email');
    expect(h.events).not.toContain('day12:email');
  });

  it('quotes the global price, not MX$299, for a multi-location restaurant', async () => {
    h.restaurants = [restaurant({ locationsBand: '2-5' })];

    await GET(request());

    const body = text(mails()[0].html);
    expect(body).not.toContain('MX$299');
    expect(body).toContain('$727 MXN/mes');
  });
});

describe('free plan: post-trial days 3 and 10', () => {
  it.each([
    [3, 'email_free_d3', 'free_d3:email'],
    [10, 'email_free_d10', 'free_d10:email'],
  ])('day %i sends a counts-only teaser to /plan and tracks %s', async (daysAgo, placement, eventKey) => {
    h.restaurants = [lapsed(daysAgo)];

    await GET(request());

    expect(mails()).toHaveLength(1);
    const mail = mails()[0];
    const body = text(mail.html);
    expect(body).toContain('12 calificaciones, 7 a Google, 3 comentarios');
    expect(body).toContain('Los comentarios están bloqueados. Activa tu plan para leerlos.');
    expect(body).toContain('Plan Restaurante desde MX$299/mes');
    expect(body).toContain('Cancela cuando quieras.');
    expect(mail.html).toContain('https://app.ratetapmx.com/plan');
    expect(words(mail.html)).toBeLessThanOrEqual(60);
    expect(h.events).toContain(eventKey);
    expect(shown()).toEqual([
      expect.objectContaining({
        eventName: 'upgrade_prompt_shown',
        properties: { placement, plan: 'free' },
      }),
    ]);
  });

  it('carries no guest name, email or comment text, only numbers', async () => {
    h.restaurants = [lapsed(3)];

    await GET(request());

    // The body is written from numbers and the restaurant's own name: no address, no quote.
    const content = mails().map((m) => `${m.subject} ${m.html}`).join(' ');
    expect(content).not.toContain('@');
    expect(content).not.toContain('mailto:');
    expect(mails().map((m) => text(m.html)).join(' ')).not.toMatch(/[“”"«»]/);
  });

  it('sends each message once: a second run and a later run do not repeat it', async () => {
    h.restaurants = [lapsed(3)];
    await GET(request());
    await GET(request());
    expect(mails()).toHaveLength(1);
    expect(shown()).toHaveLength(1);

    // Seven days on the same restaurant is in the day 10 window; day 3 stays sent.
    h.restaurants = [lapsed(10)];
    await GET(request());
    expect(mails().map((m) => m.subject)).toEqual([
      expect.stringContaining('Tu QR sigue activo'),
      expect.stringContaining('Tu plan gratis'),
    ]);
  });

  it('is selected only for group_key NULL on the free plan', async () => {
    h.restaurants = [
      lapsed(3, { id: 1 }),
      lapsed(3, { id: 2, groupKey: 'grupo-estancia' }), // Grupo: blocked, never free
      lapsed(3, { id: 3, subscriptionStatus: 'active' }), // paying
      lapsed(3, { id: 4, subscriptionStatus: 'trialing' }), // still a trial
    ];

    await GET(request());

    expect(h.events.filter((e) => e.startsWith('free_'))).toEqual(['free_d3:email']);
    expect(shown().map((e) => e.restaurantId)).toEqual([1]);
  });

  it('does not backfill a restaurant whose trial ended long ago, or without an end date', async () => {
    h.restaurants = [
      lapsed(40, { id: 1 }),
      lapsed(3, { id: 2, trialEndsAt: null }),
    ];

    await GET(request());

    expect(mails()).toHaveLength(0);
    expect(shown()).toHaveLength(0);
  });

  it('does not send the trial messages (day 1, tips, ending warning) on the free plan', async () => {
    h.events = [];
    h.restaurants = [lapsed(3)];

    await GET(request());

    expect(h.events).toEqual(['free_d3:email']);
  });
});
