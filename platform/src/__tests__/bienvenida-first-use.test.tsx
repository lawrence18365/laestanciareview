import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Three first-use fixes on the welcome screen and /login:
 *
 * 1. "Ir a mi panel" exists on the FIRST ready view too. It used to be a reload
 *    only, because ReadyView read "panelHref !== null" as "this is a reload" —
 *    which also gated the once-only personal-line event. The two meanings are
 *    now separate props (panelHref / isReload). A real first view has no session
 *    cookie yet (GET /api/signup/status creates it), so the ready payload also
 *    carries the href: ReadyView falls back to status.panelHref.
 * 2. The Google search is scoped to the restaurant's city, and a pick is only a
 *    candidate: nothing is saved until "Sí, es mi restaurante".
 *
 * The click paths live in bienvenida-place-confirm-e2e.test.tsx, which drives
 * the real component in Chromium: this suite has no DOM renderer.
 */

const mocks = vi.hoisted(() => ({
  hasSignupCookie: false,
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,QR'),
}));

vi.mock('@/db', () => ({ db: {}, transactionDb: {} }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ has: () => mocks.hasSignupCookie, delete: () => undefined }),
}));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));
vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession, createSession: vi.fn() }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/qr', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr')>()),
  generateQrDataUrl: mocks.generateQrDataUrl,
}));
vi.mock('@/lib/ask-today', () => ({ whatsappSharesToday: async () => 0 }));
vi.mock('@/lib/google-places', () => ({ getGoogleReviewCountsSinceJoin: async () => null }));

// The widget's own search is covered in place-search-hint.test.tsx; here only
// the props the welcome screen hands it matter.
vi.mock('@/components/GooglePlaceSearch', () => ({
  default: (props: { city?: string; inputId?: string }) => (
    <span data-place-search data-city={props.city ?? ''} data-input={props.inputId ?? ''} />
  ),
  PlaceSearchStatus: () => null,
}));

import BienvenidaPage from '../app/bienvenida/page';
import {
  PlaceConfirmView,
  ReadyView,
  placeAddressLine,
  type StatusResponse,
} from '../app/bienvenida/BienvenidaClient';
import type { PlaceSelection } from '@/components/GooglePlaceSearch';

function ready(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    ready: true,
    slug: 'pizzeria-lupita',
    restaurantName: 'Pizzería Lupita',
    reviewUrl: 'https://app.ratetapmx.com/r/pizzeria-lupita',
    qrDataUrl: 'data:image/png;base64,QR',
    googleConnected: true,
    teamMode: 'solo',
    locationsBand: '1',
    googleReviewCount: null,
    googleProfile: null,
    ...over,
  };
}

function markup(status: StatusResponse, panelHref: string | null = null, isReload = false) {
  return renderToStaticMarkup(
    <ReadyView status={status} trialDays={30} panelHref={panelHref} isReload={isReload} />,
  ).replace(/<!-- -->/g, '');
}

const PLACE: PlaceSelection = {
  placeId: 'ChIJasaditos',
  name: 'Los Asaditos',
  address: { city: 'Morelia', state: 'Michoacán' },
  fullAddress: 'Av. Madero 100, Centro, Morelia, Mich.',
};

