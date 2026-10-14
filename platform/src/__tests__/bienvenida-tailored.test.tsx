import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

/**
 * US-14 T4: the /bienvenida ready screen is tailored to solo / team / 6+ with
 * the restaurant's real Google numbers. HARD GUARDRAIL: a restaurant with a
 * NULL team_mode (every existing one, incl. all of Grupo Estancia) keeps
 * today's screen exactly.
 */

const mocks = vi.hoisted(() => ({
  hasSignupCookie: false,
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,QR'),
  selectQueue: [] as unknown[][],
  createSession: vi.fn(async () => undefined),
}));

class NavSignal extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.selectQueue.shift() ?? [] }),
      }),
    }),
  },
  transactionDb: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    has: () => mocks.hasSignupCookie,
    delete: () => undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new NavSignal(to);
  },
}));
vi.mock('@/lib/session', () => ({
  verifySession: mocks.verifySession,
  createSession: mocks.createSession,
}));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/qr', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr')>()),
  generateQrDataUrl: mocks.generateQrDataUrl,
}));
vi.mock('@/lib/tokens', () => ({ verifyTokenHash: async () => true }));
vi.mock('@/lib/signup-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/signup-access')>()),
  parseSignupAccess: () => ({ signupId: 'sig-1', token: 'tok' }),
}));

import BienvenidaPage from '../app/bienvenida/page';
import { ReadyView, type StatusResponse } from '../app/bienvenida/BienvenidaClient';
import { personalLine, readyMode, readyProfileFields } from '../app/bienvenida/ready-data';
import { GET as statusGET } from '../app/api/signup/status/route';
import { PRODUCT_EVENT_NAMES } from '@/lib/product-events';
import { SUPPORT_WHATSAPP_URL } from '@/lib/support';
import type { GoogleProfile } from '@/lib/onboarding-profile';

const profile: GoogleProfile = {
  primaryType: 'pizza_restaurant',
  types: ['pizza_restaurant'],
  takeout: false,
  delivery: false,
  dineIn: true,
  lat: 19.4,
  lng: -99.1,
  formattedAddress: 'Calle 1, CDMX',
  competitors: [
    { name: 'A', reviewCount: 310, rating: 4.4, distanceM: 200 },
    { name: 'B', reviewCount: 48, rating: 4.1, distanceM: 400 },
    { name: 'C', reviewCount: 120, rating: 4.6, distanceM: 600 },
  ],
  fetchedAt: '2026-10-13T00:00:00.000Z',
};

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

/** Rendered text, React's `<!-- -->` text separators removed. */
function html(status: StatusResponse, panelHref: string | null = null) {
  return renderToStaticMarkup(<ReadyView status={status} trialDays={30} panelHref={panelHref} />)
    .replace(/<!-- -->/g, '');
}

function words(markup: string) {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .split(/\s+/)
    .filter(Boolean).length;
}

/** The h1 and the line under it: the part above the QR. */
function aboveTheFold(markup: string) {
  const m = markup.match(/<h1[^>]*>(.*?)<\/h1><p[^>]*>(.*?)<\/p>/);
  expect(m, 'header block not found').not.toBeNull();
  return `${m![1]} ${m![2]}`;
}

const solo = { teamMode: 'solo' as const, locationsBand: '1' as const };
const team = { teamMode: 'team' as const, locationsBand: '2-5' as const };
const group = { teamMode: 'team' as const, locationsBand: '6+' as const };

