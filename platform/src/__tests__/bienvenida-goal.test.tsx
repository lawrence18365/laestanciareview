import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * US-14 follow-up: the optional tap-only "¿Qué quieres lograr?" question on
 * /bienvenida, its POST route, and the trial:funnel "Por meta" split.
 * HARD GUARDRAIL: a NULL team_mode or group_key restaurant (Grupo Estancia)
 * never sees the question and cannot answer it.
 */

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,QR'),
  recordProductEvent: vi.fn(async () => undefined),
  updated: [{ id: 7 }] as Array<{ id: number }>,
  setCalls: [] as unknown[],
  whereCalls: [] as unknown[],
}));

vi.mock('@/db', () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        mocks.setCalls.push(v);
        return {
          where: (w: unknown) => {
            mocks.whereCalls.push(w);
            return { returning: async () => mocks.updated };
          },
        };
      },
    }),
  },
  transactionDb: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ has: () => false, delete: () => undefined }),
}));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));
vi.mock('@/lib/session', () => ({
  verifySession: mocks.verifySession,
  createSession: vi.fn(),
}));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/qr', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr')>()),
  generateQrDataUrl: mocks.generateQrDataUrl,
}));
vi.mock('@/lib/product-events', async (orig) => ({
  ...(await orig<typeof import('@/lib/product-events')>()),
  recordProductEvent: mocks.recordProductEvent,
}));

import BienvenidaPage from '../app/bienvenida/page';
import { ReadyView, type StatusResponse } from '../app/bienvenida/BienvenidaClient';
import { goalQuestionFor } from '../app/bienvenida/ready-data';
import { POST } from '../app/api/onboarding/goal/route';
import { PRODUCT_EVENT_NAMES } from '@/lib/product-events';
import { canAskGoal, goalFromProfile, goalOptions } from '@/lib/onboarding-profile';

function ready(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    ready: true,
    slug: 'pizzeria-lupita',
    restaurantName: 'Pizzería Lupita',
    reviewUrl: 'https://app.ratetapmx.com/r/pizzeria-lupita',
    qrDataUrl: 'data:image/png;base64,QR',
    googleConnected: true,
    teamMode: null,
    locationsBand: null,
    googleReviewCount: null,
    googleProfile: null,
    ...over,
  };
}

function html(status: StatusResponse) {
  return renderToStaticMarkup(<ReadyView status={status} trialDays={30} panelHref={null} />)
    .replace(/<!-- -->/g, '');
}

const QUESTION = '¿Qué quieres lograr?';