describe('first view: "Ir a mi panel"', () => {
  it('with a session, shows the panel button and the /login hint under it', () => {
    const out = markup(ready(), '/dashboard', false);
    expect(out).toContain('Ir a mi panel →');
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain('Para volver después, entra en');
    expect(out).toContain('href="/login"');
    // a real second button, not the bare reload link
    expect(out).toMatch(/<a href="\/dashboard"[^>]*border:1px solid #1c1917/);
  });

  it('without a session, keeps today\'s footer only (no broken link)', () => {
    // Neither a session href nor one in the payload: nothing to link to.
    const out = markup(ready(), null, false);
    expect(out).toContain('Para volver a entrar, usa tu contraseña en <a href="/login"');
    expect(out).not.toContain('Ir a mi panel');
    expect(out).not.toContain('Para volver después');
  });

  it('the reload path is unchanged: the small link, no /login hint', () => {
    const out = markup(ready(), '/dashboard', true);
    expect(out).toContain('Ir a mi panel →');
    expect(out).toContain('href="/dashboard"');
    expect(out).not.toContain('/login');
  });

  it('owner/regional sessions get their own panel href', () => {
    expect(markup(ready(), '/overview', false)).toContain('href="/overview"');
  });

  it('a genuine first view (no session yet) takes the href from the ready payload', () => {
    // /bienvenida is rendered before GET /api/signup/status creates the session,
    // so sessionPanelHref is null here — the payload is the only source.
    const out = markup(ready({ panelHref: '/dashboard' }), null, false);
    expect(out).toContain('Ir a mi panel →');
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain('Para volver después, entra en');
    expect(out).toMatch(/<a href="\/dashboard"[^>]*border:1px solid #1c1917/);
  });

  it('the payload href follows the role it was minted for', () => {
    expect(markup(ready({ panelHref: '/overview' }), null, false)).toContain('href="/overview"');
  });

  it('a session href wins over the payload href', () => {
    expect(markup(ready({ panelHref: '/dashboard' }), '/overview', false)).toContain('href="/overview"');
    expect(markup(ready({ panelHref: '/dashboard' }), '/overview', false)).not.toContain('href="/dashboard"');
  });

});

describe('selecting a Google place asks first', () => {
  it('shows the name, the full address and both answers', () => {
    const out = renderToStaticMarkup(
      <PlaceConfirmView place={PLACE} saving={false} error="" onConfirm={() => {}} onCancel={() => {}} />,
    ).replace(/<!-- -->/g, '');
    expect(out).toContain('¿Es este tu restaurante?');
    expect(out).toContain('Los Asaditos');
    expect(out).toContain('Av. Madero 100, Centro, Morelia, Mich.');
    expect(out).toContain('Sí, es mi restaurante');
    expect(out).toContain('No, buscar otro');
  });

  it('shows the save error and the in-flight state on the confirm step', () => {
    const failed = renderToStaticMarkup(
      <PlaceConfirmView
        place={PLACE}
        saving={false}
        error="No se pudo guardar. Intenta de nuevo."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ).replace(/<!-- -->/g, '');
    expect(failed).toContain('No se pudo guardar. Intenta de nuevo.');

    const saving = renderToStaticMarkup(
      <PlaceConfirmView place={PLACE} saving error="" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(saving).toContain('Guardando…');
    expect(saving).toContain('disabled');
  });

  it('falls back to city/state when Google returns no formatted address', () => {
    expect(placeAddressLine({ ...PLACE, fullAddress: '' })).toBe('Morelia, Michoacán');
    expect(placeAddressLine(PLACE)).toBe('Av. Madero 100, Centro, Morelia, Mich.');
    expect(placeAddressLine({ ...PLACE, fullAddress: '', address: { city: '', state: '' } })).toBe('');
  });

  it('the search block is what shows before a pick', () => {
    const out = markup(ready({ googleConnected: false }));
    expect(out).toContain('Conecta tu restaurante en Google');
    expect(out).not.toContain('¿Es este tu restaurante?');
  });
});

describe('the restaurant city reaches the welcome search', () => {
  it('is passed to GooglePlaceSearch', () => {
    const out = markup(ready({ googleConnected: false, city: 'Morelia' }));
    expect(out).toContain('data-city="Morelia"');
    expect(out).toContain('data-input="bienvenida-place"');
  });

  it('is absent when the restaurant has no city', () => {
    expect(markup(ready({ googleConnected: false, city: null }))).toContain('data-city=""');
  });
});

describe('reload payload carries restaurants.city', () => {
  beforeEach(() => {
    mocks.hasSignupCookie = false;
    mocks.verifySession.mockReset().mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockReset();
  });

  function row(over: Record<string, unknown> = {}) {
    return {
      id: 7,
      slug: 'pizzeria-lupita',
      name: 'Pizzería Lupita',
      googleReviewUrl: null,
      googlePlaceId: null,
      groupKey: null,
      teamMode: 'solo',
      locationsBand: '1',
      googleReviewCount: null,
      googleProfile: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      city: 'Morelia',
      ...over,
    };
  }

  async function pageMarkup(): Promise<string> {
    return renderToStaticMarkup(await BienvenidaPage({ searchParams: Promise.resolve({}) })).replace(
      /<!-- -->/g,
      '',
    );
  }

  it('passes the restaurant city into the search on a reload', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue(row());
    expect(await pageMarkup()).toContain('data-city="Morelia"');
  });

  it('passes none when the restaurant has no city', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue(row({ city: null }));
    expect(await pageMarkup()).toContain('data-city=""');
  });
});
