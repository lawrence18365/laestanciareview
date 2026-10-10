#!/usr/bin/env node
// RateTap design-system checker (Node stdlib only, regex/HTML-lite parsing).
//
// Usage:
//   node scripts/check-design-system.mjs                    all root + es/ pages, prints a table, exit 0
//   node scripts/check-design-system.mjs --strict a.html    exit 1 if any listed page has an undefined
//                                                           CSS var, an undefined class or a style="" attribute
//   node scripts/check-design-system.mjs -v                 also list the offending names
//   node scripts/check-design-system.mjs --json             machine-readable report
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
const strict = args.includes('--strict');
const verbose = args.includes('-v') || args.includes('--verbose');
const asJson = args.includes('--json');
const fileArgs = args.filter((a) => !a.startsWith('-'));

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

// ---------- main ----------
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

if (asJson) {
  console.log(JSON.stringify({ results, stylesCssUndefinedVars: sheetUndefVars }, null, 2));
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

if (strict) {
  const bad = results.filter((r) => !r.skipped && (r.undefVars.length || r.undefClasses.length || r.inlineStyles));
  if (bad.length || sheetUndefVars.length) {
    for (const r of bad) {
      console.error(`FAIL ${r.file}: vars=[${r.undefVars}] classes=[${r.undefClasses}] style=${r.inlineStyles}`);
    }
    if (sheetUndefVars.length) console.error(`FAIL styles.css: undefined vars [${sheetUndefVars}]`);
    process.exit(1);
  }
  if (!asJson) console.log('strict: OK');
}