describe('goal question rendering', () => {
  it('self-serve solo: the question and three chips, before the CTAs', () => {
    const out = html(ready({ teamMode: 'solo', locationsBand: '1', goalQuestion: { teamMode: 'solo' } }));
    expect(out).toContain(QUESTION);
    for (const label of ['Más reseñas en Google', 'Ganarle a la competencia en Maps', 'Saber qué opinan mis clientes']) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain('Que mi equipo pida reseñas');
    expect(out.indexOf(QUESTION)).toBeLessThan(out.indexOf('Imprime tu letrero'));
    // chips are not a second primary (dark filled) button
    expect(out.match(/background:#1c1917/g)).toHaveLength(1);
  });

  it('team adds the fourth chip', () => {
    const out = html(ready({ teamMode: 'team', locationsBand: '2-5', goalQuestion: { teamMode: 'team' } }));
    expect(out).toContain('Que mi equipo pida reseñas');
    expect(goalOptions('team').map((o) => o.goal)).toEqual([
      'more_reviews', 'beat_competitor', 'customer_feedback', 'team_asks',
    ]);
    expect(goalOptions('solo')).toHaveLength(3);
  });

  it('legacy / Grupo (no goalQuestion in the payload) is exactly today\'s screen', () => {
    const legacy = html(ready());
    expect(legacy).not.toContain(QUESTION);
    expect(legacy).not.toContain('Más reseñas en Google');
    // a tailored restaurant without the question is also untouched
    expect(html(ready({ teamMode: 'solo', locationsBand: '1' }))).not.toContain(QUESTION);
  });
});

describe('goalQuestionFor (who is asked)', () => {
  const profile = { fetchedAt: '2026-10-13T00:00:00.000Z' };

  it('asks only self-serve restaurants with a team_mode', () => {
    expect(goalQuestionFor({ groupKey: null, teamMode: 'solo', googleProfile: profile })).toEqual({
      goalQuestion: { teamMode: 'solo' },
    });
    expect(goalQuestionFor({ teamMode: 'team', googleProfile: null })).toEqual({
      goalQuestion: { teamMode: 'team' },
    });
  });

  it('never asks NULL team_mode or a group member', () => {
    expect(goalQuestionFor({ groupKey: null, teamMode: null, googleProfile: null })).toEqual({});
    expect(goalQuestionFor({ groupKey: 'estancia', teamMode: 'team', googleProfile: null })).toEqual({});
    expect(canAskGoal({ groupKey: 'estancia', teamMode: null })).toBe(false);
  });

  it('hides after an answer, even when google_profile has only the goal', () => {
    expect(goalQuestionFor({ teamMode: 'solo', googleProfile: { ...profile, goal: 'more_reviews' } })).toEqual({});
    expect(goalQuestionFor({ teamMode: 'solo', googleProfile: { goal: 'beat_competitor' } })).toEqual({});
    // an unknown stored value is not an answer
    expect(goalFromProfile({ goal: 'nope' })).toBeNull();
    expect(goalQuestionFor({ teamMode: 'solo', googleProfile: { goal: 'nope' } })).not.toEqual({});
  });
});

describe('/bienvenida reload shows the question once', () => {
  beforeEach(() => {
    mocks.verifySession.mockReset();
    mocks.getRestaurantBySlug.mockReset();
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
  });

  async function renderPage(over: Record<string, unknown>) {
    mocks.getRestaurantBySlug.mockResolvedValue({
      slug: 'pizzeria-lupita',
      name: 'Pizzería Lupita',
      googleReviewUrl: null,
      googlePlaceId: 'ChIJ123',
      groupKey: null,
      teamMode: 'solo',
      locationsBand: '1',
      googleReviewCount: null,
      googleProfile: null,
      ...over,
    });
    return renderToStaticMarkup(await BienvenidaPage({ searchParams: Promise.resolve({}) }))
      .replace(/<!-- -->/g, '');
  }

  it('shown for an unanswered self-serve restaurant', async () => {
    expect(await renderPage({})).toContain(QUESTION);
  });

  it('hidden once answered', async () => {
    expect(await renderPage({ googleProfile: { goal: 'more_reviews' } })).not.toContain(QUESTION);
  });

  it('hidden for a group member even with a team_mode', async () => {
    expect(await renderPage({ groupKey: 'estancia', teamMode: 'team' })).not.toContain(QUESTION);
  });
});

describe('POST /api/onboarding/goal', () => {
  const dialect = new PgDialect();

  function post(body: unknown) {
    return POST(
      new Request('http://localhost:3000/api/onboarding/goal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  }

  const selfServe = (over: Record<string, unknown> = {}) => ({
    id: 7,
    slug: 'pizzeria-lupita',
    groupKey: null,
    teamMode: 'solo',
    ...over,
  });

  beforeEach(() => {
    mocks.verifySession.mockReset();
    mocks.getRestaurantBySlug.mockReset();
    mocks.recordProductEvent.mockClear();
    mocks.setCalls.length = 0;
    mocks.whereCalls.length = 0;
    mocks.updated = [{ id: 7 }];
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(selfServe());
  });

  it('registers the event name', () => {
    expect((PRODUCT_EVENT_NAMES as readonly string[]).includes('signup_goal_selected')).toBe(true);
  });

  it('saves a valid goal into google_profile and records the event', async () => {
    const res = await post({ goal: 'beat_competitor' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, goal: 'beat_competitor' });
    expect(mocks.setCalls).toHaveLength(1);
    const set = mocks.setCalls[0] as { googleProfile: { queryChunks: unknown[] } };
    const { sql: setSql, params } = dialect.sqlToQuery(set.googleProfile as never);
    expect(setSql).toContain('||');
    expect(params).toContain('{"goal":"beat_competitor"}');
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'signup_goal_selected',
        restaurantId: 7,
        properties: { goal: 'beat_competitor' },
      }),
    );
  });

  it.each(['', 'free_money', 'MORE_REVIEWS', 42, null])('rejects goal %j server-side', async (goal) => {
    const res = await post({ goal });
    expect(res.status).toBe(400);
    expect(mocks.setCalls).toHaveLength(0);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and a missing goal', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(mocks.setCalls).toHaveLength(0);
  });

  it('team_asks is only valid for team_mode team', async () => {
    expect((await post({ goal: 'team_asks' })).status).toBe(400);
    expect(mocks.setCalls).toHaveLength(0);
    mocks.getRestaurantBySlug.mockResolvedValue(selfServe({ teamMode: 'team' }));
    expect((await post({ goal: 'team_asks' })).status).toBe(200);
  });

  it('writes only the session\'s own restaurant, ignoring any id or slug in the body', async () => {
    const res = await post({ goal: 'more_reviews', slug: 'estancia-leon', restaurantId: 99, id: 99 });
    expect(res.status).toBe(200);
    expect(mocks.getRestaurantBySlug).toHaveBeenCalledTimes(1);
    expect(mocks.getRestaurantBySlug).toHaveBeenCalledWith('pizzeria-lupita');
    const { params } = dialect.sqlToQuery(mocks.whereCalls[0] as never);
    expect(params).toContain(7);
    expect(params).not.toContain(99);
    expect(params).not.toContain('estancia-leon');
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 7 }));
  });

  it('requires a restaurant (gm) session', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect((await post({ goal: 'more_reviews' })).status).toBe(401);
    mocks.verifySession.mockResolvedValue({ slug: 'owner', role: 'owner' });
    expect((await post({ goal: 'more_reviews' })).status).toBe(401);
    expect(mocks.setCalls).toHaveLength(0);
  });

  it('refuses a cross-origin request', async () => {
    const res = await POST(
      new Request('http://localhost:3000/api/onboarding/goal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ goal: 'more_reviews' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(mocks.setCalls).toHaveLength(0);
  });

  it('refuses Grupo Estancia: NULL team_mode or a group member', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue(selfServe({ teamMode: null }));
    expect((await post({ goal: 'more_reviews' })).status).toBe(403);
    mocks.getRestaurantBySlug.mockResolvedValue(selfServe({ groupKey: 'estancia', teamMode: 'team' }));
    expect((await post({ goal: 'more_reviews' })).status).toBe(403);
    expect(mocks.setCalls).toHaveLength(0);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('answers once: a second answer is 409 and records nothing', async () => {
    mocks.updated = [];
    const res = await post({ goal: 'more_reviews' });
    expect(res.status).toBe(409);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });
});
