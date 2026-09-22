/**
 * Guest review resume — the mount path of StarRating.
 *
 * The bug this file guards is a guest who taps a star, the phone reloads (or the
 * QR is scanned again, or the tab is reopened), and the review screen comes back
 * as if nothing had happened: under the old timestamp-only guard it showed "ya
 * recibimos su opinión", and before that guard existed it showed the stars again
 * — a second POST and a second slot of the guest's 3-per-device cap. Both are
 * wrong for the same reason: the review row and its feedback token already
 * exist, so the only correct screen is the Google-or-private-feedback choice for
 * THAT review.
 *
 * HOW THIS IS TESTED WITHOUT A DOM RENDERER. This project's test dependencies
 * include no DOM environment or testing library, so the mount decision lives in
 * one exported function, resolveReviewMountState(), which the effect calls
 * verbatim — the restore, the analytics report and the "nothing else happens"
 * fact are asserted against the shipped code path rather than a copy of it. Those
 * unit tests cannot see what the screen does when the SAME element is handed a
 * different restaurant, because that leftover is React state; that half of the
 * file renders the real component in the Chromium playwright drives and changes
 * the props for real (see "changing the slug re-mounts the screen").
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as esbuild from 'esbuild';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as PlaywrightRequest,
  type Route as PlaywrightRoute,
} from 'playwright';
import StarRating, { resolveReviewMountState } from '@/components/review/StarRating';
import { track } from '@/lib/analytics-client';
import { t } from '@/lib/i18n';
import {
  LEGACY_RATED_STORAGE_PREFIX,
  REVIEW_SESSION_STORAGE_PREFIX,
  REVIEW_SESSION_TTL_MS,
  REVIEW_SESSION_VERSION,
  reviewSessionStorageKey,
} from '@/lib/review-session';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/analytics-client', () => ({ track: vi.fn() }));

const SLUG = 'la-estancia';
const OTHER_SLUG = 'estancia-leon';
const STAFF_CODE = 'ANA-01';
const RESTAURANT_NAME = 'La Estancia';
const REVIEW_ID = 42;
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 chars, like randomToken()
const LINK = 'https://g.page/r/example/review';
const MINUTE = 60_000;

const COMPONENT_SOURCE = readFileSync(
  path.resolve(__dirname, '../components/review/StarRating.tsx'),
  'utf8',
);

/** A browser with localStorage, plus the spies that see who touches it. */
function installBrowser() {
  const items = new Map<string, string>();
  const getItem = vi.fn((key: string): string | null => items.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string): void => {
    items.set(key, value);
  });
  const removeItem = vi.fn((key: string): void => {
    items.delete(key);
  });
  const storage = {
    get length() {
      return items.size;
    },
    clear: vi.fn(() => items.clear()),
    key: vi.fn((index: number) => [...items.keys()][index] ?? null),
    getItem,
    setItem,
    removeItem,
  } as unknown as Storage;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage, location: { pathname: `/r/${SLUG}`, search: '' } },
    configurable: true,
    writable: true,
  });

  return { storage, getItem, setItem, removeItem };
}

type BrowserFixture = ReturnType<typeof installBrowser>;

/** The stored entry exactly as saveReviewSession() writes it. */
function sessionEntry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: REVIEW_SESSION_VERSION,
    slug: SLUG,
    reviewId: REVIEW_ID,
    feedbackToken: TOKEN,
    googleReviewUrl: LINK,
    rating: 5,
    createdAt: Date.now() - MINUTE,
    ...overrides,
  });
}

function seedSession(browser: BrowserFixture, raw: string, slug = SLUG): void {
  browser.storage.setItem(`${REVIEW_SESSION_STORAGE_PREFIX}${slug}`, raw);
}

const fetchSpy = vi.fn(() => Promise.reject(new Error('the mount path must not fetch')));

