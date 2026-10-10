#!/usr/bin/env node
// RateTap design-system checker (Node stdlib only, regex/HTML-lite parsing).
//
// Usage:
//   node scripts/check-design-system.mjs                    all root + es/ pages, prints a table, exit 0
//   node scripts/check-design-system.mjs --strict a.html    exit 1 if any listed page has an undefined
//                                                           CSS var, an undefined class or a style="" attribute
//   node scripts/check-design-system.mjs --strict-migrated  same as --strict on MIGRATED_PAGES (list near the top);
//                                                           the table still covers every page (CI uses this)
//   node scripts/check-design-system.mjs -v              also list the offending names
//   node scripts/check-design-system.mjs --json             machine-readable report
//   node scripts/check-design-system.mjs --strict a.html --budget b.html
//                                                           flags are independent: each consumes the file
//                                                           args after it until the next flag
//   node scripts/check-design-system.mjs --budget a.html    exit 1 if a page breaks a word budget (below)
//   node scripts/check-design-system.mjs --self-test        run the budget rules on inline fixtures, exit 0
//
// Word budgets (--budget), counted on visible body text with <nav>, <footer>, <script>, <style>,
// <noscript>, <svg>, JSON-LD and the <!-- chrome:header --> / <!-- chrome:footer --> regions removed:
//   total <= 550 words | hero <= 30 | each <h2> <= 8 | each .faq-answer <= 40
//   hero = first element with class hero / hero--photo or a data-photo-hero attribute, else first <section>.
//
// Columns: undefined CSS vars | undefined classes | style="" attributes | visible words.
// "Visible words" excludes <head>, scripts, styles, nav and footer. It is measured, never enforced.
//
// A class counts as defined when it appears in a selector of any stylesheet the page links
// (local .css files) or in the page's own <style> blocks. JS hook classes and Font Awesome
// classes are allowlisted below. Meta-refresh redirect stubs are skipped.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Pages already migrated to the design system. CI runs `--strict-migrated`, which applies --strict to
// exactly this list. The US-9 migration tickets append their page here, in this one place.
const MIGRATED_PAGES = [
  'design-system.html',
  'nfc-google-review-cards-for-restaurants.html',
  'es/tarjetas-nfc-restaurantes-mexico.html',
  'for-bars.html',
  'for-cafes.html',
  'for-fine-dining.html',
  'for-gms.html',
  'for-multi-location.html',
  'for-owners.html',
  'es/for-bars.html',
  'es/for-cafes.html',
  'es/for-fine-dining.html',
  'es/for-gms.html',
  'es/for-multi-location.html',
  'es/for-owners.html',
  'get-more-google-reviews-restaurants.html',
  'restaurant-review-management-software.html',
  'ratetap-vs-ovation.html',
  'vs-comment-cards.html',
  'why-stuck-at-4-stars.html',
  'stop-bad-restaurant-reviews.html',
  'track-waiter-performance-dashboard.html',
  'reputation-recovery.html',
  'new-restaurant.html',
  'es/get-more-google-reviews-restaurants.html',
  'es/ratetap-vs-ovation.html',
  'es/vs-comment-cards.html',
  'es/why-stuck-at-4-stars.html',
  'es/reputation-recovery.html',
  'es/new-restaurant.html',
  'es/evitar-malas-resenas-restaurante.html',
  'es/medir-desempeno-meseros.html',
  'es/mejorar-calificacion-google-restaurante.html',
  'es/software-gestion-resenas-restaurantes.html',
  'case-studies.html',
  'methodology.html',
  'roi-calculator.html',
  'demo.html',
  'contacto.html',
  'pago.html',
  'privacy.html',
  'terms.html',
  'cookies.html',
  'es/case-studies.html',
  'es/demo.html',
  'es/roi-calculator.html',
  'blog/index.html',
  'blog/nfc-vs-qr-vs-comment-cards-restaurant-reviews.html',
  'blog/ovation-reviews-alternatives.html',
  'blog/restaurant-google-rating-dropped.html',
  'blog/restaurant-not-getting-google-reviews.html',
  'blog/restaurant-reputation-metrics-kpis.html',
  'blog/restaurant-reputation-playbook.html',
  'blog/restaurant-table-google-review-qr-codes.html',
  'blog/roi-of-google-reviews-calculator.html',
  'blog/stop-bad-google-reviews-before-they-post.html',
  'blog/track-server-review-performance.html',
  'es/blog/calculadora-roi-resenas-google.html',
  'es/blog/como-poner-qr-resenas-google-mesas-restaurante.html',
  'es/blog/detener-malas-resenas-google-antes-publiquen.html',
  'es/blog/index.html',
  'es/blog/medir-desempeno-meseros-resenas.html',
  'es/blog/metricas-en-restauracion.html',
  'es/blog/nfc-vs-qr-vs-tarjetas-comentario-resenas-restaurante.html',
  'es/blog/playbook-reputacion-restaurante.html',
  'es/blog/resenas-ovation-alternativas.html',
  'es/blog/restaurante-bajo-calificacion-google.html',
  'es/blog/restaurante-no-recibe-resenas-google.html',
  'index.html',
  'es/index.html',
  'product.html',
  'es/producto.html',
];

