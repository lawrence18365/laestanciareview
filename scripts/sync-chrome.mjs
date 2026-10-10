#!/usr/bin/env node
// Sync the shared site chrome (header, footer, favicon tags) into every public page.
//
//   node scripts/sync-chrome.mjs            write: first run adopts each page's existing
//                                           <nav class="navbar">, <footer> and rel=icon links
//                                           into marked regions; later runs rewrite the
//                                           marked regions only. Idempotent.
//   node scripts/sync-chrome.mjs --check    drift test: exit 1 and list pages whose marked
//                                           region differs from the rendered partial, or that
//                                           lack the markers. Writes nothing.
//
// Source of truth: partials/header.{en,es}.html, partials/footer.{en,es}.html,
// partials/head-icons.html. Placeholders (double braces) filled per page:
//   ALT_LANG_URL  other-language counterpart, from the page's own hreflang pair,
//                 else the other language's home
//   SOURCE_PAGE   page slug for funnel attribution ('home' for index pages)
//   LANG          en | es, from <html lang>
// scripts/build_blog.py renders the same partials with the same fill rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_ORIGIN = 'https://ratetapmx.com';
const PAGE_DIRS = ['', 'es', 'blog', 'es/blog'];
const EXCLUDE = new Set(['email-preview.html']);
const FONT_AWESOME_HREF = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
const CHECK = process.argv.includes('--check');

const partial = (name) => fs.readFileSync(path.join(ROOT, 'partials', name), 'utf8').trim();
const PARTIALS = {
  header: { en: partial('header.en.html'), es: partial('header.es.html') },
  footer: { en: partial('footer.en.html'), es: partial('footer.es.html') },
  icons: partial('head-icons.html'),
};

const markerRe = (name) => new RegExp(`<!-- chrome:${name} -->[\\s\\S]*?<!-- /chrome:${name} -->`);
// Body lines are indented four spaces, the close marker sits at four spaces; scripts/build_blog.py does the same.
const block = (name, body) => {
  const indented = body.split('\n').map((line) => (line ? `    ${line}` : line)).join('\n');
  return `<!-- chrome:${name} -->\n${indented}\n    <!-- /chrome:${name} -->`;
};