beforeEach(() => {
  vi.mocked(track).mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a guest who already tapped a star resumes that review', () => {
  it('returns the choice for the stored review instead of the stars', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ rating: 4 }));

    const mount = resolveReviewMountState(SLUG, STAFF_CODE);

    expect(mount).toEqual({
      resumed: true,
      rating: 4,
      choice: {
        reviewId: REVIEW_ID,
        feedbackToken: TOKEN,
        googleReviewUrl: LINK,
      },
    });
    // Both options, and the credential to take the private one. A resume is
    // evidence that a rating was stored and nothing more: it must not decide for
    // the guest which path they took.
    expect(mount.choice?.googleReviewUrl).toBe(LINK);
    expect(mount.choice?.feedbackToken).toBe(TOKEN);
  });

  it('restores the rating the guest picked, so the copy matches it', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ rating: 2 }));

    expect(resolveReviewMountState(SLUG, STAFF_CODE).rating).toBe(2);
  });

  it('keeps the private-feedback choice when the restaurant has no Google link', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ googleReviewUrl: null }));

    const mount = resolveReviewMountState(SLUG, STAFF_CODE);

    expect(mount.resumed).toBe(true);
    expect(mount.choice?.googleReviewUrl).toBeNull();
    expect(mount.choice?.feedbackToken).toBe(TOKEN);
  });

  it('drops a tampered link instead of navigating to it, and still resumes', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ googleReviewUrl: 'javascript:alert(document.cookie)' }));

    const mount = resolveReviewMountState(SLUG, STAFF_CODE);

    // The link is assigned to window.location.href by chooseGoogle, so a
    // tampered entry loses the Google option — not the whole screen.
    expect(mount.choice?.googleReviewUrl).toBeNull();
    expect(mount.choice?.feedbackToken).toBe(TOKEN);
  });
});