describe('ready-data', () => {
  it('maps the profile to a mode; NULL/NULL is legacy', () => {
    expect(readyMode({ teamMode: null, locationsBand: null })).toBe('legacy');
    expect(readyMode(solo)).toBe('solo');
    expect(readyMode(team)).toBe('team');
    expect(readyMode(group)).toBe('group');
    expect(readyMode({ teamMode: null, locationsBand: '6+' })).toBe('group');
  });

  it('narrows raw restaurant columns and never trusts free text', () => {
    const f = readyProfileFields({
      teamMode: 'weird',
      locationsBand: 'x',
      googleReviewCount: null,
      googleProfile: 'nope',
    });
    expect(f).toEqual({ teamMode: null, locationsBand: null, googleReviewCount: null, googleProfile: null });
    const g = readyProfileFields({
      teamMode: 'solo',
      locationsBand: '1',
      googleReviewCount: 87,
      googleProfile: profile,
    });
    expect(g.googleReviewCount).toBe(87);
    expect(g.googleProfile?.competitors).toHaveLength(3);
  });

  it('omits every piece whose data is missing and never shows zero as fact', () => {
    expect(personalLine({ googleReviewCount: null, googleProfile: null })).toEqual({ pieces: [], sentences: [] });
    const onlyRivals = personalLine({ googleReviewCount: null, googleProfile: profile });
    expect(onlyRivals.pieces).toEqual(['competitors']);
    expect(onlyRivals.sentences.join(' ')).not.toMatch(/Tienes|Meta sugerida|\b0\b/);
    const full = personalLine({ googleReviewCount: 87, googleProfile: profile });
    expect(full.pieces).toEqual(['count', 'competitors', 'goal']);
    expect(full.sentences).toEqual([
      'Tienes 87 reseñas en Google.',
      'Los 3 más cerca tienen 48, 120 y 310.',
      'Meta sugerida: 107 este mes.',
    ]);
    expect(personalLine({ googleReviewCount: 0, googleProfile: null }).sentences[0]).toBe(
      'Tienes 0 reseñas en Google.',
    );
  });
});

