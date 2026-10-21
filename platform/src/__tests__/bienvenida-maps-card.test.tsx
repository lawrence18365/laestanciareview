import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * US-16 maps-card: "Tu lugar en Google Maps" on /bienvenida (polled until the
 * signup sweep's samples exist) and the unlocked card on the trial dashboard.
 */

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  getMapsRankSummary: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {}, transactionDb: {} }));
vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/maps-rank', () => ({ getMapsRankSummary: mocks.getMapsRankSummary }));

import { MapsPlaceView, ReadyView, type StatusResponse } from '../app/bienvenida/BienvenidaClient';
import {
  MAPS_POLL_MAX_MS,
  MAPS_POLL_MS,
  mapsCardFor,
  startMapsCardPoll,
  type MapsCardResponse,
  type MapsCardState,
} from '../app/bienvenida/ready-data';
import { GET as mapsCardGET } from '../app/api/onboarding/maps-card/route';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import { canUse, planFor } from '@/lib/entitlements';
import { PRODUCT_EVENT_NAMES } from '@/lib/product-events';

const summary = (over: Record<string, unknown> = {}) => ({
  keyword: 'dentista Tecate',
  measured: 9,
  top3: 0,
  top10: 0,
  found: 0,
  bestRank: null as number | null,
  prevTop3: null,
  runDate: '2026-10-14',
  prevRunDate: null,
  ...over,
});

describe('MapsPlaceView', () => {
  it('found in some zones: count and best place', () => {
    const html = renderToStaticMarkup(
      <MapsPlaceView state={{ phase: 'card', card: { keyword: 'dentista Tecate', found: 4, best: 3 } }} />,
    );
    expect(html).toContain('Tu lugar en Google Maps');
    expect(html).toContain('Para «dentista Tecate» apareces en 4 de 9 zonas cerca de ti.');
    expect(html).toContain('Tu mejor lugar: #3.');
    expect(html).not.toContain('Las reseñas nuevas te ayudan a subir');
  });

  it('found in zero zones: honest line, no achievement, no best place', () => {
    const html = renderToStaticMarkup(
      <MapsPlaceView state={{ phase: 'card', card: { keyword: 'dentista Tecate', found: 0, best: null } }} />,
    );
    expect(html).toContain('Para «dentista Tecate» no apareces en las 9 zonas cerca de ti.');
    expect(html).toContain('Las reseñas nuevas te ayudan a subir.');
    expect(html).not.toContain('Tu mejor lugar');
    expect(html).not.toContain('0 de 9');
  });

  it('waiting: one muted line and no card', () => {
    const html = renderToStaticMarkup(<MapsPlaceView state={{ phase: 'waiting' }} />);
    expect(html).toContain('Buscando tu lugar en Google Maps…');
    expect(html).not.toContain('<section');
  });

  it('hidden after the timeout: renders nothing, not an error', () => {
    expect(renderToStaticMarkup(<MapsPlaceView state={{ phase: 'hidden' }} />)).toBe('');
  });
});

describe('ReadyView placement', () => {
  const base: StatusResponse = {
    ready: true,
    restaurantName: 'Dental Sonrisa',
    reviewUrl: 'https://app.ratetapmx.com/r/dental',
    qrDataUrl: 'data:image/png;base64,QR',
    googleConnected: true,
    googleReviewCount: 12,
    googleProfile: null,
    locationsBand: '1',
  };

  it('self-serve (solo / team) shows the waiting line after the header', () => {
    for (const teamMode of ['solo', 'team'] as const) {
      const html = renderToStaticMarkup(
        <ReadyView status={{ ...base, teamMode }} trialDays={30} panelHref={null} isReload={false} />,
      );
      expect(html).toContain('Buscando tu lugar en Google Maps…');
      expect(html.indexOf('Buscando tu lugar')).toBeGreaterThan(html.indexOf('¡Listo, Dental Sonrisa!'));
      expect(html.indexOf('Buscando tu lugar')).toBeLessThan(html.indexOf('Tu enlace'));
    }
  });

  it('legacy (NULL team_mode) screen is unchanged: no Maps line', () => {
    const html = renderToStaticMarkup(
      <ReadyView
        status={{ ...base, teamMode: null, locationsBand: null }}
        trialDays={30}
        panelHref={null}
        isReload={false}
      />,
    );
    expect(html).not.toContain('Google Maps');
  });
});

describe('mapsCardFor', () => {
  it('no samples -> null', () => {
    expect(mapsCardFor([])).toBeNull();
  });

  it('a run where every Places call failed (measured 0) is not a card', () => {
    expect(mapsCardFor([summary({ measured: 0 })])).toBeNull();
  });

  it('takes the newest run and drops best when nothing was found', () => {
    const card = mapsCardFor([
      summary({ keyword: 'a', runDate: '2026-10-07', found: 5, bestRank: 2 }),
      summary({ keyword: 'b', runDate: '2026-10-14', found: 0, bestRank: null }),
    ]);
    expect(card).toEqual({ keyword: 'b', found: 0, best: null });
  });

  it('found: carries the stored keyword and best rank', () => {
    expect(mapsCardFor([summary({ found: 3, bestRank: 4 })])).toEqual({
      keyword: 'dentista Tecate',
      found: 3,
      best: 4,
    });
  });
});

