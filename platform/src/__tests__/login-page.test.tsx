import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * /login used to render the form even for someone already signed in — which is
 * the screen a returning owner lands on from a bookmark. It now sends a valid
 * session straight to its panel.
 *
 * The restaurant lookup is the safety valve: /dashboard redirects a session
 * whose restaurant is gone back to /login, so a redirect on a failed or empty
 * lookup would bounce forever. Both of those must keep rendering the form.
 */

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  redirect: vi.fn(),
  getKnownGroupAccounts: vi.fn(),
}));

class NavSignal extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    mocks.redirect(to);
    throw new NavSignal(to);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/group-device', () => ({ getKnownGroupAccounts: mocks.getKnownGroupAccounts }));

import LoginPage, * as LoginPageModule from '../app/login/page';
import { t } from '@/lib/i18n';

type Outcome = { redirectedTo: string } | { html: string };

/** Render the page; a redirect is Next's signal, so it ends the render. */
async function outcome(): Promise<Outcome> {
  try {
    return { html: renderToStaticMarkup(await LoginPage()).replace(/<!-- -->/g, '') };
  } catch (err) {
    if (err instanceof NavSignal) return { redirectedTo: err.to };
    throw err;
  }
}

const restaurant = { id: 7, slug: 'pizzeria-lupita', name: 'Pizzería Lupita' };

describe('GET /login', () => {
  beforeEach(() => {
    mocks.verifySession.mockReset().mockResolvedValue(null);
    mocks.getRestaurantBySlug.mockReset().mockResolvedValue(null);
    mocks.redirect.mockReset();
    mocks.getKnownGroupAccounts.mockReset().mockResolvedValue(null);
  });

  it('stays force-dynamic (the session cookie decides what renders)', () => {
    expect(LoginPageModule.dynamic).toBe('force-dynamic');
  });

  it('renders the form with no session, without touching the database', async () => {
    const result = await outcome();
    expect(result).toHaveProperty('html');
    expect((result as { html: string }).html).toContain(t.login.subtitle);
    expect(mocks.getRestaurantBySlug).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('sends a signed-in gm with a restaurant to /dashboard', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant);
    expect(await outcome()).toEqual({ redirectedTo: '/dashboard' });
    expect(mocks.getRestaurantBySlug).toHaveBeenCalledWith('pizzeria-lupita');
  });

  it.each(['owner', 'regional'])('sends a signed-in %s to /overview', async (role) => {
    mocks.verifySession.mockResolvedValue({ slug: 'grupo-estancia', role, region: 'Bajío' });
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant);
    expect(await outcome()).toEqual({ redirectedTo: '/overview' });
  });

  it('renders the form when the session\'s restaurant is gone (no redirect loop)', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'deleted-restaurant', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(null);
    const result = await outcome();
    expect(result).toHaveProperty('html');
    expect((result as { html: string }).html).toContain(t.login.subtitle);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('renders the form when the lookup fails (no redirect loop)', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'pizzeria-lupita', role: 'gm' });
    mocks.getRestaurantBySlug.mockRejectedValue(new Error('db down'));
    const result = await outcome();
    expect(result).toHaveProperty('html');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('renders the form for an invalid session', async () => {
    mocks.verifySession.mockResolvedValue(null);
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant);
    expect(await outcome()).toHaveProperty('html');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
