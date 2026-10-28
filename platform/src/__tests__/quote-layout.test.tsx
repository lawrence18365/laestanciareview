import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { webkit, type Browser, type Page } from 'playwright';
import { findVisibleTextClashes } from '../../scripts/qa-quotes-layout.mjs';

// Real client components and styles, synthetic state, no HTTP server or APIs.
// Real Tailwind is compiled by PostCSS. Playfair 600 uses a licensed local test
// font; Inter and Manrope use explicit system fallbacks. Network is blocked.
declare global {
  interface Window {
    __quoteLayout: { render: (surface: string, saved?: boolean, mode?: string, holidaySaved?: boolean) => void };
    __quoteSaveRequests: Array<{ url: string; method?: string; configJson: { indiv: { postres: string[] } } }>;
  }
}

let browser: Browser;
let bundle: string;
let sharedCSS: string;
const playfair = readFileSync(path.resolve('src/__tests__/quote-playfair-display-latin.woff2')).toString('base64');
const fixtureFonts = `@font-face { font-family: 'Playfair Display'; font-style: normal; font-weight: 600; font-display: block; src: url(data:font/woff2;base64,${playfair}) format('woff2'); }`;
const brandAssetURL = '/brand/3d/ratetap-star-signal.webp';
const brandAsset = readFileSync(path.resolve('public/brand/3d/ratetap-star-signal.webp'));

beforeAll(async () => {
  const from = path.resolve('src/app/globals.css');
  const compiled = await postcss([tailwindcss({ base: process.cwd(), optimize: false })])
    .process(readFileSync(from, 'utf8'), { from });
  sharedCSS = compiled.css;
  // Preserve the real conflicting utilities, including after operator renaming.
  for (const utility of ['h-1', 'h-2', 'h-3']) expect(sharedCSS).toContain(`.${utility} {`);
  const built = await esbuild.build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import Builder from '@/components/quotes/QuoteBuilderV2';
        import Nav from '@/components/dashboard/DashboardNav';
        import List from '@/app/(app)/quotes/QuoteList';
        import { emptyConfig } from '@/lib/quote-data';
        const root = createRoot(document.getElementById('root'));
        window.__quoteLayout = { render: (surface, saved = false, mode = 'individual', holidaySaved = false) => {
          const config = emptyConfig();
          config.evento.cliente = 'Coordinación de Celebraciones y Eventos de Prueba del Bajío';
          config.evento.personas = 80;
          config.modo = mode;
          if (holidaySaved) {
            config.templateId = 'fiestas-menu-1';
            config.indiv = { ...config.indiv, postres: ['po1'], bebidas: 'a-la-carta', precioPP: 950, costoPP: 399 };
          }
          root.render(<>
            <Nav restaurantName="Restaurante de prueba con nombre largo" logoSrc="" logoDarkBg={false} showEventsQuotes isStaff onOpenGuide={() => {}} />
            {surface === 'list' ? <List restaurantName="Restaurante de prueba" conversion={{sent: 4, won: 2, pesosCollected: 10000, open: 2}} quotes={[{
              id: 1, quoteNumber: 'Q-TEST', status: 'draft', clientName: config.evento.cliente,
              clientCompany: 'Empresa de prueba', eventDate: '2026-12-10', eventType: 'Empresarial',
              guestCount: 80, pricePerPerson: '1000', createdAt: '2026-10-01', campaignTag: 'campaign:posadas-2026'
            }]} /> : <Builder key={mode + saved + holidaySaved} initialConfig={config} quoteId={saved ? 1 : undefined} quoteNumber="Q-TEST" isAdmin campaignTagOptions={['campaign:posadas-2026']} />}
          </>);
        }};
      `,
      resolveDir: path.resolve('src'), loader: 'jsx', sourcefile: 'quote-layout-fixture.tsx',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{
      name: 'fixture-navigation',
      setup(build) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const useRouter = () => ({push(){},replace(){},refresh(){}}); export const usePathname = () => "/quotes";',
          loader: 'js',
        }));
      },
    }],
  });
  bundle = built.outputFiles[0].text;
  browser = await webkit.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

async function fixture(width: number, height: number, surface = 'builder', saved = false, mode = 'individual', holidaySaved = false) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  await page.route('**/*', (route) => {
    if (route.request().url() === 'http://quote-layout.test/') {
      return route.fulfill({ contentType: 'text/html', body: `<style>${sharedCSS}\n${fixtureFonts}\nhtml,body{margin:0} nav img{width:96px}</style><div id="root"></div>` });
    }
    if (route.request().url() === `http://quote-layout.test${brandAssetURL}`) {
      return route.fulfill({ contentType: 'image/webp', body: brandAsset });
    }
    return route.abort();
  });
  await page.goto('http://quote-layout.test/');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle });
  if (errors.length) throw new Error(errors.join('\n'));
  await page.evaluate(([view, existing, kind, holiday]) => window.__quoteLayout.render(String(view), Boolean(existing), String(kind), Boolean(holiday)), [surface, saved, mode, holidaySaved]);
  await page.locator(surface === 'list' ? '.ql-root' : '.cb-header').waitFor();
  expect(await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 24px "Playfair Display"');
  })).toBe(true);
  return page;
}

