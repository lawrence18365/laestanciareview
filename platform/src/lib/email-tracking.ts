import { hmacSign } from './session';
import { timingSafeEqual } from './timing';

/**
 * Open/click tracking for the welcome email and trial-nurture emails ONLY.
 * Grupo digests/briefings never go through here.
 *
 * Every tracking URL is `GET /api/email/t?k=<o|c>&t=<template>&r=<restaurantId>
 * [&u=<target>]&s=<sig>`. The signature is an HMAC over kind, template, restaurant
 * and target, so a link cannot be enumerated, re-pointed or replayed against
 * another restaurant. Nothing about a guest is in the URL: a restaurant id and a
 * template name only.
 */

export const TRACK_PATH = '/api/email/t';

const TEMPLATE_RE = /^[a-z0-9_]{1,40}$/;
const SIG_HEX_LENGTH = 32;

/** Hosts a signed click may redirect to. */
const ALLOWED_REDIRECT_HOSTS = new Set([
  'app.ratetapmx.com',
  'wa.me',
  'google.com',
  'g.page',
  'maps.app.goo.gl',
]);

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
}

function isGuestReviewLink(raw: string): boolean {
  try {
    return new URL(raw).pathname.startsWith('/r/');
  } catch {
    return false;
  }
}

export function isValidTemplate(template: string): boolean {
  return TEMPLATE_RE.test(template);
}

/** https only, no credentials, host on the allow-list (or *.google.com / the configured base host). */
export function isAllowedRedirect(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_REDIRECT_HOSTS.has(host) || host.endsWith('.google.com')) return true;
  try {
    return host === new URL(baseUrl()).hostname.toLowerCase();
  } catch {
    return false;
  }
}

async function signature(kind: 'o' | 'c', template: string, restaurantId: number, target: string): Promise<string> {
  // '|' separators keep this message out of the session cookie's ':' grammar.
  const full = await hmacSign(`email-track|${kind}|${template}|${restaurantId}|${target}`);
  return full.slice(0, SIG_HEX_LENGTH);
}

export async function verifyTrackToken(args: {
  kind: 'o' | 'c';
  template: string;
  restaurantId: number;
  target: string;
  sig: string;
}): Promise<boolean> {
  if (!isValidTemplate(args.template) || !Number.isInteger(args.restaurantId) || args.restaurantId <= 0) {
    return false;
  }
  try {
    const expected = await signature(args.kind, args.template, args.restaurantId, args.target);
    return timingSafeEqual(args.sig, expected);
  } catch {
    return false;
  }
}

/** encodeURIComponent, but leave ':' and '/' readable (both are legal in a query string). */
function encodeTarget(url: string): string {
  return encodeURIComponent(url).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
}

export async function openPixelUrl(template: string, restaurantId: number): Promise<string> {
  const sig = await signature('o', template, restaurantId, '');
  return `${baseUrl()}${TRACK_PATH}?k=o&t=${template}&r=${restaurantId}&s=${sig}`;
}

export async function clickUrl(template: string, restaurantId: number, target: string): Promise<string> {
  const sig = await signature('c', template, restaurantId, target);
  return `${baseUrl()}${TRACK_PATH}?k=c&t=${template}&r=${restaurantId}&u=${encodeTarget(target)}&s=${sig}`;
}

/**
 * Wrap every allow-listed absolute link in `html` and append the open pixel.
 * Fails open: a missing restaurant id, a bad template or a signing failure
 * (SESSION_SECRET unset) returns the email untouched, never a broken send.
 */
export async function addEmailTracking(
  html: string,
  opts: { template: string; restaurantId?: number | null },
): Promise<string> {
  const { template, restaurantId } = opts;
  if (!restaurantId || !isValidTemplate(template)) return html;
  try {
    const targets = new Set<string>();
    for (const m of html.matchAll(/href="(https:\/\/[^"]+)"/g)) {
      // Guest review links (/r/{slug}) get forwarded to diners; wrapping them would log
      // every diner tap as the owner's email click.
      if (isAllowedRedirect(m[1]) && !m[1].includes(TRACK_PATH) && !isGuestReviewLink(m[1])) targets.add(m[1]);
    }
    const wrapped = new Map<string, string>();
    for (const target of targets) {
      wrapped.set(target, (await clickUrl(template, restaurantId, target)).replace(/&/g, '&amp;'));
    }
    const rewritten = html.replace(/href="(https:\/\/[^"]+)"/g, (full, target: string) => {
      const next = wrapped.get(target);
      return next ? `href="${next}"` : full;
    });
    const pixel = (await openPixelUrl(template, restaurantId)).replace(/&/g, '&amp;');
    return `${rewritten}<img src="${pixel}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;
  } catch {
    return html;
  }
}
