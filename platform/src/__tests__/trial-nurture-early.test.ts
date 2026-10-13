import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// SQ-220: hourly trigger + the hour1 / morning early bumps for self-serve
// trials with 0 ratings, sent only 08:00-21:00 Mexico City (UTC-6).

const h = vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-secret';
  return {
    sendMail: vi.fn(),
    restaurants: [] as Array<Record<string, unknown>>,
    events: [] as Array<{ event: string; sentAt: Date }>,
    staffCount: 0,
    ratingCount: 0,
  };
});

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
}));
vi.mock('@/lib/mailer', () => ({ FROM: 'RateTap <hello@test>', sendMail: h.sendMail }));
vi.mock('@/lib/mercadopago', () => ({
  getPriceBreakdown: () => ({ base: 700, processingCharge: 27, tax: 0, total: 727 }),
}));
vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.restaurants) return h.restaurants;
    if (table === schema.nurtureEvents) return h.events.map((e) => ({ ...e }));
    if (table === schema.staff) return [{ n: h.staffCount }];
    if (table === schema.reviews) return [{ n: h.ratingCount }];
    if (table === schema.googleRatingSnapshots) return [];
    throw new Error('unexpected table');
  };
  const queryOf = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      orderBy: () => ({ limit: async () => rows.slice(0, 1) }),
    });
  return {
    db: {
      select: () => ({ from: (table: unknown) => ({ where: () => queryOf(rowsFor(table)) }) }),
      insert: () => ({
        values: async (v: { event: string }) => {
          if (h.events.some((e) => e.event === v.event)) throw new Error('unique');
          h.events.push({ event: v.event, sentAt: new Date() });
        },
      }),
      delete: () => ({ where: async () => {} }),
    },
  };
});

import { GET } from '../app/api/cron/trial-nurture/route';

const HOUR = 3_600_000;
const request = () =>
  new NextRequest('https://example.test/api/cron/trial-nurture', {
    headers: { authorization: 'Bearer test-secret' },
  });

// Mexico City is UTC-6 all year (no DST).
const NOON = '2026-10-14T18:00:00Z'; // 12:00 MX
const setNow = (iso: string) => vi.setSystemTime(new Date(iso));
const ago = (ms: number) => new Date(Date.now() - ms);

function restaurant(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Taquería Uno',
    slug: 'taqueria-uno',
    managerEmail: 'owner@example.test',
    managerPhone: null,
    pilot: false,
    teamMode: 'solo',
    googlePlaceId: 'place-1',
    googleReviewUrl: null,
    googleReviewCount: null,
    createdAt: ago(2 * HOUR),
    trialEndsAt: new Date(Date.now() + 28 * 24 * HOUR),
    subscriptionStatus: 'trialing',
    groupKey: null,
    locationsBand: null,
    ...over,
  };
}
const signedUp = (msAgo: number, over: Record<string, unknown> = {}) =>
  restaurant({ createdAt: ago(msAgo), ...over });

