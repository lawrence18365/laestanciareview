import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// US-14 / SQ-195: nurture tailored by restaurants.team_mode. Activation = first
// rating. NULL team_mode must keep today's copy (guardrail: Grupo Estancia).

const h = vi.hoisted(() => {
  process.env.WHATSAPP_API_ENABLED = '1';
  process.env.CRON_SECRET = 'test-secret';
  return {
    sendMail: vi.fn(),
    restaurants: [] as Array<Record<string, unknown>>,
    events: [] as string[],
    staffCount: 0,
    ratingCount: 0,
    sentToGoogleCount: 0,
    snapshotCount: null as number | null,
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
  const hasCol = (pred: unknown, name: string): boolean =>
    (Array.isArray(pred) ? pred : [pred]).some(
      (p) => (p as { col?: { name?: string } } | null)?.col?.name === name,
    );
  const rowsFor = (table: unknown, pred: unknown): unknown[] => {
    if (table === schema.restaurants) return h.restaurants;
    if (table === schema.nurtureEvents) return h.events.map((event) => ({ event }));
    if (table === schema.staff) return [{ n: h.staffCount }];
    if (table === schema.reviews) {
      return [{ n: hasCol(pred, 'sent_to_google') ? h.sentToGoogleCount : h.ratingCount }];
    }
    if (table === schema.googleRatingSnapshots) {
      return h.snapshotCount === null ? [] : [{ n: h.snapshotCount }];
    }
    throw new Error('unexpected table');
  };
  // Thenable, so both `await ...where()` and `...where().orderBy().limit()` work.
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
    teamMode: null,
    googlePlaceId: 'place-1',
    googleReviewUrl: null,
    googleReviewCount: null,
    createdAt: new Date(Date.now() - 1.5 * DAY),
    trialEndsAt: new Date(Date.now() + 20 * DAY),
    subscriptionStatus: 'trialing',
    groupKey: null,
    locationsBand: null,
    ...over,
  };
}
const at = (days: number, over: Record<string, unknown> = {}) =>
  restaurant({ createdAt: new Date(Date.now() - (days + 0.5) * DAY), ...over });

const fetchMock = vi.fn();
const mails = () => h.sendMail.mock.calls.map((c) => c[0] as { subject: string; html: string });
const whatsapps = () =>
  fetchMock.mock.calls.map((c) => new URLSearchParams(c[1].body as string).get('Body') as string);
const words = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const bySubject = (re: RegExp) => mails().filter((m) => re.test(m.subject));
const everyText = () => [...mails().flatMap((m) => [m.subject, m.html]), ...whatsapps()];

function reset() {
  h.events = [];
  h.sendMail.mockClear();
  fetchMock.mockClear();
}

beforeEach(() => {
  // Noon in Mexico City: inside the send hours and outside the morning bump window.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));
  h.restaurants = [];
  h.events = [];
  h.staffCount = 0;
  h.ratingCount = 0;
  h.sentToGoogleCount = 0;
  h.snapshotCount = null;
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('trial nurture tailored: day1', () => {
  it('solo, not activated: letrero + first review, no waiter step', async () => {
    h.restaurants = [restaurant({ teamMode: 'solo' })];
    await GET(request());
    const [m] = mails();
    expect(m.subject).toMatch(/Tu primera reseña/);
    expect(m.html).toContain('/qr-codes/letrero');
    expect(m.html).toContain('Pídele la reseña a tu próximo cliente');
    expect(m.html).not.toContain('/staff');
    expect(whatsapps()[0]).toContain('/qr-codes/letrero');
    expect(whatsapps()[0]).not.toContain('/staff');
  });

  it('solo asks to connect Google only when it is missing', async () => {
    h.restaurants = [restaurant({ teamMode: 'solo', googlePlaceId: null })];
    await GET(request());
    expect(mails()[0].html).toContain('/settings');
  });

  it('solo, activated by one rating: no day1 message', async () => {
    h.restaurants = [restaurant({ teamMode: 'solo' })];
    h.ratingCount = 1;
    await GET(request());
    expect(mails()).toHaveLength(0);
    expect(h.events).toEqual([]);
  });

  it('team, no waiters, no ratings: the waiter step', async () => {
    h.restaurants = [restaurant({ teamMode: 'team' })];
    await GET(request());
    expect(mails()[0].html).toContain('/staff');
    expect(mails()[0].html).not.toContain('letrero');
  });

  it('team with waiters and Google set: nothing on day1', async () => {
    h.restaurants = [restaurant({ teamMode: 'team' })];
    h.staffCount = 3;
    await GET(request());
    expect(mails()).toHaveLength(0);
  });

  it('team, activated by a rating: skips day1 even with zero waiters', async () => {
    h.restaurants = [restaurant({ teamMode: 'team' })];
    h.ratingCount = 2;
    await GET(request());
    expect(mails()).toHaveLength(0);
  });
});

describe('trial nurture tailored: day3', () => {
  it('solo, 0 ratings: letrero nudge', async () => {
    h.restaurants = [at(3, { teamMode: 'solo' })];
    await GET(request());
    const [m] = bySubject(/Activa tu RateTap/);
    expect(m.html).toContain('Aún no hay calificaciones');
    expect(m.html).toContain('/qr-codes/letrero');
    expect(m.html).not.toContain('/staff');
  });

  it('solo, with ratings: real progress numbers (email and WhatsApp)', async () => {
    h.restaurants = [at(3, { teamMode: 'solo' })];
    h.ratingCount = 12;
    h.sentToGoogleCount = 7;
    h.snapshotCount = 48;
    await GET(request());
    const [m] = bySubject(/Tu avance/);
    expect(m.html).toContain('Llevas 12 calificaciones; 7 fueron a Google.');
    expect(m.html).toContain('Tienes 48 reseñas; tu meta: 68.');
    expect(whatsapps().find((b) => /Llevas 12/.test(b))).toContain('Tienes 48 reseñas; tu meta: 68.');
  });

  it('team, 0 ratings: the waiter step only while there are no waiters', async () => {
    h.restaurants = [at(3, { teamMode: 'team' })];
    await GET(request());
    const [none] = bySubject(/Activa tu RateTap/);
    expect(none.html).toContain('/staff');
    expect(none.html).toContain('/qr-codes');

    reset();
    h.staffCount = 4;
    await GET(request());
    const [some] = bySubject(/Activa tu RateTap/);
    expect(some.html).not.toContain('/staff');
    expect(some.html).toContain('/qr-codes');
  });

  it('team, with ratings: progress, even when waiters are missing', async () => {
    h.restaurants = [at(3, { teamMode: 'team' })];
    h.ratingCount = 3;
    h.sentToGoogleCount = 1;
    h.snapshotCount = 100;
    await GET(request());
    expect(bySubject(/Tu avance/)[0].html)
      .toContain('Llevas 3 calificaciones; 1 fue a Google. Tienes 100 reseñas; tu meta: 120.');
    expect(bySubject(/Activa tu RateTap/)).toHaveLength(0);
  });
});

describe('trial nurture tailored: day7', () => {
  it('solo, 0 ratings: the nudge under the activation subject', async () => {
    h.restaurants = [at(7, { teamMode: 'solo' })];
    await GET(request());
    expect(bySubject(/Aún no hay calificaciones/)[0].html).toContain('/qr-codes/letrero');
  });

  it('team, 0 ratings: QR nudge, no waiter step when waiters exist', async () => {
    h.restaurants = [at(7, { teamMode: 'team' })];
    h.staffCount = 2;
    await GET(request());
    const [m] = bySubject(/Aún no hay calificaciones/);
    expect(m.html).toContain('/qr-codes');
    expect(m.html).not.toContain('/staff');
  });

  it('solo and team with ratings: progress and never "Aún no hay calificaciones"', async () => {
    for (const teamMode of ['solo', 'team']) {
      reset();
      h.restaurants = [at(7, { teamMode })];
      h.ratingCount = 5;
      h.sentToGoogleCount = 2;
      h.snapshotCount = 30;
      await GET(request());
      expect(bySubject(/Una semana con RateTap/)[0].html)
        .toContain('Llevas 5 calificaciones; 2 fueron a Google. Tienes 30 reseñas; tu meta: 50.');
      for (const text of everyText()) expect(text).not.toContain('Aún no hay calificaciones');
    }
  });
});

describe('trial nurture tailored: real numbers only', () => {
  it('omits the Google count and goal when nothing is known', async () => {
    h.restaurants = [at(3, { teamMode: 'solo', googleReviewCount: null })];
    h.ratingCount = 4;
    h.sentToGoogleCount = 2;
    await GET(request());
    const [m] = bySubject(/Tu avance/);
    expect(m.html).toContain('Llevas 4 calificaciones; 2 fueron a Google.');
    expect(m.html).not.toMatch(/Tienes|meta/);
  });

  it('falls back to the restaurant column when there is no snapshot', async () => {
    h.restaurants = [at(3, { teamMode: 'solo', googleReviewCount: 10 })];
    h.ratingCount = 4;
    await GET(request());
    expect(bySubject(/Tu avance/)[0].html).toContain('Tienes 10 reseñas; tu meta: 30.');
  });

  it('uses singular forms', async () => {
    h.restaurants = [at(3, { teamMode: 'solo' })];
    h.ratingCount = 1;
    h.sentToGoogleCount = 1;
    h.snapshotCount = 1;
    await GET(request());
    expect(bySubject(/Tu avance/)[0].html)
      .toContain('Llevas 1 calificación; 1 fue a Google. Tienes 1 reseña; tu meta: 21.');
  });
});

describe('trial nurture: NULL team_mode keeps today\'s copy', () => {
  it('never receives solo copy or progress numbers on any day', async () => {
    let sent = 0;
    for (const days of [1, 3, 7]) {
      for (const [staffCount, ratingCount] of [[0, 0], [2, 0], [0, 5], [2, 5]]) {
        reset();
        h.restaurants = [at(days, { teamMode: null })];
        h.staffCount = staffCount;
        h.ratingCount = ratingCount;
        h.sentToGoogleCount = 3;
        h.snapshotCount = 99;
        await GET(request());
        sent += mails().length;
        for (const text of everyText()) {
          expect(text).not.toMatch(/letrero|Tu avance|Llevas [\d.,]+ calificaci|tu meta|Tu primera reseña/);
        }
      }
    }
    expect(sent).toBeGreaterThanOrEqual(8);
  });

  it('legacy gating is unchanged: no waiters with ratings still sends the activation variant', async () => {
    h.restaurants = [at(7, { teamMode: null })];
    h.staffCount = 0;
    h.ratingCount = 4;
    await GET(request());
    const [m] = bySubject(/Aún no hay calificaciones/);
    expect(m.html).toContain('/staff');
    expect(m.html).toContain('/qr-codes');
  });

  it('an unknown team_mode value is treated as NULL, never solo', async () => {
    h.restaurants = [restaurant({ teamMode: 'bogus' })];
    await GET(request());
    expect(mails()[0].html).toContain('/staff');
    expect(mails()[0].html).not.toContain('letrero');
  });
});

describe('trial nurture tailored: shared behavior', () => {
  it('day12 is identical for solo and NULL', async () => {
    const run = async (teamMode: string | null) => {
      reset();
      h.restaurants = [restaurant({
        teamMode,
        createdAt: new Date(Date.now() - 12.5 * DAY),
        trialEndsAt: new Date(Date.now() + 2.5 * DAY),
      })];
      h.ratingCount = 5;
      h.staffCount = 2;
      await GET(request());
      return mails().find((m) => /termina en 3 días/.test(m.subject));
    };
    const legacy = await run(null);
    const solo = await run('solo');
    expect(legacy).toBeDefined();
    expect(solo).toEqual(legacy);
  });

  it('keeps the per-channel claims: an email-only restaurant gets no WhatsApp row', async () => {
    h.restaurants = [at(3, { teamMode: 'solo', managerPhone: null })];
    await GET(request());
    expect(whatsapps()).toHaveLength(0);
    expect(h.events.some((e) => e.endsWith(':whatsapp'))).toBe(false);
    expect(h.events).toContain('day3:email');
  });

  it('dedupes: a second run sends nothing new', async () => {
    h.restaurants = [at(3, { teamMode: 'solo' })];
    h.ratingCount = 3;
    await GET(request());
    const first = mails().length;
    expect(first).toBeGreaterThan(0);
    await GET(request());
    expect(mails()).toHaveLength(first);
  });

  it('keeps every tailored email at 60 words or fewer', async () => {
    const collected: string[] = [];
    for (const teamMode of ['solo', 'team']) {
      for (const days of [1, 3, 7]) {
        for (const ratingCount of [0, 12]) {
          for (const googlePlaceId of ['place-1', null]) {
            reset();
            h.restaurants = [at(days, { teamMode, googlePlaceId })];
            h.ratingCount = ratingCount;
            h.sentToGoogleCount = 7;
            h.snapshotCount = 48;
            await GET(request());
            collected.push(...mails().map((m) => m.html));
          }
        }
      }
    }
    expect(collected.length).toBeGreaterThanOrEqual(20);
    for (const html of collected) expect(words(html)).toBeLessThanOrEqual(60);
  });
});
