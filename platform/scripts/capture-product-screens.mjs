#!/usr/bin/env node
/**
 * Captures the 11 product images in assets/product/ (US-11 asset contract) from
 * the demo platform seeded by scripts/seed-demo.ts. See docs/demo-screenshots.md.
 *
 * Run with the demo env file loaded and the TypeScript loader (email renders
 * import src/lib/*.ts):
 *   node --env-file=.env.demo.local --import tsx scripts/capture-product-screens.mjs
 *
 * Safety: refuses a non-local BASE_URL, never reads .env.local, sends no mail
 * (nodemailer is intercepted and the captured HTML is written to disk only).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const platformDir = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3051';
const ASSET_DIR = path.resolve(platformDir, '..', 'assets', 'product');
// Evidence (raw PNGs, rendered HTML, contact sheet) stays out of the repo unless a dir is given.
const EVIDENCE_DIR = process.env.DEMO_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'ratetap-demo-capture');
const GM_SLUG = 'casa-demo-polanco';
const OWNER_SLUG = 'casa-demo-grupo';
const MAX_BYTES = 250 * 1024;

const DESKTOP = { width: 1440, height: 900, exportWidth: 1600 };
const MOBILE = { width: 390, height: 844, dpr: 2, exportWidth: 780 };

function assertLocal() {
  const host = new URL(BASE_URL).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`refusing non-local BASE_URL host "${host}"`);
  if (!process.env.DEMO_SEED_PASSWORD) throw new Error('DEMO_SEED_PASSWORD is not set');
}

/** Export a PNG buffer to webp at the contract width, lowering quality until under 250 KB. */
async function exportWebp(png, width, outFile) {
  for (const quality of [82, 74, 66, 58]) {
    const buf = await sharp(png).resize({ width }).webp({ quality, effort: 5 }).toBuffer();
    if (buf.length <= MAX_BYTES || quality === 58) {
      await writeFile(outFile, buf);
      const meta = await sharp(buf).metadata();
      return { file: path.basename(outFile), width: meta.width, height: meta.height, bytes: buf.length, quality };
    }
  }
}

async function login(browser, slug, role, password) {
  const context = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: DESKTOP.exportWidth / DESKTOP.width });
  // Mark the first-run onboarding wizard as done for this slug and role, so it never covers the screen.
  const onboardingKey = `ratetap_onboarding_${slug}_${role}`;
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {}
  }, onboardingKey);
  // Log in through the same API the /login form posts to. The form's restaurant
  // dropdown never populates in headless Chromium, and the API sets the session
  // cookie on this context's jar.
  const res = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { slug, password },
    headers: { origin: BASE_URL },
    timeout: 180_000,
  });
  if (!res.ok()) throw new Error(`login failed for ${slug}: HTTP ${res.status()}`);
  return context;
}

async function gotoSettled(page, pathname) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForTimeout(800);
}

/** Fails the shot if the onboarding wizard or any modal is on screen. */
async function assertNoOverlay(page, name) {
  const state = await page.evaluate(() => ({
    text: document.body.innerText,
    modal: Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]')),
  }));
  if (state.modal || state.text.includes('Bienvenido')) throw new Error(`${name}: onboarding modal or dialog is on screen`);
}

/** Desktop: 1440x900 viewport, cropped to the main content height, exported at 1600px. */
async function captureDesktop(context, pathname, name) {
  const page = await context.newPage();
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await gotoSettled(page, pathname);
  await page.waitForSelector('main', { state: 'visible', timeout: 60_000 });
  await assertNoOverlay(page, name);
  const bottom = await page.evaluate(() => {
    const el = document.querySelector('main') ?? document.body;
    return Math.ceil(el.getBoundingClientRect().bottom);
  });
  const height = Math.max(400, Math.min(DESKTOP.height, bottom));
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: DESKTOP.width, height } });
  await page.close();
  return png;
}

