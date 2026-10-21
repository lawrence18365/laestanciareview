/**
 * The welcome screen's Google connect block, driven for real.
 *
 * THE BUG THIS GUARDS: "Los asaditos" with no location bias returns a listing in
 * another state, and the old block saved the first match the moment it was
 * clicked. So the screen now searches "<name> <city>" first and shows the picked
 * place — name and full address — with "Sí, es mi restaurante" / "No, buscar
 * otro". Nothing may PATCH /api/auth/settings until the owner confirms.
 *
 * It also drives the first view's "Ir a mi panel" button: /bienvenida is
 * server-rendered before the signup session cookie exists, so that href comes
 * from the ready payload, not from an injected session.
 *
 * HOW THIS IS TESTED WITHOUT A DOM RENDERER. This package has no DOM environment
 * or testing library, so — like review-resume.test.tsx — the shipped component is
 * bundled with the esbuild that is already installed and rendered in the Chromium
 * playwright drives, with the API routes the screen calls answered by the test and
 * every request recorded.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as PlaywrightRequest,
  type Route as PlaywrightRoute,
} from 'playwright';

const SRC_DIR = path.resolve(__dirname, '..');
const PLACE = {
  placeId: 'ChIJasaditos',
  name: 'Los Asaditos',
  address: 'Av. Madero 100, Centro, Morelia, Mich., México',
  city: 'Morelia',
  state: 'Michoacán',
};

const STATUS = {
  ready: true,
  slug: 'pizzeria-lupita',
  restaurantName: 'Pizzería Lupita',
  reviewUrl: 'https://app.ratetapmx.com/r/pizzeria-lupita',
  googleConnected: false,
  teamMode: 'solo',
  locationsBand: '1',
  googleReviewCount: null,
  googleProfile: null,
  city: 'Morelia',
  // Minted by GET /api/signup/status together with the session it creates: the
  // first view of this page is served before that cookie exists.
  panelHref: '/dashboard',
};

interface Screen {
  page: Page;
  requests: PlaywrightRequest[];
  /** JSON bodies of the PATCHes to /api/auth/settings. */
  patches: Array<{ method: string; body: unknown }>;
  /** Every /api/places/search query string. */
  searches: URLSearchParams[];
}

let browser: Browser | undefined;
let bundle = '';
const contexts: BrowserContext[] = [];

async function bundleReadyView(): Promise<string> {
  const built = await esbuild.build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { ReadyView } from '@/app/bienvenida/BienvenidaClient';
        const root = createRoot(document.getElementById('root'));
        window.__ready = { render: (props) => root.render(<ReadyView {...props} />) };
      `,
      resolveDir: SRC_DIR,
      loader: 'jsx',
      sourcefile: 'welcome-screen.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_BASE_URL': '"http://ratetap.test"',
      'process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP': '"5215500000000"',
      'process.env.NEXT_PUBLIC_BUILD_SHA': '"test"',
      'process.env.NEXT_PUBLIC_META_PIXEL_ID': '"test"',
      // No browser key: the screen uses the server-backed search this test answers.
      'process.env.NEXT_PUBLIC_GOOGLE_PLACES_BROWSER_KEY': '""',
    },
    alias: { '@': SRC_DIR },
    plugins: [
      {
        name: 'stub-next-script',
        setup(build) {
          build.onResolve({ filter: /^next\/script$/ }, () => ({
            path: 'next-script',
            namespace: 'stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export default function Script(){ return null; }',
            loader: 'js',
          }));
        },
      },
    ],
  });
  return built.outputFiles[0].text;
}

async function openScreen(props: Record<string, unknown>): Promise<Screen> {
  const context = await browser!.newContext();
  contexts.push(context);
  // sendBeacon's body is opaque to the test; the fetch fallback is not.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  const requests: PlaywrightRequest[] = [];
  const patches: Array<{ method: string; body: unknown }> = [];
  const searches: URLSearchParams[] = [];
  page.on('request', (request) => requests.push(request));

  const html = `<!doctype html><html><body><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route('**/*', async (route: PlaywrightRoute) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/places/search') {
      searches.push(url.searchParams);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([PLACE]),
      });
    }
    if (url.pathname === '/api/auth/settings') {
      const request = route.request();
      patches.push({ method: request.method(), body: JSON.parse(request.postData() ?? 'null') });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });

  await page.goto('http://ratetap.test/bienvenida');
  await page.evaluate(
    (p) => (window as unknown as { __ready: { render: (props: unknown) => void } }).__ready.render(p),
    props,
  );
  return { page, requests, patches, searches };
}

/** innerText is what the CSS makes of the text, so comparisons are case-insensitive. */
const says = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