// Classes toggled or injected by script.js (grep classList / className) plus FA families.
const JS_HOOK_CLASSES = new Set([
  'reveal', 'revealed', 'reveal-enabled', 'active', 'visible', 'open', 'nav-open', 'menu-open',
  'nav-hidden', 'lead-form-simplified', 'has-mobile-sticky-cta', 'mobile-sticky-cta',
  'mobile-sticky-cta-btn', 'language-suggestion-banner', 'optional-form-details',
  'faq-toggle', 'faq-question', 'lang-btn', 'nav-toggle',
  'hero-proof-row', // marker that stops insertTrustStrip() from injecting a strip
]);
const isAllowedClass = (c) => JS_HOOK_CLASSES.has(c) || /^fa(-|$)/.test(c) || /^fa[srbldt]$/.test(c);

// ---------- args ----------
const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const asJson = args.includes('--json');
const selfTest = args.includes('--self-test');
// --strict / --budget each take the file args that follow them, up to the next flag.
const flagFiles = { '--strict': null, '--budget': null }; // null = flag absent
const bareFiles = [];
let currentFlag = null;
for (const a of args) {
  if (a.startsWith('-')) {
    currentFlag = a in flagFiles ? a : null;
    if (currentFlag && !flagFiles[currentFlag]) flagFiles[currentFlag] = [];
  } else if (currentFlag) flagFiles[currentFlag].push(a);
  else bareFiles.push(a);
}
// --strict-migrated adds MIGRATED_PAGES to the strict set. With no other file args the table still covers
// every page; with file args, the migrated pages are added so they get analysed too.
const strictMigrated = args.includes('--strict-migrated');
const strictOwn = flagFiles['--strict'] ?? [];
const budget = flagFiles['--budget'] !== null;
const explicitFiles = [...bareFiles, ...strictOwn, ...(flagFiles['--budget'] ?? [])];
const fileArgs = explicitFiles.length ? [...new Set([...explicitFiles, ...(strictMigrated ? MIGRATED_PAGES : [])])] : [];
if (strictMigrated) flagFiles['--strict'] = [...strictOwn, ...MIGRATED_PAGES];
const strict = flagFiles['--strict'] !== null;

// ---------- CSS parsing ----------
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Walk CSS, returning selector preludes (not at-rules) and the full text. */
function selectorPreludes(css) {
  const out = [];
  let cur = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; }
      continue;
    }
    if (ch === '(' && /url$/i.test(cur.trimEnd()) && !/^\s*["']/.test(css.slice(i + 1, i + 8))) {
      while (i < css.length && css[i] !== ')') i++;
      cur += '()';
      continue;
    }
    if (ch === '{') { out.push(cur.trim()); cur = ''; continue; }
    if (ch === '}' || ch === ';') { cur = ''; continue; }
    cur += ch;
  }
  return out.filter((p) => p && !p.startsWith('@'));
}