const NAV_RE = /(?:<!--\s*Navigation\s*-->\s*)?<nav\b[^>]*\bclass="[^"]*\bnavbar\b[^"]*"[^>]*>[\s\S]*?<\/nav>/;
const FOOTER_RE = /(?:<!--\s*Footer\s*-->\s*)?<footer\b[^>]*\bclass="[^"]*\bfooter\b[^"]*"[^>]*>[\s\S]*?<\/footer>/;
const ICON_LINK_RE = /<link\b[^>]*\brel=["'](?:shortcut icon|icon|alternate icon|apple-touch-icon|apple-touch-icon-precomposed)["'][^>]*>/gi;
const THEME_COLOR_RE = /<meta\b[^>]*\bname=["']theme-color["'][^>]*>/i;
const SCRIPT_JS_RE = /<script\b[^>]*\bsrc=["'](?:[^"']*\/)?script\.js(?:\?[^"']*)?["']/i;
const FONT_AWESOME_RE = /font-?awesome/i;

function listPages() {
  const pages = [];
  const skipped = [];
  for (const dir of PAGE_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const name of fs.readdirSync(abs).sort()) {
      if (!name.endsWith('.html')) continue;
      const rel = path.posix.join(dir, name);
      if (EXCLUDE.has(rel)) { skipped.push(`${rel} (excluded: not a site page)`); continue; }
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (/http-equiv=["']refresh["']/i.test(html)) { skipped.push(`${rel} (redirect stub)`); continue; }
      pages.push(rel);
    }
  }
  return { pages, skipped };
}

const pageLang = (html) => (/<html\b[^>]*\blang=["']([a-z]{2})/i.exec(html)?.[1] === 'es' ? 'es' : 'en');

// URL path a page is served at, with .html and a trailing slash dropped, for self-comparison.
function normalizePath(p) {
  let out = p.replace(SITE_ORIGIN, '').split('#')[0].split('?')[0];
  if (!out.startsWith('/')) out = `/${out}`;
  out = out.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  return out.length > 1 ? out.replace(/\/$/, '') : out;
}

function ownPath(rel) {
  return normalizePath(`/${rel}`);
}

function hreflangHref(html, tag) {
  for (const link of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["']alternate["']/i.test(link)) continue;
    if (new RegExp(`\\bhreflang=["']${tag}["']`, 'i').test(link)) {
      return /\bhref=["']([^"']+)["']/i.exec(link)?.[1] ?? null;
    }
  }
  return null;
}

function altLangUrl(html, lang, rel) {
  const homeOfOther = lang === 'en' ? '/es/' : '/';
  const href = hreflangHref(html, lang === 'en' ? 'es-MX' : 'en-US');
  if (!href) return { url: homeOfOther, source: 'fallback-home' };
  const url = href.replace(SITE_ORIGIN, '');
  if (!url.startsWith('/')) return { url: homeOfOther, source: 'fallback-home' };
  if (normalizePath(url) === ownPath(rel)) return { url: homeOfOther, source: 'fallback-home' };
  return { url, source: 'hreflang' };
}

function sourcePage(rel) {
  const base = path.posix.basename(rel, '.html');
  if (base !== 'index') return base;
  const dir = path.posix.dirname(rel);
  if (dir === '.' || dir === 'es') return 'home';
  return path.posix.basename(dir);
}

const escAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => escAttr(String(vars[key] ?? '')));

function render(html, rel) {
  const lang = pageLang(html);
  const alt = altLangUrl(html, lang, rel);
  const vars = { ALT_LANG_URL: alt.url, SOURCE_PAGE: sourcePage(rel), LANG: lang };
  return {
    lang,
    altSource: alt.source,
    header: block('header', fill(PARTIALS.header[lang], vars)),
    footer: block('footer', fill(PARTIALS.footer[lang], vars)),
    icons: block('icons', PARTIALS.icons),
  };
}

const sub = (html, re, text) => html.replace(re, () => text);

function adoptIcons(html, icons) {
  let seen = false;
  const out = html.replace(ICON_LINK_RE, (match, offset) => {
    if (!seen) { seen = true; return icons; }
    return '\u0000DROP\u0000';
  });
  if (!seen) {
    const at = out.search(/<\/head>/i);
    if (at === -1) throw new Error('no </head>');
    return `${out.slice(0, at)}    ${icons}\n${out.slice(at)}`;
  }
  return out.replace(/[ \t]*\u0000DROP\u0000[ \t]*\n?/g, '');
}

function insertAfterBodyOpen(html, text) {
  const open = /<body\b[^>]*>/i.exec(html);
  if (!open) throw new Error('no <body>');
  let at = open.index + open[0].length;
  const gtm = /^\s*<!-- Google Tag Manager \(noscript\) -->[\s\S]*?<!-- End Google Tag Manager \(noscript\) -->/.exec(html.slice(at));
  if (gtm) at += gtm[0].length;
  return `${html.slice(0, at)}\n    ${text}\n${html.slice(at)}`;
}

function insertBeforeBodyClose(html, text) {
  const at = html.search(/<\/body>/i);
  if (at === -1) throw new Error('no </body>');
  return `${html.slice(0, at)}    ${text}\n${html.slice(at)}`;
}

function insertBeforeHeadClose(html, text) {
  const at = html.search(/<\/head>/i);
  if (at === -1) throw new Error('no </head>');
  return `${html.slice(0, at)}    ${text}\n${html.slice(at)}`;
}

function sync(html, rel) {
  const r = render(html, rel);
  let out = html;

  if (markerRe('icons').test(out)) out = sub(out, markerRe('icons'), r.icons);
  else out = adoptIcons(out, r.icons);

  if (markerRe('header').test(out)) out = sub(out, markerRe('header'), r.header);
  else if (NAV_RE.test(out)) out = sub(out, NAV_RE, r.header);
  else out = insertAfterBodyOpen(out, r.header);

  if (markerRe('footer').test(out)) out = sub(out, markerRe('footer'), r.footer);
  else if (FOOTER_RE.test(out)) out = sub(out, FOOTER_RE, r.footer);
  else out = insertBeforeBodyClose(out, r.footer);

  if (!FONT_AWESOME_RE.test(out)) out = insertBeforeHeadClose(out, `<link rel="stylesheet" href="${FONT_AWESOME_HREF}">`);
  if (!SCRIPT_JS_RE.test(out)) out = insertBeforeBodyClose(out, '<script src="/script.js"></script>');
  return out;
}

function stripRegions(html) {
  return ['header', 'footer', 'icons'].reduce((acc, name) => acc.replace(markerRe(name), ''), html);
}

function problems(html, rel) {
  const found = [];
  const r = render(html, rel);
  for (const name of ['header', 'footer', 'icons']) {
    const open = html.split(`<!-- chrome:${name} -->`).length - 1;
    const close = html.split(`<!-- /chrome:${name} -->`).length - 1;
    if (open === 0 && close === 0) { found.push(`missing <!-- chrome:${name} --> markers`); continue; }
    if (open !== 1 || close !== 1) { found.push(`chrome:${name} markers not exactly one pair`); continue; }
    const current = markerRe(name).exec(html)[0];
    if (current !== r[name]) found.push(`chrome:${name} differs from partial`);
  }
  const rest = stripRegions(html);
  if (NAV_RE.test(rest)) found.push('stray <nav class="navbar"> outside chrome:header');
  if (FOOTER_RE.test(rest)) found.push('stray <footer class="footer"> outside chrome:footer');
  if (new RegExp(ICON_LINK_RE.source, 'i').test(rest)) found.push('stray rel=icon/apple-touch-icon outside chrome:icons');
  if (THEME_COLOR_RE.test(rest)) found.push('stray theme-color outside chrome:icons');
  if (!FONT_AWESOME_RE.test(html)) found.push('Font Awesome stylesheet missing (nav icons)');
  if (!SCRIPT_JS_RE.test(html)) found.push('script.js missing (mobile nav toggle)');
  const hi = html.indexOf('<!-- chrome:header -->');
  const fi = html.indexOf('<!-- chrome:footer -->');
  if (hi !== -1 && fi !== -1 && hi > fi) found.push('chrome:header comes after chrome:footer');
  return found;
}

const { pages, skipped } = listPages();
let changed = 0;
let failing = 0;
const fallbacks = [];

for (const rel of pages) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, 'utf8');
  const r = render(html, rel);
  if (r.altSource === 'fallback-home') fallbacks.push(rel);

  if (CHECK) {
    const list = problems(html, rel);
    if (list.length) {
      failing += 1;
      console.error(`DRIFT ${rel}`);
      for (const p of list) console.error(`  - ${p}`);
    }
    continue;
  }

  const next = sync(html, rel);
  if (next !== html) {
    fs.writeFileSync(file, next, 'utf8');
    changed += 1;
  }
}

for (const s of skipped) console.log(`skipped ${s}`);
console.log(`language toggle falls back to the other home on ${fallbacks.length} page(s): ${fallbacks.join(', ') || 'none'}`);
if (CHECK) {
  console.log(`checked ${pages.length} pages: ${failing === 0 ? 'chrome in sync' : `${failing} with drift`}`);
  process.exit(failing === 0 ? 0 : 1);
}
console.log(`synced ${pages.length} pages, ${changed} rewritten`);