describe('ReadyView per mode', () => {
  it.each([
    ['solo', solo],
    ['team', team],
    ['group', group],
  ])('%s with data: personal line, QR, placement tip', (_name, mode) => {
    const out = html(ready({ ...mode, googleReviewCount: 87, googleProfile: profile }));
    expect(out).toContain('¡Listo, Pizzería Lupita!');
    expect(out).toContain('Tienes 87 reseñas en Google. Los 3 más cerca tienen 48, 120 y 310. Meta sugerida: 107 este mes.');
    expect(out).toContain('src="data:image/png;base64,QR"');
    expect(out).toContain('https://app.ratetapmx.com/r/pizzeria-lupita');
    // placement tip under the QR (no delivery/takeout in this profile)
    expect(out).toMatch(/Ponlo en la caja de cobro o en cada mesa\.|Cada mesero muestra su QR al cobrar\./);
    // the trial sentence is only for the legacy screen
    expect(out).not.toContain('Tu prueba gratis');
  });

  it.each([
    ['solo', solo],
    ['team', team],
    ['group', group],
  ])('%s without a Google profile: no personal-line pieces, no zeros', (_name, mode) => {
    const out = html(ready({ ...mode }));
    expect(out).not.toContain('Tienes');
    expect(out).not.toContain('Meta sugerida');
    expect(out).not.toContain('más cerca');
    expect(out).not.toMatch(/\b0 reseñas/);
    expect(out).toContain('Usa este QR desde hoy.');
    expect(out).toContain('src="data:image/png;base64,QR"');
  });

  it('delivery/takeout profiles get the bag tip', () => {
    const out = html(ready({ ...solo, googleProfile: { ...profile, delivery: true } }));
    expect(out).toContain('Pégalo en la caja o la bolsa de cada pedido.');
  });

  it('solo: ask-today card first, full-screen QR second, print link third, no staff CTA', () => {
    const out = html(ready({ ...solo, googleReviewCount: 5 }));
    const wa = out.indexOf('Pide 5 reseñas hoy');
    const show = out.indexOf('Muéstrale este QR a tu próximo cliente');
    const print = out.indexOf('Imprimir letrero');
    expect(wa).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(wa);
    expect(print).toBeGreaterThan(show);
    expect(out).toContain('href="/qr-codes/letrero"');
    expect(out).not.toContain('Imprime tu letrero');
    expect(out).not.toContain('Agrega a tus meseros');
    // exactly one primary (dark filled) button
    expect(out.match(/background:#1c1917/g)).toHaveLength(1);
  });

  it('team: same three actions, staff CTA stays visible below them', () => {
    const out = html(ready({ ...team }));
    const wa = out.indexOf('Pide 5 reseñas hoy');
    const show = out.indexOf('Muéstrale este QR a tu próximo cliente');
    const print = out.indexOf('Imprimir letrero');
    const staff = out.indexOf('Agrega a tus meseros');
    expect(wa).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(wa);
    expect(print).toBeGreaterThan(show);
    expect(staff).toBeGreaterThan(print);
    expect(out).toContain('href="/staff"');
    expect(out).toContain('Descargar QR por mesero');
    expect(out.match(/background:#1c1917/g)).toHaveLength(1);
  });

  it('team non-food (dentist): "tu equipo" wording, no waiter words; food team unchanged', () => {
    const dentist: GoogleProfile = { ...profile, primaryType: 'dentist', types: ['dentist', 'health'] };
    const out = html(ready({ ...team, googleProfile: dentist }));
    expect(out).toContain('Agrega a tu equipo →');
    expect(out).toContain('Descargar QR por persona');
    expect(out).toContain('Cada persona de tu equipo muestra su QR al cobrar.');
    expect(out).not.toMatch(/mesero/);

    const solo1 = html(ready({ ...solo, googleProfile: dentist }));
    expect(solo1).toContain('Ponlo en tu mostrador o en la recepción.');

    const food = html(ready({ ...team, googleProfile: profile }));
    expect(food).toContain('Agrega a tus meseros →');
    expect(food).toContain('Descargar QR por mesero');
    expect(food).not.toContain('Agrega a tu equipo');
  });

  it('6+: schedule-a-call is primary, staff CTA secondary', () => {
    const out = html(ready({ ...group }));
    expect(out).toContain(`href="${SUPPORT_WHATSAPP_URL}"`);
    expect(out).toContain('Agenda una llamada →');
    const call = out.indexOf('Agenda una llamada');
    const staff = out.indexOf('Agrega a tus meseros');
    expect(call).toBeGreaterThan(-1);
    expect(staff).toBeGreaterThan(call);
    expect(out.match(/background:#1c1917/g)).toHaveLength(1);
  });

  it('legacy (NULL team_mode) is exactly today\'s screen', () => {
    const out = html(ready());
    expect(out).toContain('¡Listo, Pizzería Lupita!');
    expect(out).toContain('Tu prueba gratis de 30 días ya está activa. Usa este QR desde hoy.');
    expect(out).toContain('✓ Google conectado');
    expect(out).toContain('href="/staff"');
    expect(out).toContain('Agrega a tus meseros →');
    expect(out).toContain('href="/qr-codes"');
    expect(out).toContain('Descargar QR por mesero');
    expect(out).toContain('Para volver a entrar, usa tu contraseña en <a href="/login"');
    // none of the tailored pieces
    for (const s of ['Tienes', 'Meta sugerida', 'más cerca', 'letrero', 'Agenda una llamada', 'Ponlo en la caja', 'Pégalo en', 'Cada mesero muestra']) {
      expect(out).not.toContain(s);
    }
  });

  it('legacy ignores stray profile data (a profile alone never changes the group)', () => {
    const withData = html(ready({ googleReviewCount: 87, googleProfile: profile }));
    expect(withData).toBe(html(ready()));
  });

  it('keeps the Google-connect block when Google is not connected', () => {
    const out = html(ready({ ...solo, googleConnected: false }));
    expect(out).toContain('Conecta tu restaurante en Google');
    expect(html(ready({ ...solo, googleConnected: true }))).toContain('✓ Google conectado');
  });

  it('keeps the top of the screen within 30 words in every tailored mode', () => {
    for (const mode of [solo, team, group]) {
      const full = aboveTheFold(html(ready({ ...mode, googleReviewCount: 1234, googleProfile: profile })));
      expect(words(full), full).toBeLessThanOrEqual(30);
      const bare = aboveTheFold(html(ready({ ...mode })));
      expect(words(bare), bare).toBeLessThanOrEqual(30);
    }
  });

  it('reload: panel link replaces the /login footer', () => {
    const out = html(ready({ ...solo }), '/dashboard');
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain('Ir a mi panel →');
    expect(out).not.toContain('/login');
  });
});

describe('analytics', () => {
  it('allows the new personal-line event', () => {
    expect((PRODUCT_EVENT_NAMES as readonly string[]).includes('onboarding_personal_line_shown')).toBe(true);
  });
});

describe('/bienvenida reload with a session', () => {
  beforeEach(() => {
    mocks.hasSignupCookie = false;
    mocks.verifySession.mockReset();
    mocks.getRestaurantBySlug.mockReset();
  });

  async function renderPage() {
    return renderToStaticMarkup(await BienvenidaPage({ searchParams: Promise.resolve({}) }))
      .replace(/<!-- -->/g, '');
  }

  function row(over: Record<string, unknown>) {
    return {
      slug: 'pizzeria-lupita',
      name: 'Pizzería Lupita',
      googleReviewUrl: null,
      googlePlaceId: 'ChIJ123',
      teamMode: null,
      locationsBand: null,
      googleReviewCount: null,
      googleProfile: null,
      ...over,
    };
  }

  it('shows the tailored ready screen with the QR and the CTA, not the one-time cookie', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(
      row({ teamMode: 'solo', locationsBand: '1', googleReviewCount: 87, googleProfile: profile }),
    );
    const out = await renderPage();
    expect(mocks.getRestaurantBySlug).toHaveBeenCalledWith('pizzeria-lupita');
    expect(out).toContain('src="data:image/png;base64,QR"');
    expect(out).toContain('¡Listo, Pizzería Lupita!');
    expect(out).toContain('Tienes 87 reseñas en Google.');
    expect(out).toContain('Muéstrale este QR a tu próximo cliente');
    expect(out).toContain('Imprimir letrero');
    expect(out).toContain('Ir a mi panel →');
    expect(out).not.toContain('Tu cuenta ya está lista');
  });

  it('legacy restaurant (NULL team_mode) keeps today\'s short card, without loading a QR', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'estancia-leon', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(row({ slug: 'estancia-leon', name: 'La Estancia León' }));
    mocks.generateQrDataUrl.mockClear();
    const out = await renderPage();
    expect(out).toContain('Tu cuenta ya está lista');
    expect(out).toContain('Ir a mi panel →');
    expect(out).not.toContain('data:image/png');
    expect(mocks.generateQrDataUrl).not.toHaveBeenCalled();
  });

  it('owner and regional sessions keep the short card', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'owner', role: 'owner' });
    const out = await renderPage();
    expect(out).toContain('Tu cuenta ya está lista');
    expect(mocks.getRestaurantBySlug).not.toHaveBeenCalled();
  });

  it('falls back to the short card when the restaurant lookup fails', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockRejectedValue(new Error('db down'));
    expect(await renderPage()).toContain('Tu cuenta ya está lista');
  });
});