function parseCss(rawCss) {
  const css = stripCssComments(rawCss);
  const classes = new Set();
  for (const p of selectorPreludes(css)) {
    const clean = p.replace(/\[[^\]]*\]/g, '');
    for (const m of clean.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  }
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  return { classes, defined, css };
}

/** CSS vars used with no fallback. */
function usedVars(text) {
  const out = new Set();
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) if (!m[2]) out.add(m[1]);
  return out;
}

// ---------- HTML parsing ----------
const cssCache = new Map();
function loadCss(path) {
  if (!cssCache.has(path)) {
    cssCache.set(path, existsSync(path) ? parseCss(readFileSync(path, 'utf8')) : null);
  }
  return cssCache.get(path);
}

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/gi, 'x').replace(/&#?\w+;/g, 'x');

function analyze(file) {
  const abs = resolve(ROOT, file);
  const html = readFileSync(abs, 'utf8');
  const rel = relative(ROOT, abs);
  if (/<meta[^>]+http-equiv=["']?refresh/i.test(html)) return { file: rel, skipped: 'redirect' };

  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const styleBlocks = [...noComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const body = noComments
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // Stylesheets: local linked .css + page <style>.
  const sheets = [];
  for (const m of body.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?stylesheet/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href || /^https?:/i.test(href)) continue;
    const path = href.startsWith('/')
      ? join(ROOT, href.split('?')[0])
      : join(dirname(abs), href.split('?')[0]);
    const parsed = loadCss(path);
    if (parsed) sheets.push(parsed);
  }
  for (const block of styleBlocks) sheets.push(parseCss(block));

  const definedClasses = new Set(sheets.flatMap((s) => [...s.classes]));
  const definedVars = new Set(sheets.flatMap((s) => [...s.defined]));
  // Inline style="--x: ..." declarations also define vars.
  const inlineStyles = [...body.matchAll(/\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/gi)].map((m) => m[1] ?? m[2]);
  for (const s of inlineStyles) for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);

  // Undefined classes.
  const usedClasses = new Set();
  for (const m of body.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const c of (m[1] ?? m[2]).split(/\s+/)) if (c && !/[{}$<>]/.test(c)) usedClasses.add(c);
  }
  const undefClasses = [...usedClasses].filter((c) => !definedClasses.has(c) && !isAllowedClass(c)).sort();

  // Undefined vars used in this page's own markup and <style> blocks.
  const varText = inlineStyles.join('\n') + '\n' + styleBlocks.join('\n');
  const undefVars = [...usedVars(varText)].filter((v) => !definedVars.has(v)).sort();

  // Visible words (no head/nav/footer/svg).
  const visible = body
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<(nav|footer|svg|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const words = decode(visible).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  return {
    file: rel,
    undefVars,
    undefClasses,
    inlineStyles: inlineStyles.length,
    words,
  };
}

// ---------- word budgets ----------
const BUDGET = { total: 550, hero: 30, h2: 8, faq: 40 };

const countWords = (html) => decode(html.replace(/<[^>]+>/g, ' '))
  .split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Drop non-content markup. The chrome regions go first, while their comment markers still exist. */
function stripNonContent(html) {
  return html
    .replace(/<!--\s*chrome:(header|footer)\b[^>]*-->[\s\S]*?<!--\s*(?:\/\s*chrome:\1|chrome:\1:end|end\s+chrome:\1)\b[^>]*-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|nav|footer|svg|head)\b[\s\S]*?<\/\1>/gi, '');
}

/** Inner HTML of the element whose opening tag starts at `start`, balanced on the same tag name. */
function elementInner(html, start) {
  const open = html.slice(start).match(/^<([a-z][a-z0-9]*)\b[^>]*>/i);
  if (!open) return '';
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'gi');
  re.lastIndex = start + open[0].length;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start + open[0].length, m.index);
  }
  return html.slice(start + open[0].length);
}

