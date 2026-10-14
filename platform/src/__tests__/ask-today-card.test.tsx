import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * SQ-225: the "Pide 5 reseñas hoy" WhatsApp card and the Google
 * reviews-since-you-joined counter. The card sends the same generic /r/{slug}
 * link to every guest; the counter never shows 0 as an achievement.
 */

// The db client is mocked with a thenable chain; each select() takes the next queued result.
const queue: unknown[][] = [];
vi.mock('@/db', () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
    c.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return c;
  };
  return { db: { select: () => chain(queue.shift() ?? []) }, transactionDb: {} };
});

// Spy on gte so the "since" boundary the query uses is observable.
const gteCalls: unknown[][] = [];
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    gte: (...args: Parameters<typeof actual.gte>) => {
      gteCalls.push(args);
      return actual.gte(...args);
    },
  };
});

import {
  ASK_TODAY_TARGET,
  AskTodayCard,
  ReviewsSinceJoin,
  sinceJoinCounter,
} from '@/components/dashboard/AskTodayCard';
import { whatsappCustomersHref } from '@/components/dashboard/QrShare';
import DashboardView from '@/components/dashboard/DashboardView';
import { ReadyView, type StatusResponse } from '../app/bienvenida/BienvenidaClient';
import { whatsappSharesToday } from '@/lib/ask-today';
import { getGoogleReviewCountsSinceJoin } from '@/lib/google-places';
import { startOfTodayMexico } from '@/lib/mexico-tz';
import { t } from '@/lib/i18n';

const INCENTIVE = /gratis|descuento|premio|regalo|cortes[ií]a|sorteo|promoci|obsequio|bono|cup[oó]n|ganar|2x1/i;
const URL = 'https://app.ratetapmx.com/r/pizzeria-lupita';
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const clean = (s: string) => s.replace(/<!-- -->/g, '');

function card(over: Partial<React.ComponentProps<typeof AskTodayCard>> = {}) {
  return clean(
    renderToStaticMarkup(
      <AskTodayCard placement="bienvenida" restaurantName="Pizzería Lupita" reviewUrl={URL} {...over} />,
    ),
  );
}

beforeEach(() => {
  queue.length = 0;
  gteCalls.length = 0;
});

