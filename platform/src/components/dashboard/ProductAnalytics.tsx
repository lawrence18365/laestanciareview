'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track, getDisplayMode } from '@/lib/analytics-client';

const APP_OPEN_KEY = 'rt_app_open_sent';
/** Persists across sessions so a first standalone open is distinguishable from a
 *  returning one. Per-device only; it cannot recover history from before this
 *  shipped, and a cleared profile reads as "first" again. */
const STANDALONE_SEEN_KEY = 'rt_standalone_seen';

async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return sub !== null;
  } catch {
    return false;
  }
}

/**
 * Invisible analytics beacon mounted once in DashboardShell.
 * Fires app_open once per tab session and page_view on every route change.
 * src/nid (push-notification attribution params) are forwarded when present.
 */
export default function ProductAnalytics({
  role,
}: {
  // `slug` is accepted for future per-restaurant client events; the server
  // already derives restaurant identity from the session cookie.
  slug: string;
  role: 'gm' | 'owner' | 'regional';
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (sessionStorage.getItem(APP_OPEN_KEY)) return;
    sessionStorage.setItem(APP_OPEN_KEY, '1');

    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const nid = params.get('nid');

    void (async () => {
      track('app_open', {
        role,
        push_permission:
          typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
        push_subscribed: await hasPushSubscription(),
        ...(src ? { src } : {}),
        ...(nid ? { nid } : {}),
      });
    })();
  }, [role]);

  // PWA adoption. Listeners are Chromium-only; the standalone branch is the
  // only signal available on iOS.
  useEffect(() => {
    const onPrompt = () => track('pwa_install_prompt_offered', { role });
    const onInstalled = () => track('pwa_installed', { role });
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (getDisplayMode() === 'standalone') {
      let seen = false;
      try {
        seen = window.localStorage.getItem(STANDALONE_SEEN_KEY) === '1';
        window.localStorage.setItem(STANDALONE_SEEN_KEY, '1');
      } catch {
        // Storage unavailable: treat as returning so we never over-report a
        // "first" open we cannot actually establish.
        seen = true;
      }
      track(seen ? 'pwa_standalone_open' : 'pwa_standalone_first_open', {
        role,
        evidence: 'standalone_display_mode',
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [role]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const nid = params.get('nid');
    track('page_view', {
      role,
      ...(src ? { src } : {}),
      ...(nid ? { nid } : {}),
    });
  }, [pathname, role]);

  return null;
}
