/**
 * Browser-side product analytics. No React, no dependencies — safe to import
 * from any client component. Every public function is a no-op on the server
 * and swallows all errors: analytics must never break the UI it measures.
 */
import type { ProductEventName } from '@/lib/product-events';

const SESSION_KEY = 'rt_sid';
const TRACK_URL = '/api/analytics/track';

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
          properties: properties ?? undefined,
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