describe('GET /api/signup/status', () => {
  const pending = {
    id: 'sig-1',
    expiresAt: new Date(Date.now() + 60_000),
    statusTokenHash: 'h',
    restaurantId: 7,
  };
  const restaurant = {
    slug: 'pizzeria-lupita',
    name: 'Pizzería Lupita',
    isOwner: false,
    trialEndsAt: null,
    pilot: false,
    googleReviewUrl: null,
    googlePlaceId: 'ChIJ123',
  };

  async function call() {
    const res = await statusGET(new NextRequest('http://localhost/api/signup/status'));
    return res.json();
  }

  it('adds the onboarding profile fields for a solo restaurant', async () => {
    mocks.selectQueue = [
      [pending],
      [{ ...restaurant, teamMode: 'solo', locationsBand: '1', googleReviewCount: 87, googleProfile: profile }],
    ];
    const body = await call();
    expect(body.ready).toBe(true);
    expect(body.teamMode).toBe('solo');
    expect(body.locationsBand).toBe('1');
    expect(body.googleReviewCount).toBe(87);
    expect(body.googleProfile.competitors).toHaveLength(3);
  });

  it('offers the goal question to an unanswered self-serve restaurant only', async () => {
    mocks.selectQueue = [[pending], [{ ...restaurant, teamMode: 'team', locationsBand: '2-5', googleProfile: null }]];
    expect((await call()).goalQuestion).toEqual({ teamMode: 'team' });
    mocks.selectQueue = [[pending], [{ ...restaurant, teamMode: 'solo', locationsBand: '1', googleProfile: { goal: 'more_reviews' } }]];
    expect('goalQuestion' in (await call())).toBe(false);
    mocks.selectQueue = [[pending], [{ ...restaurant, teamMode: null, locationsBand: null, googleProfile: null }]];
    expect('goalQuestion' in (await call())).toBe(false);
  });

  it('is all null for a legacy restaurant', async () => {
    mocks.selectQueue = [
      [pending],
      [{ ...restaurant, teamMode: null, locationsBand: null, googleReviewCount: null, googleProfile: null }],
    ];
    const body = await call();
    expect(body.ready).toBe(true);
    expect(body.teamMode).toBeNull();
    expect(body.locationsBand).toBeNull();
    expect(body.googleReviewCount).toBeNull();
    expect(body.googleProfile).toBeNull();
  });
});
