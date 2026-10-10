#!/usr/bin/env node
// Marketing-site preview: screenshots a fixed page list and fails on layout/asset regressions.
//
//   node scripts/screenshot-pages.mjs --base http://localhost:8080 --out <dir>
//
// For each page it takes, at 1440x900 and 390x844, an above-the-fold shot and a full-page shot
// (with every .reveal forced visible). It exits 1 if, at 390 wide, a page scrolls horizontally,
// or if any same-origin request (page or asset) answers 404 or fails.
//
// Playwright is loaded with a dynamic import so a missing install gives a clear message.
// Resolution order: normal import, then $PLAYWRIGHT_DIR/node_modules (a prefix you installed it
// into, e.g. `npm install --prefix "$PLAYWRIGHT_DIR" playwright@1`). Browsers must be installed
// (`playwright install chromium`).
//
// Clean URLs: GitHub Pages serves /privacy for privacy.html. Plain static servers do not, so a
// page path that 404s without an extension is retried as <path>.html.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGES = [
  '/',
  '/es/',
  '/nfc-google-review-cards-for-restaurants',
  '/es/tarjetas-nfc-restaurantes-mexico',
  '/for-bars',
  '/blog/',
  '/privacy',
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const base = (argOf('--base') ?? 'http://localhost:8080').replace(/\/$/, '');
const outDir = argOf('--out') ?? 'site-preview';
const baseOrigin = new URL(base).origin;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch { /* fall through */ }
  const dir = process.env.PLAYWRIGHT_DIR;
  if (dir) {
    try {
      const resolved = createRequire(join(dir, 'noop.js')).resolve('playwright');
      return await import(pathToFileURL(resolved).href);
    } catch { /* fall through */ }
  }
  console.error(
    'Playwright is not installed. Install it outside the repo and point at it:\n' +
    '  npm install --prefix /tmp/pw playwright@1 && /tmp/pw/node_modules/.bin/playwright install chromium\n' +
    '  PLAYWRIGHT_DIR=/tmp/pw node scripts/screenshot-pages.mjs --base http://localhost:8080 --out out',
  );
  process.exit(2);
}

const slug = (path) => (path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/\//g, '_'));

/** Returns the URL path that actually serves the page (GitHub Pages clean-URL fallback). */
async function resolvePath(path) {
  const res = await fetch(base + path).catch(() => null);
  if (res && res.status !== 404) return path;
  if (!path.endsWith('/')) {
    const alt = await fetch(`${base}${path}.html`).catch(() => null);
    if (alt && alt.ok) return `${path}.html`;
  }
  return path; // let the run record the 404
}

const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium; // CommonJS package: named exports may sit on .default
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const problems = [];
let shots = 0;

for (const path of PAGES) {
  const servedPath = await resolvePath(path);
  for (const vp of VIEWPORTS) {
    const label = `${path} @${vp.width}`;
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.origin === baseOrigin && res.status() >= 400) {
        problems.push(`${label}: HTTP ${res.status()} ${url.pathname}`);
      }
    });
    page.on('requestfailed', (req) => {
      const url = new URL(req.url());
      if (url.origin === baseOrigin) problems.push(`${label}: request failed ${url.pathname}`);
    });

    try {
      await page.goto(base + servedPath, { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      // Force scroll-reveal content visible so full-page shots show everything.
      await page.addStyleTag({
        content: '.reveal{opacity:1!important;transform:none!important;visibility:visible!important;transition:none!important}',
      });
      await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('revealed')));
      await page.waitForTimeout(300);

      const name = `${slug(path)}-${vp.name}`;
      await page.screenshot({ path: join(outDir, `${name}-fold.png`) });
      await page.screenshot({ path: join(outDir, `${name}-full.png`), fullPage: true });
      shots += 2;

      if (vp.width === 390) {
        const overflow = await page.evaluate(() => {
          const el = document.documentElement;
          return { scroll: el.scrollWidth, client: el.clientWidth };
        });
        if (overflow.scroll > overflow.client) {
          problems.push(`${label}: horizontal scroll (scrollWidth ${overflow.scroll} > ${overflow.client})`);
        }
      }
    } catch (err) {
      problems.push(`${label}: ${err.message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();

const unique = [...new Set(problems)];
console.log(`${shots} screenshots written to ${outDir}`);
if (unique.length) {
  console.error(`\n${unique.length} problem(s):`);
  for (const p of unique) console.error(`  FAIL ${p}`);
  process.exit(1);
}
console.log('preview: OK (no 404s, no horizontal scroll at 390)');