describe('startMapsCardPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 5 s, stops when data arrives', async () => {
    const load = vi
      .fn<() => Promise<MapsCardResponse | null>>()
      .mockResolvedValueOnce({ card: null })
      .mockResolvedValueOnce({ card: null })
      .mockResolvedValue({ card: { keyword: 'k', found: 2, best: 5 } });
    const states: MapsCardState[] = [];
    startMapsCardPoll(load, (s) => states.push(s));
    expect(states[0]).toEqual({ phase: 'waiting' });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MAPS_POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MAPS_POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toEqual({ phase: 'card', card: { keyword: 'k', found: 2, best: 5 } });

    await vi.advanceTimersByTimeAsync(MAPS_POLL_MAX_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(states.at(-1)?.phase).toBe('card');
  });

  it('no data by 90 s: hides, stops polling, no error', async () => {
    const load = vi.fn<() => Promise<MapsCardResponse | null>>().mockRejectedValue(new Error('net'));
    const states: MapsCardState[] = [];
    startMapsCardPoll(load, (s) => states.push(s));

    await vi.advanceTimersByTimeAsync(MAPS_POLL_MAX_MS - 1);
    expect(states.at(-1)).toEqual({ phase: 'waiting' });
    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)).toEqual({ phase: 'hidden' });
    const calls = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MAPS_POLL_MS * 4);
    expect(load.mock.calls.length).toBe(calls);
  });

  it('server says done with no card: hides at once', async () => {
    const load = vi.fn<() => Promise<MapsCardResponse | null>>().mockResolvedValue({ card: null, done: true });
    const states: MapsCardState[] = [];
    startMapsCardPoll(load, (s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ phase: 'hidden' });
  });
});

describe('GET /api/onboarding/maps-card', () => {
  beforeEach(() => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    mocks.verifySession.mockResolvedValue({ slug: 'dental', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue({ id: 7, slug: 'dental', groupKey: null, teamMode: 'solo' });
    mocks.getMapsRankSummary.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('401 without a restaurant session', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect((await mapsCardGET()).status).toBe(401);
    mocks.verifySession.mockResolvedValue({ slug: 'x', role: 'owner' });
    expect((await mapsCardGET()).status).toBe(401);
  });

  it('no samples yet -> card null, keep polling', async () => {
    const body = await (await mapsCardGET()).json();
    expect(body).toEqual({ card: null });
    expect(mocks.getMapsRankSummary).toHaveBeenCalledWith(7);
  });

  it('samples exist -> the card, with the stored keyword', async () => {
    mocks.getMapsRankSummary.mockResolvedValue([summary({ found: 6, bestRank: 2 })]);
    const body = await (await mapsCardGET()).json();
    expect(body).toEqual({ card: { keyword: 'dentista Tecate', found: 6, best: 2 } });
  });

  it('feature flag off or a legacy / Grupo restaurant -> done, no query', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({ id: 1, slug: 'g', groupKey: 'estancia', teamMode: null });
    expect(await (await mapsCardGET()).json()).toEqual({ card: null, done: true });
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    expect(await (await mapsCardGET()).json()).toEqual({ card: null, done: true });
    expect(mocks.getMapsRankSummary).not.toHaveBeenCalled();
  });

  it('a read failure is a miss, not an error response', async () => {
    mocks.getMapsRankSummary.mockRejectedValue(new Error('db'));
    const res = await mapsCardGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: null });
  });
});

describe('trial dashboard Maps card', () => {
  beforeEach(() => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a trialing self-serve restaurant is unlocked; only free is locked', () => {
    const trial = planFor({ subscriptionStatus: 'trialing', groupKey: null });
    expect(trial).toBe('trial');
    expect(canUse(trial, 'maps_rank')).toBe(true);
    expect(canUse(planFor({ subscriptionStatus: 'canceled', groupKey: null }), 'maps_rank')).toBe(false);
  });

  it('unlocked card shows the sample even before the first review (empty state)', () => {
    const html = renderToStaticMarkup(
      <MapsRankCard summaries={[summary({ found: 2, top10: 2, bestRank: 6 })]} locked={false} />,
    );
    expect(html).toContain('dentista Tecate');
    expect(html).toContain('top 10 en 2 de 9');
    expect(html).not.toContain('Ver planes');
  });
});

describe('maps_card_shown event', () => {
  it('is a known product event', () => {
    expect(PRODUCT_EVENT_NAMES).toContain('maps_card_shown');
  });
});