describe('AskTodayCard copy and link', () => {
  it('shows the title, helper, button and "0 de 5 hoy" at the start of the day', () => {
    const out = card();
    expect(out).toContain('Pide 5 reseñas hoy');
    expect(out).toContain('Mándale tu enlace a 5 clientes de hoy por WhatsApp.');
    expect(out).toContain('Enviar por WhatsApp');
    expect(out).toContain('0 de 5 hoy');
    expect(out).not.toContain('Listo por hoy');
  });

  it('keeps the helper within 15 words and free of incentive wording', () => {
    expect(words(t.askToday.helper)).toBeLessThanOrEqual(15);
    const text = card().replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(INCENTIVE);
  });

  it('links to the unchanged generic share: same wa.me href and neutral message for every guest', () => {
    const out = card();
    const m = out.match(/href="(https:\/\/wa\.me\/\?text=[^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(whatsappCustomersHref('Pizzería Lupita', URL));
    expect(decodeURIComponent(m![1].split('text=')[1])).toBe(
      '¡Gracias por visitarnos en Pizzería Lupita! ¿Nos dejas tu opinión? https://app.ratetapmx.com/r/pizzeria-lupita',
    );
    // opens in a new tab, never leaks the opener
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('the link is identical whatever the count or placement (no gating)', () => {
    const href = (s: string) => s.match(/href="([^"]+)"/)![1];
    const base = href(card());
    expect(href(card({ initialCount: 4 }))).toBe(base);
    expect(href(card({ initialCount: 9 }))).toBe(base);
    expect(href(card({ placement: 'dashboard' }))).toBe(base);
  });
});

describe('AskTodayCard progress', () => {
  it.each([1, 3, 4])('shows "%i de 5 hoy" below the daily target', (n) => {
    const out = card({ initialCount: n });
    expect(out).toContain(`${n} de 5 hoy`);
    expect(out).not.toContain('Listo por hoy');
  });

  it.each([5, 6, 12])('at %i the day is done, the button stays enabled', (n) => {
    const out = card({ initialCount: n });
    expect(ASK_TODAY_TARGET).toBe(5);
    expect(out).toContain('¡Listo por hoy! Mañana, 5 más.');
    expect(out).not.toMatch(/\d+ de 5 hoy/);
    expect(out).toContain('Enviar por WhatsApp');
    expect(out).not.toContain('disabled');
    expect(out).not.toContain('aria-disabled');
  });
});

describe('placement', () => {
  const props = {
    stats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
    lastWeekStats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
    leaderboard: [],
    unreadCount: 0,
    unreadLowCount: 0,
    roiStats: { totalReviews: 0, googleSends: 0, firstReviewAt: null } as unknown as React.ComponentProps<
      typeof DashboardView
    >['roiStats'],
    monthlyStats: [],
    googleTrend: null,
    googleHistory: [],
    googleRating: null,
    googleReviewCount: 40,
    googleReviewsToday: null,
  } satisfies React.ComponentProps<typeof DashboardView>;
  const selfServe = {
    restaurantName: 'Tacos Ana',
    qrDataUrl: 'data:image/png;base64,QR',
    reviewUrl: 'https://app.ratetapmx.com/r/tacos-ana',
    askTodayCount: 2,
    reviewCounts: null,
  };

  it('bienvenida and dashboard use their own palette', () => {
    expect(card({ placement: 'bienvenida' })).toContain('background:#1c1917');
    const dash = card({ placement: 'dashboard' });
    expect(dash).toContain('background:var(--text-main)');
    expect(dash).not.toContain('#1c1917');
  });

  it('ReadyView renders the card for solo and team with the server count, and not for legacy/group', () => {
    const base: StatusResponse = {
      ready: true,
      slug: 'pizzeria-lupita',
      restaurantName: 'Pizzería Lupita',
      reviewUrl: URL,
      qrDataUrl: 'data:image/png;base64,QR',
      googleConnected: true,
      locationsBand: '1',
      googleReviewCount: null,
      googleProfile: null,
      askTodayCount: 3,
    };
    const view = (s: StatusResponse) =>
      clean(renderToStaticMarkup(<ReadyView status={s} trialDays={30} panelHref={null} />));
    expect(view({ ...base, teamMode: 'solo' })).toContain('3 de 5 hoy');
    expect(view({ ...base, teamMode: 'team', locationsBand: '2-5' })).toContain('3 de 5 hoy');
    expect(view({ ...base, teamMode: null, locationsBand: null })).not.toContain('Pide 5 reseñas hoy');
    expect(view({ ...base, teamMode: 'team', locationsBand: '6+' })).not.toContain('Pide 5 reseñas hoy');
  });

  it('the dashboard empty state renders it for solo and team, team keeps the staff CTAs below', () => {
    const solo = clean(renderToStaticMarkup(<DashboardView {...props} isSolo selfServe={selfServe} />));
    expect(solo).toContain('Pide 5 reseñas hoy');
    expect(solo).toContain('2 de 5 hoy');
    expect(solo).not.toContain('href="/staff"');

    const team = clean(renderToStaticMarkup(<DashboardView {...props} selfServe={selfServe} />));
    expect(team.indexOf('1. Agrega a tus meseros')).toBeGreaterThan(team.indexOf('Pide 5 reseñas hoy'));
    expect(team).toContain('href="/staff"');

    // legacy: no selfServe, no card
    expect(clean(renderToStaticMarkup(<DashboardView {...props} />))).not.toContain('Pide 5 reseñas hoy');
  });
});

describe('whatsappSharesToday: counts by America/Mexico_City day', () => {
  it('counts the rows the query returns and bounds them from Mexico midnight', async () => {
    queue.push([{ n: 3 }]);
    const now = new Date('2026-10-14T20:00:00Z');
    expect(await whatsappSharesToday(7, now)).toBe(3);
    expect(gteCalls[0][1]).toEqual(new Date('2026-10-14T06:00:00Z'));
  });

  it('23:30 in Mexico City is still the same day; 00:30 starts the next', async () => {
    queue.push([{ n: 5 }], [{ n: 0 }]);
    await whatsappSharesToday(7, new Date('2026-10-15T05:30:00Z')); // 23:30 Oct 14 in Mexico
    await whatsappSharesToday(7, new Date('2026-10-15T06:30:00Z')); // 00:30 Oct 15 in Mexico
    expect(gteCalls[0][1]).toEqual(new Date('2026-10-14T06:00:00Z'));
    expect(gteCalls[1][1]).toEqual(new Date('2026-10-15T06:00:00Z'));
    expect(startOfTodayMexico(new Date('2026-10-15T05:59:59Z')).toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(startOfTodayMexico(new Date('2026-10-15T06:00:00Z')).toISOString()).toBe('2026-10-15T06:00:00.000Z');
  });

  it('is 0 when no row comes back', async () => {
    queue.push([]);
    expect(await whatsappSharesToday(7)).toBe(0);
  });
});

describe('Google reviews since you joined', () => {
  it('sinceJoinCounter is hidden without counts and when the count did not grow', () => {
    expect(sinceJoinCounter(null)).toBeNull();
    expect(sinceJoinCounter(undefined)).toBeNull();
    expect(sinceJoinCounter({ baseline: 40, latest: 40 })).toBeNull();
    expect(sinceJoinCounter({ baseline: 40, latest: 38 })).toBeNull();
  });

  it('sinceJoinCounter reports the gain when diff > 0', () => {
    expect(sinceJoinCounter({ baseline: 40, latest: 47 })).toEqual({ baseline: 40, latest: 47, diff: 7 });
  });

  it('renders "Reseñas en Google: a → b" and "+n desde que entraste" only for a gain', () => {
    const shown = clean(renderToStaticMarkup(<ReviewsSinceJoin counts={{ baseline: 40, latest: 47 }} />));
    expect(shown).toContain('Reseñas en Google: 40 → 47');
    expect(shown).toContain('+7 desde que entraste');
    expect(renderToStaticMarkup(<ReviewsSinceJoin counts={null} />)).toBe('');
    expect(renderToStaticMarkup(<ReviewsSinceJoin counts={{ baseline: 40, latest: 40 }} />)).toBe('');
    expect(renderToStaticMarkup(<ReviewsSinceJoin counts={{ baseline: 40, latest: 30 }} />)).toBe('');
  });

  it('getGoogleReviewCountsSinceJoin: null with fewer than 2 snapshots', async () => {
    // no rows at all
    queue.push([], []);
    expect(await getGoogleReviewCountsSinceJoin(1, new Date('2026-10-01T00:00:00Z'))).toBeNull();
    // one row: first and newest are the same snapshot
    queue.push([{ id: 4, reviewCount: 40 }], [{ id: 4, reviewCount: 40 }]);
    expect(await getGoogleReviewCountsSinceJoin(1, new Date('2026-10-01T00:00:00Z'))).toBeNull();
  });

  it('getGoogleReviewCountsSinceJoin: baseline is the first row at/after the join date, latest the newest', async () => {
    const joined = new Date('2026-10-01T00:00:00Z');
    queue.push([{ id: 4, reviewCount: 40 }], [{ id: 9, reviewCount: 47 }]);
    expect(await getGoogleReviewCountsSinceJoin(1, joined)).toEqual({ baseline: 40, latest: 47 });
    expect(gteCalls[0][1]).toEqual(joined);
  });

  it('dashboard: shows the counter on a gain and keeps the old goal line when hidden', () => {
    const props = {
      stats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
      lastWeekStats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
      leaderboard: [],
      unreadCount: 0,
      unreadLowCount: 0,
      roiStats: { totalReviews: 0, googleSends: 0, firstReviewAt: null } as unknown as React.ComponentProps<
        typeof DashboardView
      >['roiStats'],
      monthlyStats: [],
      googleTrend: null,
      googleHistory: [],
      googleRating: null,
      googleReviewCount: 47,
      googleReviewsToday: null,
    } satisfies React.ComponentProps<typeof DashboardView>;
    const sel = (reviewCounts: { baseline: number; latest: number } | null) => ({
      restaurantName: 'Tacos Ana',
      qrDataUrl: null,
      reviewUrl: 'https://app.ratetapmx.com/r/tacos-ana',
      askTodayCount: 0,
      reviewCounts,
    });
    const render = (rc: { baseline: number; latest: number } | null) =>
      clean(renderToStaticMarkup(<DashboardView {...props} isSolo selfServe={sel(rc)} />));

    const gain = render({ baseline: 40, latest: 47 });
    expect(gain).toContain('Reseñas en Google: 40 → 47');
    expect(gain).toContain('+7 desde que entraste');
    expect(gain).not.toContain('Tienes ');

    for (const hidden of [null, { baseline: 47, latest: 47 }, { baseline: 50, latest: 47 }]) {
      const out = render(hidden);
      expect(out).not.toContain('desde que entraste');
      expect(out).not.toContain('Reseñas en Google:');
      expect(out).toContain('Tienes 47 reseñas. Meta: 67.');
    }
  });
});