/** Mobile: 390x844 at 2x, exported at 780px. */
async function captureMobile(browser, pathname, name, prepare) {
  const context = await browser.newContext({ viewport: { width: MOBILE.width, height: MOBILE.height }, deviceScaleFactor: MOBILE.dpr, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // Keep the capture offline: any external link (e.g. a Google review URL) is answered locally.
  await page.route((u) => !u.href.startsWith(BASE_URL) && !u.href.startsWith('data:'), (route) => route.fulfill({ status: 204, body: '' }));
  await gotoSettled(page, pathname);
  await assertNoOverlay(page, name);
  if (prepare) await prepare(page);
  const png = await page.screenshot({ type: 'png' });
  await context.close();
  return png;
}

/** Render the owner briefing and chef report HTML from demo data; nothing is sent. */
async function renderEmails() {
  process.env.SMTP_USER = process.env.SMTP_USER || 'demo-capture';
  process.env.SMTP_PASS = process.env.SMTP_PASS || 'demo-capture';
  const nodemailer = require('nodemailer');
  const captured = [];
  nodemailer.createTransport = () => ({
    sendMail: async (opts) => {
      captured.push(opts);
      return { messageId: 'demo-capture' };
    },
    verify: async () => true,
  });

  const weekly = await import('../src/lib/weekly-signal.ts');
  const signalLabels = await import('../src/lib/location-signal.ts');
  const trends = await import('../src/lib/google-places.ts');
  const email = await import('../src/lib/email.ts');

  const weekStart = weekly.lastCompleteWeekStart();
  const signals = await weekly.getWeeklySignals(weekStart);
  const guestStats = await weekly.getGuestSignals(weekStart);
  const serviceStats = await weekly.getServiceSignals(weekStart);
  const trendMap = await trends.getGoogleRatingTrendBatch(signals.map((s) => s.restaurantId));
  const locations = signals.map((s) => {
    const g = guestStats.get(s.restaurantId);
    const service = serviceStats.get(s.restaurantId);
    const t = trendMap[s.restaurantId] ?? null;
    return {
      name: s.name,
      totalGuests: g?.totalGuests ?? 0,
      newGuestsThisWeek: g?.newThisWeek ?? 0,
      returningGuests: g?.returningGuests ?? 0,
      courtesiesThisWeek: g?.courtesiesThisWeek ?? 0,
      scansThisWeek: s.scansThisWeek,
      scansLastWeek: s.scansLastWeek,
      staffAskingThisWeek: s.staffAskingThisWeek,
      staffAskingLastWeek: s.staffAskingLastWeek,
      gmActiveDays: s.gmActiveDays,
      complaintsThisWeek: service?.complaintsThisWeek ?? 0,
      overdueComplaints: service?.overdueOpen ?? 0,
      currentRating: t?.currentRating ?? null,
      baselineRating: t?.baselineRating ?? null,
      signalSummary: s.signal.summary,
      signalLabel: signalLabels.signalLabel(s.signal.signal),
      actionable: s.signal.actionable,
    };
  });
  await email.sendOwnerBriefing({ to: 'demo@example.com', weekStart, locations, dashboardUrl: `${BASE_URL}/overview` });

  const owner = captured.at(-1);
  if (!owner?.html) throw new Error('owner briefing did not render HTML');
  // email.ts hard-codes the real group name in the header. Show the demo brand instead, before anything is written.
  const ownerHtml = owner.html.replaceAll('Grupo Estancia', 'Casa Demo');
  await writeFile(path.join(EVIDENCE_DIR, 'owner-briefing-email.html'), ownerHtml);
  return { ownerHtml };
}

async function screenshotHtml(browser, html, width, dpr) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  // Email HTML is self-contained; block every network request so the render stays offline.
  await page.route('**/*', (route) => (route.request().url().startsWith('about:') ? route.continue() : route.fulfill({ status: 204, body: '' })));
  await page.setContent(html, { waitUntil: 'load' });
  const png = await page.screenshot({ type: 'png', fullPage: true });
  await context.close();
  return png;
}

async function contactSheet(files) {
  const thumbW = 300;
  const cols = 4;
  const thumbs = [];
  for (const f of files) {
    const img = await sharp(path.join(ASSET_DIR, f)).resize({ width: thumbW }).png().toBuffer();
    const meta = await sharp(img).metadata();
    thumbs.push({ name: f, img, h: meta.height });
  }
  const rowH = Math.max(...thumbs.map((t) => t.h)) + 36;
  const rows = Math.ceil(thumbs.length / cols);
  const canvasW = cols * (thumbW + 16) + 16;
  const canvasH = rows * rowH + 16;
  const composites = [];
  for (const [i, t] of thumbs.entries()) {
    const x = 16 + (i % cols) * (thumbW + 16);
    const y = 16 + Math.floor(i / cols) * rowH;
    composites.push({ input: t.img, left: x, top: y });
    const label = Buffer.from(`<svg width="${thumbW}" height="30"><text x="0" y="20" font-family="Helvetica" font-size="16" fill="#111">${t.name}</text></svg>`);
    composites.push({ input: label, left: x, top: y + t.h + 4 });
  }
  const out = path.join(EVIDENCE_DIR, 'contact-sheet.png');
  await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: '#ffffff' } }).composite(composites).png().toFile(out);
  return out;
}

async function main() {
  assertLocal();
  const password = process.env.DEMO_SEED_PASSWORD;
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];
  const save = async (name, png, width) => {
    await writeFile(path.join(EVIDENCE_DIR, `${name}.raw.png`), png);
    results.push(await exportWebp(png, width, path.join(ASSET_DIR, `${name}.webp`)));
  };

  try {
    const gm = await login(browser, GM_SLUG, 'gm', password);
    const owner = await login(browser, OWNER_SLUG, 'owner', password);

    const desktop = [
      ['dashboard', gm, '/dashboard'],
      ['live', gm, '/live'],
      ['inbox', gm, '/inbox'],
      ['overview', owner, '/overview'],
      ['staff', gm, '/staff'],
      ['guests', gm, '/guests'],
      ['campaigns', gm, '/campaigns'],
      ['leads', gm, '/leads'],
    ];
    for (const [name, ctx, pathname] of desktop) {
      await save(name, await captureDesktop(ctx, pathname, name), DESKTOP.exportWidth);
    }

    await save('guest-rate-mobile', await captureMobile(browser, `/r/${GM_SLUG}?card=101`, 'guest-rate-mobile'), MOBILE.exportWidth);
    await save(
      'guest-choice-mobile',
      await captureMobile(browser, `/r/${GM_SLUG}?card=101`, 'guest-choice-mobile', async (page) => {
        await page.locator('button[aria-label*="5"], [role="radio"][aria-label*="5"]').first().click();
        await page.waitForTimeout(1200);
      }),
      MOBILE.exportWidth,
    );

    const { ownerHtml } = await renderEmails();
    await save('owner-briefing-email', await screenshotHtml(browser, ownerHtml, 800, 2), 1600);
  } finally {
    await browser.close();
  }

  const sheet = await contactSheet(results.map((r) => r.file));
  console.log(JSON.stringify({ assets: results, contactSheet: sheet }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
