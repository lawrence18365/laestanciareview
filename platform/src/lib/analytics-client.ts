/**
 * Browser-side product analytics. No React, no dependencies — safe to import
 * from any client component. Every public function is a no-op on the server
 * and swallows all errors: analytics must never break the UI it measures.
 */
import type { ProductEventName } from '@/lib/product-events';

const SESSION_KEY = 'rt_sid';
const TRACK_URL = '/api/analytics/track';
/** Bundle this client is running. Inlined at build time by next.config.ts. */
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown';

/** Stable-per-tab session id, persisted in sessionStorage. */
export function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `rt-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // Private mode / storage disabled — analytics degrades to sessionless.
    return null;
  }
}

/** 'standalone' when running as an installed PWA, else 'browser'. */
export function getDisplayMode(): 'browser' | 'standalone' {
  if (typeof window === 'undefined') return 'browser';
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    // iOS Safari pre-display-mode-media support.
    if ((navigator as { standalone?: boolean }).standalone === true) return 'standalone';
  } catch {
    // ignore — default to browser
  }
  return 'browser';
}

/**
 * Fire-and-forget event POST. Prefers sendBeacon (survives page unload),
 * falls back to keepalive fetch. All errors swallowed.
 */
export function track(
  name: ProductEventName,
  properties?: Record<string, unknown>,
  opts?: { restaurantSlug?: string },
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({
      events: [
        {
          name,
          path: window.location.pathname + window.location.search,
          display_mode: getDisplayMode(),
          session_id: getSessionId() ?? undefined,
          // Guest surfaces have no session, so the slug is the only way the
          // track endpoint can attribute the event to a restaurant.
          restaurant_slug: opts?.restaurantSlug,
          // build_sha rides on every event so a stale client is identifiable
          // without a schema change.
          properties: { ...(properties ?? {}), build_sha: BUILD_SHA },
        },
      ],
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(
        TRACK_URL,
        new Blob([payload], { type: 'application/json' }),
      );
      if (ok) return;
    }

    fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: payload,
    }).catch(() => {});
  } catch {
    // never throw
  }
}

/**
 * Report a browser exception as a `client_error` event.
 *
 * WHY THIS EXISTS: global-error.tsx is the last line of defence on the client and
 * it reported to Sentry — with no NEXT_PUBLIC_SENTRY_DSN configured, so nothing
 * was ever sent. A four-day outage on /quotes (10-14 sep 2026) left zero trace in
 * any system: the server render was fine, so no server log carried it, and the
 * browser threw before React could render. This is the difference between "a
 * customer tells us" and "we know".
 *
 * WHAT IT CANNOT CARRY (this is a boundary, not a convention):
 *  - no cookies, localStorage, sessionStorage, request/response bodies, headers,
 *    or environment values are read. Nothing here touches them.
 *  - `context` is filtered through ALLOWED_ERROR_CONTEXT, so a caller cannot turn
 *    this into an exfiltration path by passing a secret in the context object.
 *    Add a key to that list deliberately if a new one is ever needed.
 *  - the only free-form fields are the error's own name, message and stack — text
 *    the thrown Error already produced in the browser.
 *
 * SIZE BUDGET: /api/analytics/track caps properties at 2 KB of JSON and drops the
 * WHOLE object to `{truncated:true}` if it is bigger — so the fields below are
 * truncated here, on purpose, and kept far under that ceiling. A stack that
 * overflows the cap would cost the error name and message too, which is the
 * worst possible trade.
 *
 * Capture: name, message, stack (top frames), digest, route, display mode, build
 * SHA, and the quote id when the URL has one. Location slug is not read from
 * here — the cookie is httpOnly and the track endpoint attributes the event to
 * the session's restaurant server-side anyway.
 */

/** The only context keys this reporter will ever forward. */
const ALLOWED_ERROR_CONTEXT = ['boundary'] as const;

export function trackClientError(
  error: unknown,
  context?: { boundary?: string; [key: string]: unknown },
): void {
  if (typeof window === 'undefined') return;
  try {
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    const digest = (error as { digest?: unknown } | null)?.digest;
    // /quotes/46, /quotes/46/print — the id is the first thing needed to reproduce.
    const quoteId = window.location.pathname.match(/\/quotes\/(\d+)/)?.[1];

    const safeContext: Record<string, unknown> = {};
    for (const key of ALLOWED_ERROR_CONTEXT) {
      const value = context?.[key];
      if (typeof value === 'string') safeContext[key] = clamp(value, 60);
    }

    track('client_error', {
      error_name: clamp(err.name, 60),
      error_message: clamp(err.message, 240),
      stack: clamp(err.stack ?? '', 900),
      ...(typeof digest === 'string' ? { digest: clamp(digest, 60) } : {}),
      ...(quoteId ? { quote_id: quoteId } : {}),
      ...safeContext,
    });
  } catch {
    // never throw from the error reporter
  }
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