/** Start indices of opening tags for which `pred(tagText)` holds, in document order. */
function findOpenTags(html, pred) {
  const out = [];
  for (const m of html.matchAll(/<[a-z][a-z0-9]*\b[^>]*>/gi)) if (pred(m[0])) out.push(m.index);
  return out;
}
const hasClass = (tag, ...names) => {
  const c = tag.match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || [];
  const list = (c[1] ?? c[2] ?? '').split(/\s+/);
  return names.some((n) => list.includes(n));
};
const plainText = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function budgetCheck(rawHtml) {
  const body = stripNonContent(rawHtml);
  const total = countWords(body);

  let heroStart = findOpenTags(body, (t) => hasClass(t, 'hero', 'hero--photo') || /\sdata-photo-hero\b/i.test(t))[0];
  if (heroStart === undefined) heroStart = findOpenTags(body, (t) => /^<section\b/i.test(t))[0];
  const hero = heroStart === undefined ? 0 : countWords(elementInner(body, heroStart));

  const h2 = findOpenTags(body, (t) => /^<h2\b/i.test(t)).map((i) => {
    const text = plainText(elementInner(body, i));
    return { text, words: countWords(text) };
  });
  const faq = findOpenTags(body, (t) => hasClass(t, 'faq-answer')).map((i) => {
    const text = plainText(elementInner(body, i));
    return { text: text.slice(0, 40), words: countWords(text) };
  });

  const violations = [];
  if (total > BUDGET.total) violations.push(`total visible words ${total} > ${BUDGET.total}`);
  if (hero > BUDGET.hero) violations.push(`hero words ${hero} > ${BUDGET.hero}`);
  for (const h of h2) if (h.words > BUDGET.h2) violations.push(`h2 "${h.text}" has ${h.words} words > ${BUDGET.h2}`);
  for (const f of faq) if (f.words > BUDGET.faq) violations.push(`faq answer "${f.text}..." has ${f.words} words > ${BUDGET.faq}`);
  return { total, hero, h2, faq, violations };
}

// ---------- self-test ----------
function runSelfTest() {
  const w = (n) => Array.from({ length: n }, () => 'word').join(' ');
  const page = (inner, beforeMain = '') => `<html><head><title>${w(99)}</title>`
    + `<script type="application/ld+json">{"a":"${w(99)}"}</script></head><body>${beforeMain}${inner}</body></html>`;
  const hero = '<section class="hero"><h1>Hi</h1></section>';
  const cases = [
    ['clean page passes', page(`${hero}<section><h2>Three word title</h2><div class="faq-answer"><p>Short answer.</p></div></section>`), []],
    ['nav, footer, script, style, JSON-LD and chrome regions are not counted',
      page(`${hero}<footer>${w(300)}</footer><script>${w(300)}</script><style>${w(300)}</style>`,
        `<nav>${w(300)}</nav><!-- chrome:header -->${w(300)}<!-- /chrome:header -->`), []],
    ['total over 550 fails', page(`${hero}<p>${w(551)}</p>`), ['total']],
    ['hero over 30 fails', page(`<section class="hero hero--photo"><h1>${w(31)}</h1></section>`), ['hero']],
    ['data-photo-hero element is the hero', page(`<section><p>ok</p></section><div data-photo-hero><p>${w(31)}</p></div>`), ['hero']],
    ['first section is the hero when no hero class', page(`<section><p>${w(31)}</p></section>`), ['hero']],
    ['h2 over 8 fails', page(`${hero}<h2>${w(9)}</h2>`), ['h2']],
    ['h2 of exactly 8 passes', page(`${hero}<h2>${w(8)}</h2>`), []],
    ['faq answer over 40 fails', page(`${hero}<div class="faq-answer"><div><p>${w(41)}</p></div></div><p>after</p>`), ['faq']],
    ['faq answer of exactly 40 passes', page(`${hero}<div class="faq-answer"><p>${w(40)}</p></div>`), []],
  ];
  let failed = 0;
  for (const [name, html, expect] of cases) {
    const got = budgetCheck(html).violations.map((v) => v.split(' ')[0]);
    if (got.join() !== expect.join()) { failed++; console.error(`self-test FAIL: ${name}: expected [${expect}] got [${got}]`); }
  }
  if (failed) { console.error(`self-test: ${failed} of ${cases.length} failed`); process.exit(1); }
  console.log(`self-test: ${cases.length} budget cases OK`);
  process.exit(0);
}