async function waitForText(page: Page, needle: string, timeoutMs = 8_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    text = await page.locator('#root').innerText();
    if (says(text, needle)) return text;
    await page.waitForTimeout(50);
  }
  throw new Error(`the screen never showed ${JSON.stringify(needle)}; it showed ${JSON.stringify(text.slice(0, 240))}`);
}

/** Type a name and click the suggestion the fake Places route returns. */
async function pickFromSearch(page: Page, query: string): Promise<void> {
  await page.fill('#bienvenida-place', query);
  const suggestion = page.locator('ul[aria-label="Resultados de Google"] button').first();
  await suggestion.waitFor({ state: 'visible', timeout: 8_000 });
  await suggestion.click();
}

const CONFIRM = '¿Es este tu restaurante?';
const YES = 'Sí, es mi restaurante';
const NO = 'No, buscar otro';

beforeAll(async () => {
  bundle = await bundleReadyView();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
});

describe('welcome screen: confirming the Google place', () => {
  // A first view: no session cookie exists yet, so no panel href is injected.
  const view = { status: STATUS, trialDays: 30, panelHref: null, isReload: false };

  it('picking a suggestion asks first, shows the address, and saves nothing yet', async () => {
    const screen = await openScreen(view);
    await pickFromSearch(screen.page, 'Los asaditos');

    const text = await waitForText(screen.page, CONFIRM);
    expect(says(text, 'Los Asaditos')).toBe(true);
    expect(says(text, PLACE.address)).toBe(true);
    expect(says(text, YES)).toBe(true);
    expect(says(text, NO)).toBe(true);
    // The search itself was scoped to the restaurant's city.
    expect(screen.searches.map((s) => s.get('city'))).toEqual(['Morelia']);
    // Nothing was saved by the pick.
    expect(screen.patches).toEqual([]);
    expect(screen.requests.some((r) => r.url().includes('/api/auth/settings'))).toBe(false);
  }, 60_000);

  it('"No, buscar otro" goes back to the search and never saves', async () => {
    const screen = await openScreen(view);
    await pickFromSearch(screen.page, 'Los asaditos');
    await waitForText(screen.page, CONFIRM);

    await screen.page.getByRole('button', { name: NO }).click();
    const text = await waitForText(screen.page, 'Conecta tu restaurante en Google');
    expect(says(text, CONFIRM)).toBe(false);
    expect(await screen.page.locator('#bienvenida-place').count()).toBe(1);
    expect(screen.patches).toEqual([]);
  }, 60_000);

  it('"Sí, es mi restaurante" saves the place id, then shows Google conectado', async () => {
    const screen = await openScreen(view);
    await pickFromSearch(screen.page, 'Los asaditos');
    await waitForText(screen.page, CONFIRM);

    await screen.page.getByRole('button', { name: YES }).click();
    const text = await waitForText(screen.page, 'Google conectado');

    expect(screen.patches).toEqual([{ method: 'PATCH', body: { googlePlaceId: PLACE.placeId } }]);
    expect(says(text, CONFIRM)).toBe(false);
    expect(says(text, 'Conecta tu restaurante en Google')).toBe(false);
  }, 60_000);
});

describe('welcome screen: "Ir a mi panel" on the first view', () => {
  it('with no session yet, takes the href from the ready payload and reports the click', async () => {
    // A genuine first view: /bienvenida was server-rendered before the session
    // cookie existed (GET /api/signup/status creates it), so nothing is injected
    // here — the panel href can only come from the status payload.
    const screen = await openScreen({
      status: STATUS,
      trialDays: 30,
      panelHref: null,
      isReload: false,
    });
    const cta = screen.page.getByRole('link', { name: 'Ir a mi panel →' });
    await cta.waitFor({ state: 'visible', timeout: 8_000 });
    expect(await cta.getAttribute('href')).toBe(STATUS.panelHref);
    const text = await screen.page.locator('#root').innerText();
    expect(says(text, 'app.ratetapmx.com/login')).toBe(true);

    // Registered before the click: the event leaves while the link navigates.
    const tracked = screen.page.waitForRequest(
      (r) => r.url().includes('/api/analytics/track') && (r.postData() ?? '').includes('onboarding_cta_click'),
      { timeout: 8_000 },
    );
    await cta.click();
    const body = (await tracked).postData() ?? '';
    expect(body).toContain('"target":"panel"');
    expect(body).toContain('"mode":"solo"');
  }, 60_000);

  it('with neither a session nor a payload href, offers no panel link', async () => {
    const screen = await openScreen({
      status: { ...STATUS, panelHref: undefined },
      trialDays: 30,
      panelHref: null,
      isReload: false,
    });
    const text = await waitForText(screen.page, 'Para volver a entrar');
    expect(says(text, 'Ir a mi panel')).toBe(false);
    expect(await screen.page.getByRole('link', { name: 'Ir a mi panel →' }).count()).toBe(0);
  }, 60_000);
});