describe('resuming calls nothing', () => {
  it('performs no write, no second POST and no cleanup on mount', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry());
    browser.setItem.mockClear();

    resolveReviewMountState(SLUG, STAFF_CODE);

    // A restore writes nothing, which is also why a reload loop can never extend
    // the 12 h window: there is no write to move createdAt forward.
    expect(browser.setItem).not.toHaveBeenCalled();
    expect(browser.removeItem).not.toHaveBeenCalled();
    // The review row and its token already exist; re-POSTing here would create a
    // second review and spend a second slot of the device cap.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads only the key for the restaurant it was asked about', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry());
    browser.getItem.mockClear();

    resolveReviewMountState(SLUG, STAFF_CODE);

    expect(browser.getItem).toHaveBeenCalledWith(reviewSessionStorageKey(SLUG));
    expect(browser.getItem).not.toHaveBeenCalledWith(reviewSessionStorageKey(OTHER_SLUG));
    expect(browser.getItem).not.toHaveBeenCalledWith(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`);
  });
});

describe('what still shows the stars', () => {
  it('a first-time guest with nothing stored', () => {
    installBrowser();

    expect(resolveReviewMountState(SLUG, STAFF_CODE)).toEqual({
      resumed: false,
      rating: 0,
      choice: null,
    });
  });

  it('a session stored for another restaurant on this phone', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ slug: OTHER_SLUG }), OTHER_SLUG);

    expect(resolveReviewMountState(SLUG, STAFF_CODE).resumed).toBe(false);
  });

  it('a session older than the 12 h window', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ createdAt: Date.now() - REVIEW_SESSION_TTL_MS }));

    expect(resolveReviewMountState(SLUG, STAFF_CODE).resumed).toBe(false);
  });

  it('does not fall back to the retired "already received" notice', () => {
    const browser = installBrowser();
    // Exactly what the old guard left behind: a timestamp, and no session.
    browser.storage.setItem(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`, String(Date.now() - MINUTE));

    const mount = resolveReviewMountState(SLUG, STAFF_CODE);

    // The stars, not a repeat notice: the marker alone is not evidence that this
    // guest has rated, and treating it as such is what lost the choice screen.
    expect(mount).toEqual({ resumed: false, rating: 0, choice: null });
    expect(browser.getItem).not.toHaveBeenCalledWith(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`);
  });

  it.each([
    ['truncated json', 'not json{'],
    ['an unknown version', sessionEntry({ version: REVIEW_SESSION_VERSION + 1 })],
    ['a missing token', sessionEntry({ feedbackToken: undefined })],
    ['a truncated token', sessionEntry({ feedbackToken: 'short' })],
    ['a zero review id', sessionEntry({ reviewId: 0 })],
    ['a rating outside 1-5', sessionEntry({ rating: 9 })],
    ['a future-dated entry', sessionEntry({ createdAt: Date.now() + 60 * MINUTE })],
  ])('a corrupt or unusable entry (%s)', (_label, raw) => {
    const browser = installBrowser();
    seedSession(browser, raw);

    expect(resolveReviewMountState(SLUG, STAFF_CODE).resumed).toBe(false);
  });

  it('a browser with no localStorage at all', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { pathname: `/r/${SLUG}`, search: '' } },
      configurable: true,
      writable: true,
    });

    expect(resolveReviewMountState(SLUG, STAFF_CODE)).toEqual({
      resumed: false,
      rating: 0,
      choice: null,
    });
  });
});

describe('what the resume mount reports to analytics', () => {
  it('marks the mount as resumed and carries no credential', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry({ rating: 4 }));

    resolveReviewMountState(SLUG, STAFF_CODE);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      'review_screen_shown',
      {
        staff_code: STAFF_CODE,
        resumed: true,
        rating: 4,
        review_id: REVIEW_ID,
        has_google_link: true,
      },
      { restaurantSlug: SLUG },
    );
    // The feedback token is the credential for /api/reviews/feedback and both
    // chose-* routes. It lives in localStorage and nowhere else.
    expect(JSON.stringify(vi.mocked(track).mock.calls[0])).not.toContain(TOKEN);
  });

  it('reports a fresh screen without inventing a resume', () => {
    installBrowser();

    resolveReviewMountState(SLUG, '');

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      'review_screen_shown',
      { staff_code: null },
      { restaurantSlug: SLUG },
    );
  });
});

describe('the static pass is storage-blind and renders nothing', () => {
  it('renders no stars and touches no storage before the effect has decided', () => {
    const browser = installBrowser();
    seedSession(browser, sessionEntry());
    // The seed above is setup, not render behavior: it shares the same setItem
    // spy, so its call is discarded here for the assertion below to see only
    // what the static pass itself does.
    browser.setItem.mockClear();

    const html = renderToStaticMarkup(
      <StarRating restaurantSlug={SLUG} staffCode={STAFF_CODE} restaurantName={RESTAURANT_NAME} />,
    );

    // Nothing rather than the stars: rendering a decision the server cannot make
    // would flash the rating UI and then swap it for the choice, which is a
    // hydration mismatch — and a guest who tapped inside that window would have
    // created a second review.
    expect(html).toBe('');
    expect(browser.getItem).not.toHaveBeenCalled();
    expect(browser.setItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * The screens themselves are not asserted here: the priority chain
 * (already-received, error, redirecting, choice, hint) is rendered JSX, and this
 * project has no DOM renderer in its test dependencies. What is pinned instead
 * is the state that chain reads — `choice !== null` on a resume, with the flags
 * that outrank it (showAlreadyReceived, error, redirecting) still at their
 * `false` defaults until the guest acts. The screens are driven for real, and the
 * slug change with them, in the Chromium block at the end of this file.
 */
describe('the component keeps one submit path and one mount path', () => {
  const normalized = COMPONENT_SOURCE.replace(/\s+/g, ' ');

  it('declares exactly one submit handler, with no reference to the retired guard', () => {
    expect(COMPONENT_SOURCE.match(/const handleSubmit = useCallback\(/g)).toHaveLength(1);
    expect(COMPONENT_SOURCE).not.toMatch(/rememberSuccessfulSubmit|RATED_STORAGE_WINDOW/);
    expect(COMPONENT_SOURCE).not.toMatch(/ratetap_rated_/);
    expect(COMPONENT_SOURCE).not.toContain('review_blocked_local_guard');
  });

  it('persists the session before it reveals the choice', () => {
    const saved = normalized.indexOf('saveReviewSession(outcome.session);');
    const revealed = normalized.indexOf('setChoice({');

    expect(saved).toBeGreaterThan(-1);
    expect(revealed).toBeGreaterThan(-1);
    // A reload between the star tap and the choice must resume this exact
    // review, so the write cannot wait for the reveal.
    expect(saved).toBeLessThan(revealed);
  });

  it('never fetches from the mount path', () => {
    const mount = normalized.slice(
      normalized.indexOf('const mount = resolveReviewMountState'),
      normalized.indexOf('}, [restaurantSlug, staffCode]);'),
    );

    expect(mount).not.toContain('fetch(');
    expect(mount).not.toContain('localStorage');
  });

  it('tells the device cap apart from a stored review, and only persists the latter', () => {
    const cap = normalized.indexOf("if (outcome.kind === 'limited') {");
    const invalid = normalized.indexOf(
      "if (outcome.kind === 'invalid') throw new Error('Invalid submit response');",
    );
    const saved = normalized.indexOf('saveReviewSession(outcome.session);');

    // The server's own 3-per-device cap produces no review row, so it must show
    // the notice and create no session: a session there would offer a choice
    // whose token authenticates nothing. An unusable body retries instead.
    expect(cap).toBeGreaterThan(-1);
    expect(invalid).toBeGreaterThan(-1);
    expect(saved).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(saved);
    expect(invalid).toBeLessThan(saved);
  });
});

/**
 * THE REMOUNT BOUNDARY, RENDERED FOR REAL.
 *
 * The blocker this guards: a guest scans test-a, is offered the choice, then
 * scans test-b, which they have nothing cached for — and test-a's screen is still
 * up, its "Dejar mi reseña en Google" and "Enviar comentario privado al gerente"
 * buttons still carrying test-a's live review token under test-b's heading.
 *
 * The unit tests above cannot see that: the leftover is React state, and the
 * "react state" half is exactly what a DOM-less suite cannot mount. So the real
 * component is bundled with the esbuild that is already installed and rendered
 * in the Chromium that playwright (a devDependency of this package) drives, with
 * the props changed for real on the same root — which is how a slug change
 * reaches the component.
 */
describe('changing the slug re-mounts the screen', () => {
  const CACHED_SLUG = 'test-a';
  const FRESH_SLUG = 'test-b';
  const CACHED_REVIEW_ID = 11;
  const CACHED_GOOGLE_LINK = 'http://ratetap.test/previous-restaurant-google';
  /** Not from `t`: the choice buttons' copy is written in the JSX. */
  const CHOICE_GOOGLE = 'Dejar mi reseña en Google';
  const CHOICE_FEEDBACK = 'Enviar comentario privado al gerente';
  const REDIRECTING = 'Abriendo Google';
  const SRC_DIR = path.resolve(__dirname, '..');

  let browser: Browser | undefined;
  let bundle = '';
  const contexts: BrowserContext[] = [];

  const activeBrowser = (): Browser => {
    if (!browser) throw new Error('chromium was not started');
    return browser;
  };

  /** The shipped component, plus the one thing a Next router would provide. */
  async function bundleReviewScreen(): Promise<string> {
    const built = await esbuild.build({
      stdin: {
        contents: `
          import { createRoot } from 'react-dom/client';
          import StarRating from '@/components/review/StarRating';
          window.dataLayer = [];
          const root = createRoot(document.getElementById('root'));
          window.__review = { render: (props) => root.render(<StarRating {...props} />) };
        `,
        resolveDir: SRC_DIR,
        loader: 'jsx',
        sourcefile: 'review-screen.tsx',
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      logLevel: 'silent',
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.NEXT_PUBLIC_BUILD_SHA': '"test"',
      },
      alias: { '@': SRC_DIR },
      plugins: [
        {
          name: 'stub-next-navigation',
          setup(build) {
            build.onResolve({ filter: /^next\/navigation$/ }, () => ({
              path: 'next-navigation',
              namespace: 'stub',
            }));
            build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
              contents:
                'export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){},back(){}};}',
              loader: 'js',
            }));
          },
        },
      ],
    });
    return built.outputFiles[0].text;
  }

  interface Screen {
    page: Page;
    /** Every URL the page requested, so a stale POST or redirect is visible. */
    requests: string[];
  }

  /**
   * A real page at a real origin (localStorage needs one), serving the harness
   * for the document and canned answers for the two API routes the screen uses.
   */
  async function openScreen(options: { submitDelayMs?: number } = {}): Promise<Screen> {
    const context = await activeBrowser().newContext();
    contexts.push(context);
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request: PlaywrightRequest) => requests.push(request.url()));

    const html = `<!doctype html><html><body><div id="root"></div><script>${bundle}</script></body></html>`;
    await page.route('**/*', async (route: PlaywrightRoute) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/reviews/submit') {
        // What the route answers with for a stored review: a row id and a token.
        if (options.submitDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.submitDelayMs));
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            reviewId: CACHED_REVIEW_ID,
            feedbackToken: TOKEN,
            action: 'choice',
            googleReviewUrl: CACHED_GOOGLE_LINK,
          }),
        });
      }
      if (pathname.startsWith('/api/')) return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });

    // Any path will do: the harness is what every document request gets.
    await page.goto(`http://ratetap.test/r/${FRESH_SLUG}`);
    return { page, requests };
  }

  async function seedSession(
    page: Page,
    slug: string,
    overrides: { googleReviewUrl?: string | null } = {},
  ): Promise<void> {
    await page.evaluate(
      ([key, raw]) => window.localStorage.setItem(key, raw),
      [
        reviewSessionStorageKey(slug),
        JSON.stringify({
          version: REVIEW_SESSION_VERSION,
          slug,
          reviewId: CACHED_REVIEW_ID,
          feedbackToken: TOKEN,
          googleReviewUrl:
            overrides.googleReviewUrl === undefined ? CACHED_GOOGLE_LINK : overrides.googleReviewUrl,
          rating: 5,
          createdAt: Date.now() - MINUTE,
        }),
      ] as [string, string],
    );
  }

  /** The same root, new props — a slug change as the component receives it. */
  async function renderScreen(page: Page, restaurantSlug: string, restaurantName: string) {
    await page.evaluate(
      (props) =>
        (window as unknown as { __review: { render: (p: unknown) => void } }).__review.render(props),
      { restaurantSlug, staffCode: STAFF_CODE, restaurantName },
    );
  }

  /**
   * innerText is what the CSS makes of the text, and the choice buttons are
   * uppercased there, so every comparison here is case-insensitive.
   */
  const says = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

  async function waitForScreenText(page: Page, needle: string, timeoutMs = 8_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let text = '';
    while (Date.now() < deadline) {
      text = await page.locator('#root').innerText();
      if (says(text, needle)) return text;
      await page.waitForTimeout(50);
    }
    throw new Error(
      `the screen never showed ${JSON.stringify(needle)}; it showed ${JSON.stringify(text.slice(0, 240))}`,
    );
  }

  beforeAll(async () => {
    bundle = await bundleReviewScreen();
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
  });

  it('a cached restaurant gives way to a fresh one with none of its screen left', async () => {
    const screen = await openScreen();
    await seedSession(screen.page, CACHED_SLUG);
    await renderScreen(screen.page, CACHED_SLUG, 'Restaurante A');
    expect(says(await waitForScreenText(screen.page, CHOICE_GOOGLE), CHOICE_FEEDBACK)).toBe(true);

    await renderScreen(screen.page, FRESH_SLUG, 'Restaurante B');
    const text = await waitForScreenText(screen.page, t.starRating.tapToRate);

    expect(await screen.page.locator('h1').first().innerText()).toBe('Restaurante B');
    // The fresh restaurant's own screen: the stars, and no button that could
    // spend the previous restaurant's review token from under this heading.
    expect(says(text, CHOICE_GOOGLE)).toBe(false);
    expect(says(text, CHOICE_FEEDBACK)).toBe(false);
    expect(await screen.page.locator('#root').innerHTML()).not.toContain(CACHED_GOOGLE_LINK);
    // ...and the change itself submits nothing for the new restaurant.
    expect(screen.requests.filter((url) => url.includes('/api/reviews/submit'))).toEqual([]);
  }, 60_000);

  it('cancels the previous restaurant\'s pending Google redirect', async () => {
    const screen = await openScreen();
    await seedSession(screen.page, CACHED_SLUG);
    await renderScreen(screen.page, CACHED_SLUG, 'Restaurante A');
    await waitForScreenText(screen.page, CHOICE_GOOGLE);

    await screen.page.getByRole('button', { name: CHOICE_GOOGLE }).click();
    // Armed: the measured redirect is 800 ms, and the guest's choice is recorded.
    await waitForScreenText(screen.page, REDIRECTING);
    expect(
      await screen.page.evaluate(
        () => (window as unknown as Window & { dataLayer: unknown[] }).dataLayer.length,
      ),
    ).toBe(1);

    await renderScreen(screen.page, FRESH_SLUG, 'Restaurante B');
    await waitForScreenText(screen.page, t.starRating.tapToRate);
    await screen.page.waitForTimeout(1_200); // well past the 800 ms timer

    const text = await screen.page.locator('#root').innerText();
    expect(screen.page.url()).not.toContain('previous-restaurant-google');
    expect(says(text, REDIRECTING)).toBe(false);
    expect(says(text, t.starRating.tapToRate)).toBe(true);
  }, 60_000);

  it('cannot repaint the new restaurant with a submit answered after the change', async () => {
    const screen = await openScreen({ submitDelayMs: 400 });
    // Nothing cached for this slug: the guest starts on the stars, so the tap
    // below is the only POST and its answer is the one that could leak.
    await renderScreen(screen.page, CACHED_SLUG, 'Restaurante A');
    await waitForScreenText(screen.page, t.starRating.tapToRate);

    await screen.page.getByRole('button', { name: t.starRating.rateStars(5) }).click();
    const inFlight = await waitForScreenText(screen.page, t.starRating.submittingRating);
    expect(says(inFlight, CHOICE_GOOGLE)).toBe(false);

    await renderScreen(screen.page, FRESH_SLUG, 'Restaurante B');
    await waitForScreenText(screen.page, t.starRating.tapToRate);
    await screen.page.waitForTimeout(1_200); // the delayed answer has landed by now
    const settled = await screen.page.locator('#root').innerText();

    expect(await screen.page.locator('h1').first().innerText()).toBe('Restaurante B');
    expect(says(settled, t.starRating.tapToRate)).toBe(true);
    expect(says(settled, CHOICE_GOOGLE)).toBe(false);
    expect(says(settled, CHOICE_FEEDBACK)).toBe(false);
    expect(says(settled, t.starRating.somethingWrong)).toBe(false);
  }, 60_000);
});