// ---------- main ----------
if (selfTest) runSelfTest();
function defaultFiles() {
  const list = [];
  for (const dir of ['.', 'es']) {
    for (const f of readdirSync(join(ROOT, dir)).sort()) {
      if (f.endsWith('.html')) list.push(dir === '.' ? f : `${dir}/${f}`);
    }
  }
  return list;
}

const files = fileArgs.length ? fileArgs : defaultFiles();
const results = files.map(analyze);

// styles.css itself: vars it uses but never defines.
const sheet = loadCss(join(ROOT, 'styles.css'));
const sheetUndefVars = sheet ? [...usedVars(sheet.css)].filter((v) => !sheet.defined.has(v)).sort() : [];

// --budget: word budgets on the files listed after it (all default pages if none).
const budgetResults = budget
  ? (flagFiles['--budget'].length ? flagFiles['--budget'] : defaultFiles()).map((f) => {
    const abs = resolve(ROOT, f);
    const html = readFileSync(abs, 'utf8');
    const rel = relative(ROOT, abs);
    if (/<meta[^>]+http-equiv=["']?refresh/i.test(html)) return { file: rel, skipped: 'redirect' };
    return { file: rel, ...budgetCheck(html) };
  })
  : [];

if (asJson) {
  console.log(JSON.stringify({ results, budget: budgetResults, stylesCssUndefinedVars: sheetUndefVars }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  const w = Math.max(24, ...results.map((r) => r.file.length)) + 2;
  console.log(pad('page', w) + num('undef-vars', 11) + num('undef-cls', 11) + num('style=""', 10) + num('words', 8));
  console.log('-'.repeat(w + 40));
  const tot = { v: 0, c: 0, s: 0, w: 0 };
  for (const r of results) {
    if (r.skipped) { console.log(pad(r.file, w) + `  skipped (${r.skipped})`); continue; }
    tot.v += r.undefVars.length; tot.c += r.undefClasses.length; tot.s += r.inlineStyles; tot.w += r.words;
    console.log(pad(r.file, w) + num(r.undefVars.length, 11) + num(r.undefClasses.length, 11) + num(r.inlineStyles, 10) + num(r.words, 8));
    if (verbose) {
      if (r.undefVars.length) console.log('    vars:    ' + r.undefVars.join(' '));
      if (r.undefClasses.length) console.log('    classes: ' + r.undefClasses.join(' '));
    }
  }
  console.log('-'.repeat(w + 40));
  console.log(pad('TOTAL', w) + num(tot.v, 11) + num(tot.c, 11) + num(tot.s, 10) + num(tot.w, 8));
  console.log(`styles.css undefined vars: ${sheetUndefVars.length}${sheetUndefVars.length ? ' (' + sheetUndefVars.join(' ') + ')' : ''}`);
}

let failed = false;

if (strict) {
  // --strict with no files of its own checks the bare files, else every page.
  const strictFiles = flagFiles['--strict'].length ? flagFiles['--strict'] : files;
  const strictSet = new Set(strictFiles.map((f) => relative(ROOT, resolve(ROOT, f))));
  const bad = results.filter((r) => strictSet.has(r.file) && !r.skipped && (r.undefVars.length || r.undefClasses.length || r.inlineStyles));
  if (bad.length || sheetUndefVars.length) {
    for (const r of bad) {
      console.error(`FAIL ${r.file}: vars=[${r.undefVars}] classes=[${r.undefClasses}] style=${r.inlineStyles}`);
    }
    if (sheetUndefVars.length) console.error(`FAIL styles.css: undefined vars [${sheetUndefVars}]`);
    failed = true;
  } else if (!asJson) console.log('strict: OK');
}

if (budget) {
  const over = budgetResults.filter((r) => !r.skipped && r.violations.length);
  for (const r of over) for (const v of r.violations) console.error(`BUDGET FAIL ${r.file}: ${v}`);
  if (over.length) failed = true;
  else if (!asJson) console.log(`budget: OK (${budgetResults.filter((r) => !r.skipped).length} pages)`);
}

if (failed) process.exit(1);