const mails = () => h.sendMail.mock.calls.map((c) => c[0] as { subject: string; html: string });
const bySubject = (re: RegExp) => mails().filter((m) => re.test(m.subject));
const words = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const HOUR1 = /Tu QR de .* ya está listo/;
const MORNING = /primera calificación/;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(NOON);
  h.restaurants = [];
  h.events = [];
  h.staffCount = 0;
  h.ratingCount = 0;
  h.sendMail.mockReset().mockResolvedValue({ success: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('hour1', () => {
  it('59 minutes after signup: nothing', async () => {
    h.restaurants = [signedUp(59 * 60_000)];
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('61 minutes after signup: the QR email, with the QR CTA and the forwardable review link', async () => {
    h.restaurants = [signedUp(61 * 60_000)];
    await GET(request());
    const [m] = bySubject(HOUR1);
    expect(m.subject).toBe('Tu QR de Taquería Uno ya está listo');
    expect(m.html).toContain('Muéstralo en tu teléfono a tu próximo cliente al cobrar. Toma 10 segundos.');
    expect(m.html).toMatch(/href="https:\/\/app\.ratetapmx\.com\/dashboard"[^>]*>Abrir mi QR</);
    expect(m.html).toContain('href="https://app.ratetapmx.com/r/taqueria-uno"');
    expect(words(m.html)).toBeLessThanOrEqual(60);
    expect(h.events.map((e) => e.event)).toContain('hour1:email');
  });

  it('is not sent after the 20 hour window', async () => {
    h.restaurants = [signedUp(21 * HOUR)];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(0);
  });

  it('already rated: nothing', async () => {
    h.restaurants = [signedUp(2 * HOUR)];
    h.ratingCount = 1;
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('already sent: nothing', async () => {
    h.restaurants = [signedUp(2 * HOUR)];
    h.events = [{ event: 'hour1:email', sentAt: ago(HOUR) }];
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('works for team and legacy (NULL team_mode) self-serve trials, escaping the name', async () => {
    // The db mock keeps one event list, so run the restaurants one at a time.
    h.restaurants = [signedUp(2 * HOUR, { teamMode: 'team' })];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(1);

    h.events = [];
    h.restaurants = [signedUp(2 * HOUR, { teamMode: null, name: 'Tacos <b>Dos</b>' })];
    await GET(request());
    const sent = bySubject(HOUR1);
    expect(sent).toHaveLength(2);
    expect(sent[1].html).toContain('Tacos &lt;b&gt;Dos&lt;/b&gt;');
  });
});

describe('morning', () => {
  // Signed up 22:00 MX on Oct 13 (04:00Z Oct 14); hour1 was deferred past 21:00.
  const signup = '2026-10-14T04:00:00Z';
  const withSignup = (over: Record<string, unknown> = {}) =>
    restaurant({ createdAt: new Date(signup), ...over });
  // hour1 already went out long enough ago not to suppress the morning email.
  const hour1Sent = () => [{ event: 'hour1:email', sentAt: new Date(Date.now() - 12 * HOUR) }];

  it('under 12 hours since signup (09:00 MX): nothing', async () => {
    setNow('2026-10-14T15:00:00Z'); // 09:00 MX, 11h after signup
    h.restaurants = [withSignup()];
    h.events = hour1Sent();
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('12+ hours since signup, next calendar morning (10:30 MX): the morning email', async () => {
    setNow('2026-10-14T16:30:00Z'); // 10:30 MX, 12.5h after signup
    h.restaurants = [withSignup()];
    h.events = hour1Sent();
    await GET(request());
    const [m] = bySubject(MORNING);
    expect(m.subject).toBe('¿Ya tienes tu primera calificación?');
    expect(m.html).toContain('WhatsApp');
    expect(m.html).toContain('/r/taqueria-uno');
    expect(m.html).toContain('Abrir mi QR');
    expect(words(m.html)).toBeLessThanOrEqual(60);
    expect(h.events.map((e) => e.event)).toContain('morning:email');
  });

  it('uses the Mexico calendar, not UTC: 08:30 MX the day after a 02:00 MX signup', async () => {
    // 08:00Z Oct 14 = 02:00 MX Oct 14. 14:30Z Oct 15 = 08:30 MX Oct 15.
    setNow('2026-10-15T14:30:00Z');
    h.restaurants = [restaurant({ createdAt: new Date('2026-10-14T08:00:00Z') })];
    h.events = hour1Sent();
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(1);
  });

  it('only the morning window (08:00-11:00 MX): 11:00 MX is too late', async () => {
    setNow('2026-10-14T17:00:00Z'); // 11:00 MX
    h.restaurants = [withSignup()];
    h.events = hour1Sent();
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(0);
  });

  it('only the next calendar morning: two mornings later is not backfilled', async () => {
    setNow('2026-10-15T16:30:00Z'); // 10:30 MX on Oct 15, signup was Oct 13 MX
    h.restaurants = [withSignup()];
    h.events = hour1Sent();
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(0);
  });

  it('already rated, or already sent: nothing', async () => {
    setNow('2026-10-14T16:30:00Z');
    h.restaurants = [withSignup()];
    h.events = [...hour1Sent(), { event: 'morning:email', sentAt: ago(HOUR) }];
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(0);

    h.events = hour1Sent();
    h.ratingCount = 2;
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(0);
  });

  it('skipped right after hour1 (no back-to-back), including inside one run', async () => {
    setNow('2026-10-14T16:30:00Z');
    h.restaurants = [withSignup()];
    h.events = [{ event: 'hour1:email', sentAt: ago(3 * HOUR) }];
    await GET(request());
    expect(bySubject(MORNING)).toHaveLength(0);

    // No history: the run sends hour1 and holds the morning email back.
    h.events = [];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(1);
    expect(bySubject(MORNING)).toHaveLength(0);
  });

  it('team copy asks the team; solo copy asks the owner', async () => {
    setNow('2026-10-14T16:30:00Z');
    h.restaurants = [withSignup({ teamMode: 'team' })];
    h.events = hour1Sent();
    await GET(request());
    expect(bySubject(MORNING)[0].html).toContain('tu equipo');

    h.sendMail.mockClear();
    h.events = hour1Sent();
    h.restaurants = [withSignup({ teamMode: 'solo' })];
    await GET(request());
    expect(bySubject(MORNING)[0].html).not.toContain('equipo');
  });
});

describe('send hours', () => {
  it('03:00 MX: nothing is sent, not even an old nurture email', async () => {
    setNow('2026-10-14T09:00:00Z'); // 03:00 MX
    h.restaurants = [signedUp(2 * HOUR), signedUp(30 * HOUR, { id: 2, managerEmail: 'b@example.test' })];
    const res = await GET(request());
    expect(await res.json()).toMatchObject({ processed: 0 });
    expect(mails()).toHaveLength(0);
  });

  it('21:30 MX is out, 20:30 MX is in', async () => {
    setNow('2026-10-15T03:30:00Z'); // 21:30 MX
    h.restaurants = [signedUp(2 * HOUR)];
    await GET(request());
    expect(mails()).toHaveLength(0);

    setNow('2026-10-15T02:30:00Z'); // 20:30 MX
    h.restaurants = [signedUp(2 * HOUR)];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(1);
  });

  it('08:23 MX is in: the deferred hour1 goes out on the first morning run', async () => {
    setNow('2026-10-14T14:23:00Z'); // 08:23 MX
    h.restaurants = [signedUp(10.4 * HOUR)];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(1);
  });
});

describe('day1 suppression', () => {
  const dayOld = () => signedUp(25 * HOUR, { teamMode: null });

  it('still sends when no early bump went out', async () => {
    h.restaurants = [dayOld()];
    await GET(request());
    expect(bySubject(/Te falta un paso/)).toHaveLength(1);
  });

  it('skips when hour1 or morning went out in the last 20 hours', async () => {
    h.restaurants = [dayOld()];
    h.events = [{ event: 'hour1:email', sentAt: ago(5 * HOUR) }];
    await GET(request());
    expect(mails()).toHaveLength(0);

    h.events = [{ event: 'morning:email', sentAt: ago(19 * HOUR) }];
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('sends again once the early bump is more than 20 hours old', async () => {
    h.restaurants = [dayOld()];
    h.events = [{ event: 'hour1:email', sentAt: ago(21 * HOUR) }];
    await GET(request());
    expect(bySubject(/Te falta un paso/)).toHaveLength(1);
  });
});

describe('who is never selected', () => {
  it('group members, founder pilots, paying and lapsed restaurants get no early bump', async () => {
    h.restaurants = [
      signedUp(2 * HOUR, { id: 1, groupKey: 'grupo-estancia', teamMode: null }),
      signedUp(2 * HOUR, { id: 2, pilot: true }),
      signedUp(2 * HOUR, { id: 3, subscriptionStatus: 'active' }),
      signedUp(2 * HOUR, { id: 4, subscriptionStatus: 'canceled' }),
    ];
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(0);
    expect(bySubject(MORNING)).toHaveLength(0);
  });
});

describe('repeat runs and copy', () => {
  it('hourly repeat runs (and the daily Vercel run) send each message once', async () => {
    h.restaurants = [signedUp(2 * HOUR)];
    await GET(request());
    await GET(request());
    setNow('2026-10-14T19:23:00Z');
    await GET(request());
    expect(bySubject(HOUR1)).toHaveLength(1);
    expect(mails()).toHaveLength(1);
  });

  it('is Spanish, neutral, and offers nothing for a review', async () => {
    setNow('2026-10-14T16:30:00Z');
    h.restaurants = [
      restaurant({ createdAt: new Date('2026-10-14T04:00:00Z') }),
      signedUp(2 * HOUR, { id: 2, managerEmail: 'b@example.test' }),
    ];
    await GET(request());
    const text = mails().map((m) => `${m.subject} ${m.html}`).join(' ');
    expect(mails().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/estrella|5 ?★|★|gratis|descuento|regalo|premio|cup[oó]n|\bfree\b/i);
  });
});

describe('workflow', () => {
  const load = (name: string) =>
    readFileSync(path.resolve(__dirname, '../../../.github/workflows', name), 'utf8');
  // Parsed workflow YAML is untyped by nature; one alias keeps the property walks readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Workflow = Record<string, any>;
  const yaml = createRequire(import.meta.url)('js-yaml') as { load: (s: string) => Workflow };

  const nurture = yaml.load(load('hourly-trial-nurture.yml'));
  const outreach = yaml.load(load('hourly-outreach-emails.yml'));
  const stepOf = (wf: Workflow) => wf.jobs.trigger.steps[0];

  it('parses, runs hourly at :23 and can be dispatched', () => {
    expect(nurture.on.schedule).toEqual([{ cron: '23 * * * *' }]);
    expect('workflow_dispatch' in nurture.on).toBe(true);
  });

  it('calls the trial-nurture endpoint with the same secret and auth as the outreach workflow', () => {
    const a = stepOf(nurture);
    const b = stepOf(outreach);
    expect(a.env.CRON_URL).toBe('https://app.ratetapmx.com/api/cron/trial-nurture');
    expect(a.env.CRON_SECRET).toBe(b.env.CRON_SECRET);
    expect(a.env.CRON_SECRET).toBe('${{ secrets.RATETAP_CRON_SECRET }}');
    expect(a.run).toBe(b.run);
    expect(a.run).toContain('--header "Authorization: Bearer ${CRON_SECRET}"');
    expect(a.run).toContain('--fail-with-body');
  });

  it('keeps the daily Vercel cron in place', () => {
    const vercel = JSON.parse(readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'));
    expect(vercel.crons).toContainEqual({ path: '/api/cron/trial-nurture', schedule: '0 18 * * *' });
  });
});