async function rect(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}

describe('quote layout in WebKit', () => {
  for (const [width, height] of [[390, 844], [810, 1080], [1080, 810]]) {
    it(`loads the approved decoration only in templates without overflow at ${width}x${height}`, async () => {
      const page = await fixture(width, height);
      try {
        const image = page.locator(`img[src="${brandAssetURL}"]`);
        expect(await image.count()).toBe(1);
        const imageMetrics = await image.evaluate(async (el: HTMLImageElement) => {
          await el.decode();
          const css = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            loaded: el.complete && el.naturalWidth === 1024 && el.naturalHeight === 1024,
            alt: el.getAttribute('alt'), width: el.getAttribute('width'), height: el.getAttribute('height'),
            ariaHidden: el.parentElement!.getAttribute('aria-hidden'),
            pointerEvents: css.pointerEvents, animation: css.animationName,
            transition: css.transitionDuration, transform: css.transform,
            size: box.width, left: box.left, right: box.right,
          };
        });
        expect(imageMetrics).toMatchObject({
          loaded: true, alt: '', width: '1024', height: '1024', ariaHidden: 'true',
          pointerEvents: 'none', animation: 'none', transition: '0s', transform: 'none',
          size: width <= 640 ? 88 : 128,
        });
        expect(imageMetrics.left).toBeGreaterThanOrEqual(0);
        expect(imageMetrics.right).toBeLessThanOrEqual(width);
        expect(await page.locator('.cb-header img[src="' + brandAssetURL + '"]').count()).toBe(0);
        const copy = await rect(page, '.template-intro-copy');
        const artwork = await rect(page, '.ratetap-stamp');
        expect(artwork.x - copy.right).toBeGreaterThanOrEqual(width <= 640 ? 16 : 24);
        const title = await rect(page, '.holiday-group .template-group-title');
        const helper = await rect(page, '.holiday-group .group-note');
        expect(helper.y - title.bottom).toBeGreaterThanOrEqual(12);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(await findVisibleTextClashes(page, '.template-intro')).toEqual([]);

        for (const tab of ['Constructor', 'Carta', 'Vista cliente']) {
          await page.locator('.cb-tabs .tab').filter({ hasText: new RegExp(`^${tab}$`) }).click();
          expect(await image.count()).toBe(0);
          expect(await page.locator('.quote-doc img[src="' + brandAssetURL + '"]').count()).toBe(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }

        if (width === 1080 && process.env.QUOTE_LAYOUT_SCREENSHOT) {
          await page.locator('.cb-tabs .tab').filter({ hasText: /^Plantillas$/ }).click();
          await image.evaluate((el: HTMLImageElement) => el.decode());
          await page.evaluate(() => {
            const intro = document.querySelector('.template-intro')!.getBoundingClientRect();
            const navHeight = document.querySelector('nav')!.getBoundingClientRect().height;
            window.scrollTo(0, window.scrollY + intro.top - navHeight - 24);
          });
          const capture = path.resolve(process.env.QUOTE_LAYOUT_SCREENSHOT);
          mkdirSync(path.dirname(capture), { recursive: true });
          await page.screenshot({ path: capture, animations: 'disabled' });
          writeFileSync(`${capture}.json`, JSON.stringify({ viewport: { width, height }, imageMetrics,
            intro: await rect(page, '.template-intro'), artwork: await rect(page, '.ratetap-stamp'),
            horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
          }, null, 2) + '\n');
        }
      } finally { await page.close(); }
    });
  }

  it('limits the emblem entrance to transform and opacity and makes reduced motion static', async () => {
    const page = await fixture(1080, 810);
    try {
      const image = page.locator(`img[src="${brandAssetURL}"]`);
      await image.evaluate((el: HTMLImageElement) => el.decode());
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const motion = await image.evaluate((el) => {
        const css = getComputedStyle(el);
        const keyframes = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules))
          .find((rule): rule is CSSKeyframesRule => rule instanceof CSSKeyframesRule && rule.name === css.animationName);
        return { name: css.animationName, duration: parseFloat(css.animationDuration), iterations: css.animationIterationCount,
          properties: keyframes ? Array.from(keyframes.cssRules).flatMap((rule) => Array.from((rule as CSSKeyframeRule).style)) : [] };
      });
      expect(motion.name).toBe('ratetap-emblem-enter');
      expect(motion.duration).toBeGreaterThan(0);
      expect(motion.duration).toBeLessThanOrEqual(0.4);
      expect(motion.iterations).toBe('1');
      expect(new Set(motion.properties)).toEqual(new Set(['opacity', 'transform']));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await image.evaluate((el) => {
        const css = getComputedStyle(el);
        return { animation: css.animationName, transition: css.transitionDuration, transform: css.transform };
      })).toEqual({ animation: 'none', transition: '0s', transform: 'none' });
    } finally { await page.close(); }
  });

  for (const [width, height] of [[1180, 820], [1080, 810], [810, 1080], [820, 1080], [1279, 820], [1280, 820], [1284, 820]]) {
    it(`wraps header, reserves navigation utilities and contains content at ${width}x${height}`, async () => {
      const page = await fixture(width, height, 'builder', true);
      try {
        const title = await rect(page, '.cb-header h1');
        const save = await rect(page, '.cb-header .btn-primary');
        const row = await rect(page, '.cb-header-row');
        expect(save.x - title.right).toBeGreaterThanOrEqual(16);
        expect(Math.abs(save.y - title.y)).toBeLessThan(2);
        expect(save.right).toBeCloseTo(row.right, 1);
        expect(await page.locator('.cb-header .ratetap-stamp').count()).toBe(0);
        expect(await page.locator('.cb-header h1').textContent()).toBe('Coordinación de Celebraciones y Eventos de Prueba del Bajío');
        expect(await page.locator('.cb-header h1').evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        expect(await findVisibleTextClashes(page, '.cb-header')).toEqual([]);
        expect(await page.locator('.cb-header').evaluate((el) => getComputedStyle(el).position)).toBe(width <= 1180 ? 'static' : 'sticky');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        const tabs = await page.locator('.cb-tabs .tab').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(tabs.every((n) => n >= 44)).toBe(true);
        // WebKit reserves the app's 4px scrollbar from media-query width.
        // Cover 1280 CSS pixels with the 1284 outer viewport, without hiding it.
        const desktop = await page.evaluate(() => matchMedia('(min-width: 1280px)').matches);
        if (width === 1284) expect(desktop).toBe(true);
        if (desktop) {
          expect(await page.locator('.nav-mobile-toggle').isVisible()).toBe(false);
          const links = await rect(page, 'nav .nav-links');
          const utilities = await rect(page, 'nav .nav-links + .nav-links');
          expect(utilities.x - links.right).toBeGreaterThanOrEqual(12);
          const rail = page.locator('nav .nav-links').first();
          await rail.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
          const last = await rect(page, 'nav .nav-links:first-of-type a:last-child');
          expect(last.right).toBeLessThanOrEqual(utilities.x);
        } else {
          const menu = await rect(page, '.nav-mobile-toggle');
          expect(menu.width).toBeGreaterThanOrEqual(44);
          expect(menu.height).toBeGreaterThanOrEqual(44);
          expect(await page.locator('nav .nav-links').first().isVisible()).toBe(false);
          const expectedLinks = await page.locator('nav .nav-links').first().locator('a').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
          await page.locator('.nav-mobile-toggle').click();
          expect(await page.locator('.nav-mobile-menu').isVisible()).toBe(true);
          expect(await page.locator('.nav-mobile-menu a').evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(expectedLinks);
          for (const link of await page.locator('.nav-mobile-menu a').all()) {
            await link.scrollIntoViewIfNeeded();
            await link.focus();
            const box = await link.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height).toBeLessThanOrEqual(height);
            expect(await link.evaluate((el) => document.activeElement === el)).toBe(true);
          }
          const targets = await page.locator('.nav-mobile-menu a, .nav-mobile-menu button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
          expect(targets.every((n) => n >= 44)).toBe(true);
        }
      } finally { await page.close(); }
    });
  }

  for (const [width, height] of [[1080, 810], [810, 1080]]) {
    it(`keeps native selects, headings and real template text separated at ${width}x${height}`, async () => {
      const page = await fixture(width, height);
      try {
        const fields = await page.locator('.client-fields input, .client-fields select').evaluateAll((els) => els.map((el) => ({
          height: el.getBoundingClientRect().height,
          font: parseFloat(getComputedStyle(el.parentElement!.querySelector('label')!).fontSize),
        })));
        expect(fields.length).toBeGreaterThan(5);
        expect(fields.every((f) => f.height >= 44 && f.font >= 12)).toBe(true);
        const title = await rect(page, '.holiday-group .template-group-title');
        const helper = await rect(page, '.holiday-group .group-note');
        expect(helper.y - title.bottom).toBeGreaterThanOrEqual(12);
        const gaps = await page.locator('.template-card').evaluateAll((cards) => cards.map((card) => {
          const name = card.querySelector('.template-name')!.getBoundingClientRect();
          const price = card.querySelector('.template-price, .other-price')!.getBoundingClientRect();
          const dishes = card.querySelector('.dish-list');
          const body = card.querySelector('.dish-list, .other-description');
          return { title: price.top - name.bottom, dishes: dishes ? dishes.getBoundingClientRect().top - price.bottom : 16,
            bodyLine: parseFloat(getComputedStyle(body!).lineHeight) / parseFloat(getComputedStyle(body!).fontSize) };
        }));
        expect(gaps.every((g) => g.title >= 8 && g.dishes >= 16 && g.bodyLine >= 1.45)).toBe(true);
        await page.locator('.holiday-group').scrollIntoViewIfNeeded();
        expect(await findVisibleTextClashes(page, '.template-card, .holiday-group .template-group-title, .group-note')).toEqual([]);
      } finally { await page.close(); }
    });

    it(`wraps the constructor, stacks summary and clips scroll lists at ${width}x${height}`, async () => {
      const page = await fixture(width, height, 'builder', true);
      try {
        const summary = await rect(page, '.col-summary');
        const builder = await rect(page, '.col-builder');
        expect(summary.y).toBeGreaterThanOrEqual(builder.bottom);
        const headings = await page.locator('.col-builder > .card > h3').first().evaluate((el) => {
          const next = el.nextElementSibling;
          return next!.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
        });
        expect(headings).toBeGreaterThanOrEqual(12);
        const list = page.locator('.scroll-thin').first();
        await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        expect(await list.evaluate((el) => {
          const css = getComputedStyle(el);
          return css.overflowX !== 'visible' && css.overflowY === 'auto';
        })).toBe(true);
        await list.scrollIntoViewIfNeeded();
        expect(await findVisibleTextClashes(page, '.col-builder')).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      } finally { await page.close(); }
    });
  }

  it('lets every constructor introduction determine its own height at 820px', async () => {
    for (const mode of ['individual', 'opciones', 'asado', 'carta']) {
      const page = await fixture(820, 1080, 'builder', true, mode);
      try {
        expect(await page.locator('.operator-chrome :is(.h-1,.h-2,.h-3)').count()).toBe(0);
        const subtitle = await rect(page, '.cb-constructor-subtitle');
        const change = await rect(page, '.cb-constructor-bar button');
        expect(change.y - subtitle.bottom).toBeGreaterThanOrEqual(16);
        expect(change.y - subtitle.bottom).toBeLessThan(48);
        const gap = await page.locator('.col-builder > .card > h3').first().evaluate((el) =>
          el.nextElementSibling!.getBoundingClientRect().top - el.getBoundingClientRect().bottom);
        expect(gap).toBeGreaterThanOrEqual(12);
        const labels = await page.locator('label.item-row, label.toggle-row').evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().height));
        expect(labels.every((height) => height >= 44)).toBe(true);
      } finally { await page.close(); }
    }
  });

  it('keeps a saved holiday dessert visible and removable while limiting new choices to its trio', async () => {
    const page = await fixture(1080, 810, 'builder', true, 'individual', true);
    await page.evaluate(() => {
      window.__quoteSaveRequests = [];
      window.fetch = async (input, init) => {
        const payload = JSON.parse(String(init?.body ?? '{}'));
        window.__quoteSaveRequests.push({ url: String(input), method: init?.method, configJson: payload.configJson });
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    try {
      const cookie = page.locator('label.item-row').filter({ hasText: 'Cookie Skillet con Helado' });
      expect(await cookie.count()).toBe(1);
      expect(await cookie.locator('input').isChecked()).toBe(true);
      const totalBefore = await page.locator('.cb-summary-total').textContent();

      const banoffee = page.locator('label.item-row').filter({ hasText: 'Banoffee' });
      expect(await banoffee.count()).toBe(1);
      await banoffee.locator('input').check();
      expect(await cookie.count()).toBe(1);
      expect(await cookie.locator('input').isChecked()).toBe(true);
      expect(await page.locator('.cb-summary-total').textContent()).toBe(totalBefore);
      await page.locator('.cb-save-btn').click();
      await expect.poll(() => page.evaluate(() => window.__quoteSaveRequests.length)).toBe(1);
      expect(await page.evaluate(() => window.__quoteSaveRequests[0])).toMatchObject({
        url: '/api/quotes/1', method: 'PUT', configJson: { indiv: { postres: ['po1', 'po8'] } },
      });
      await expect.poll(() => page.locator('.cb-save-btn').textContent()).toBe('✓ Guardado');

      await cookie.click();
      expect(await cookie.count()).toBe(0);
      await page.locator('.cb-save-btn').click();
      await expect.poll(() => page.evaluate(() => window.__quoteSaveRequests.length)).toBe(2);
      expect(await page.evaluate(() => window.__quoteSaveRequests[1])).toMatchObject({
        url: '/api/quotes/1', method: 'PUT', configJson: { indiv: { postres: ['po8'] } },
      });

      const dessertSection = page.locator('.cb-heading-sm').filter({ hasText: '3° Tiempo · Postre' }).locator('xpath=../..');
      const visibleDesserts = await dessertSection.locator('label.item-row').evaluateAll((labels) =>
        labels.filter((label) => label.querySelector('input[type="checkbox"]'))
          .map((label) => label.textContent?.trim()),
      );
      expect(visibleDesserts).toEqual([
        'Banoffee',
        'Pasta filo con ate, queso y salsa de dulce de leche',
        'Pastel Estancia (rebanada)',
      ]);
      expect(await page.locator('label.item-row').filter({ hasText: 'Cookie Skillet con Helado' }).count()).toBe(0);
    } finally { await page.close(); }
  });

  it('keeps Vista document inheritance stable and toolbar targets usable', async () => {
    const page = await fixture(810, 1080);
    try {
      const dataList = await page.locator('input[list="campaign-tag-options"]').getAttribute('placeholder');
      expect(dataList).toBe('Posadas 2026');
      await page.locator('.cb-tabs .tab').filter({ hasText: /^Carta$/ }).click();
      expect(await page.locator('.operator-main input, .operator-main button').count()).toBe(0);
      await page.locator('.cb-tabs .tab').filter({ hasText: /^Vista cliente$/ }).click();
      const documentStyle = await page.locator('.quote-doc').evaluate((el) => {
        const css = getComputedStyle(el);
        return { spacing: css.letterSpacing, line: css.lineHeight, fontSize: css.fontSize };
      });
      // Frozen parent inheritance at 100dcaf. Do not reset this in a chrome fix.
      expect(parseFloat(documentStyle.spacing)).toBeCloseTo(-0.011 * parseFloat(documentStyle.fontSize), 2);
      expect(parseFloat(documentStyle.line) / parseFloat(documentStyle.fontSize)).toBe(1.5);
      const targets = await page.locator('main .operator-chrome button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(targets.every((height) => height >= 44)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(811);
    } finally { await page.close(); }
  });

  it('restores the frozen phone Vista Cliente main padding and content width', async () => {
    // WebKit reserves 4px for its scrollbar, so 394px outer yields a 390px CSS viewport.
    const page = await fixture(394, 844);
    try {
      await page.locator('.cb-tabs .tab').filter({ hasText: /^Vista cliente$/ }).click();
      const metrics = await page.locator('main.cb-main').evaluate((el) => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          padding: css.padding,
          width: box.width,
          contentWidth: box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      expect(metrics.padding).toBe('20px 14px');
      expect(metrics.viewportWidth).toBe(390);
      expect(metrics.width).toBe(390);
      expect(metrics.contentWidth).toBe(362);
    } finally { await page.close(); }
  });

  it('renders list metadata, square campaign branding and usable actions without changing the tag', async () => {
    const page = await fixture(810, 1080, 'list');
    try {
      expect(await page.locator('.ql-campaign-select option[value="campaign:posadas-2026"]').count()).toBe(1);
      const primary = await page.locator('.ql-new-btn').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
      const send = await page.locator('.ql-card-actions button').filter({ hasText: /^Enviar$/ }).evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
        border: getComputedStyle(el).borderTopStyle, borderColor: getComputedStyle(el).borderTopColor,
      }));
      expect(primary.bg).toBe('rgb(17, 17, 17)');
      expect(send.bg).not.toBe(primary.bg);
      expect(send.color).toBe(primary.bg);
      expect(send.border).toBe('solid');
      expect(send.borderColor).toBe(primary.bg);
      expect(await page.locator('.ql-total').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(22);
      const targets = await page.locator('.ql-root button, .ql-root select').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(targets.every((height) => height >= 44)).toBe(true);
      const meta = await page.locator('.ql-folio, .ql-status, .ql-campaign-chip, .ql-card-details').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      expect(meta.every((size) => size >= 12)).toBe(true);
      expect(await page.locator('.ql-campaign-chip').evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(811);
    } finally { await page.close(); }
  });

  for (const [width, height] of [[1080, 810], [810, 1080]]) {
    it(`reserves heading line boxes with compiled Tailwind and Playfair at ${width}x${height}`, async () => {
      const page = await fixture(width, height);
      try {
        const cliente = page.locator('.client-section > .section-heading');
        const metrics = await cliente.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const css = getComputedStyle(el);
          const range = document.createRange();
          range.selectNodeContents(el);
          return { height: box.height, line: parseFloat(css.lineHeight), glyph: range.getBoundingClientRect().height };
        });
        expect(metrics.height).toBeGreaterThanOrEqual(metrics.line - 0.1);
        expect(metrics.glyph).toBeGreaterThan(24);
        const clientBox = await rect(page, '.client-section > .section-heading');
        const panel = await rect(page, '.client-fields');
        expect(panel.y - clientBox.bottom).toBeGreaterThanOrEqual(12);
        const titles = await page.locator('.holiday-card .template-name').evaluateAll((els) => els.map((el) => ({
          height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight),
          gap: el.nextElementSibling!.getBoundingClientRect().top - el.getBoundingClientRect().bottom,
        })));
        expect(titles).toHaveLength(4);
        expect(titles.every((t) => t.height >= t.line - 0.1 && t.gap >= 8)).toBe(true);
        expect(await page.locator('.holiday-group > .section-heading').count()).toBe(0);
        for (const tab of ['Plantillas', 'Constructor', 'Carta']) {
          await page.locator('.cb-tabs .tab').filter({ hasText: new RegExp(`^${tab}$`) }).click();
          expect(await page.locator('.operator-chrome :is(.h-1,.h-2,.h-3)').count()).toBe(0);
        }
        await page.locator('.cb-tabs .tab').filter({ hasText: /^Plantillas$/ }).click();
        for (const selector of ['.client-section', '.holiday-group']) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          expect(await findVisibleTextClashes(page, selector)).toEqual([]);
        }
        await page.locator('.cb-tabs .tab').filter({ hasText: /^Vista cliente$/ }).click();
        expect(await page.locator('.quote-doc .h-1').count()).toBeGreaterThan(0);
        expect(await page.locator('.quote-doc .h-3').count()).toBeGreaterThan(0);
      } finally { await page.close(); }
    });
  }

  it('preserves summary and template typography exceptions across responsive sizes', async () => {
    for (const width of [390, 810, 1080]) {
      const page = await fixture(width, 1080, 'builder', true);
      try {
        const total = await page.locator('.cb-summary-total').evaluate((el) => ({
          font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight),
        }));
        expect(total.font).toBe(26);
        expect(total.line / total.font).toBeCloseTo(1.15, 2);
        await page.locator('.cb-tabs .tab').filter({ hasText: /^Plantillas$/ }).click();
        const title = await page.locator('.template-name').first().evaluate((el) => ({
          font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight),
        }));
        expect(title.font).toBe(16);
        expect(title.line).toBe(20);
      } finally { await page.close(); }
    }
  });

  it('aligns client fields on shared responsive tracks without truncating the campaign', async () => {
    for (const [width, height] of [[1180, 820], [1080, 810], [810, 1080], [390, 844]]) {
      const page = await fixture(width, height);
      try {
        const form = await page.locator('.client-fields').evaluate((el) => {
          const box = el.getBoundingClientRect(), css = getComputedStyle(el);
          const columns = css.gridTemplateColumns.split(' ').map(parseFloat);
          const gap = parseFloat(css.columnGap);
          let x = box.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
          const starts = columns.map((column) => { const start = x; x += column + gap; return start; });
          return { display: css.display, columns: columns.length, gap, rowGap: parseFloat(css.rowGap), starts };
        });
        expect(form.display).toBe('grid');
        expect(form.columns).toBe(width > 900 ? 12 : width > 640 ? 6 : 2);
        expect(form.gap).toBeGreaterThanOrEqual(12);
        expect(form.gap).toBeLessThanOrEqual(16);
        expect(form.rowGap).toBeGreaterThanOrEqual(12);
        const fields = await page.locator('.client-fields .field-wrap').evaluateAll((els) => els.map((el) => {
          const box = el.getBoundingClientRect();
          const label = el.querySelector('label')!, input = el.querySelector('input,select')!;
          return { label: label.textContent, x: box.x, y: box.y, width: box.width,
            labelGap: input.getBoundingClientRect().top - label.getBoundingClientRect().bottom };
        }));
        expect(fields.map((f) => f.label)).toEqual(['Cliente', 'Teléfono', 'Personas', 'Fecha', 'Hora', 'Tipo', 'Presupuesto/pp', 'Prioridad', 'Campaña']);
        expect(fields.every((f) => form.starts.some((start) => Math.abs(start - f.x) < 0.1))).toBe(true);
        expect(fields.every((f) => Math.abs(f.labelGap - 8) < 0.1)).toBe(true);
        expect(fields[0].width).toBeGreaterThan(fields[2].width);
        expect(fields[0].width).toBeGreaterThan(fields[4].width);
        expect(fields[8].width).toBeGreaterThan(fields[2].width);
        for (let i = 1; i < fields.length; i++) {
          expect(fields[i].y > fields[i - 1].y || (fields[i].y === fields[i - 1].y && fields[i].x > fields[i - 1].x)).toBe(true);
        }
        if (width === 810) expect(fields[3].y).toBe(fields[4].y);
        const campaign = page.locator('input[list="campaign-tag-options"]');
        expect(await campaign.getAttribute('placeholder')).toBe('Posadas 2026');
        await campaign.fill('campaign:posadas-2026');
        expect(await campaign.inputValue()).toBe('campaign:posadas-2026');
        expect(await page.locator('#campaign-tag-options option').evaluateAll((els) => els.map((el) => el.getAttribute('value')))).toEqual(['campaign:posadas-2026']);
        expect(await campaign.evaluate((el) => {
          const input = el as HTMLInputElement, css = getComputedStyle(input);
          const context = document.createElement('canvas').getContext('2d')!;
          context.font = css.font;
          const width = input.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
          return width >= Math.max(context.measureText(input.value).width, context.measureText(input.placeholder).width);
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      } finally { await page.close(); }
    }
  });

  it('audits both visible clipped text ranges and ignores opaque sticky occlusion', async () => {
    const page = await browser.newPage({ viewport: { width: 810, height: 600 } });
    try {
      await page.setContent(`<style>body{margin:0} .cover{position:fixed;top:0;background:white;width:100%;height:80px;z-index:10} .row{position:absolute;top:100px} .overlap{left:30px} .clip{position:absolute;top:200px;height:20px;overflow:hidden}</style><div class="operator-chrome"><div style="position:absolute;top:0">Occluded content</div><div class="cover">Sticky surface</div><span class="row">First visible sentence</span><span class="row overlap">Second visible sentence</span><div class="clip"><div style="margin-top:24px">Clipped text</div></div></div>`);
      const clashes = await findVisibleTextClashes(page);
      expect(clashes.some((c) => c.a.includes('visible') && c.b.includes('visible'))).toBe(true);
      expect(clashes.some((c) => /Occluded|Clipped/.test(c.a + c.b))).toBe(false);
    } finally { await page.close(); }
  });
});
