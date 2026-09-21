// RateTap Service Worker — Push Notifications

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'RateTap', body: event.data.text() };
  }

  const url = data.url || '/dashboard';
  const nid = data.nid ?? null;
  const kind = data.kind ?? null;
  const rid = data.rid ?? null;
  const isLowReview = kind === 'low_review' && Boolean(rid);
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/notification-badge.png',
    tag: data.tag || 'ratetap-review',
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: isLowReview || data.requireInteraction || false,
    // WebKit/iOS renders no action buttons; the deep link is the universal path.
    ...(isLowReview ? { actions: [{ action: 'acknowledge', title: 'Lo atiendo' }] } : {}),
    data: { url, nid, kind, rid },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'RateTap', options).then(() =>
      fetch('/api/analytics/track', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{ name: 'push_notification_shown', path: url, properties: { nid, kind, rid } }],
        }),
      }).catch(() => {})
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  const nid = event.notification.data?.nid ?? null;
  const kind = event.notification.data?.kind ?? null;
  const rid = event.notification.data?.rid ?? null;
  const action = event.action === 'acknowledge' ? 'acknowledge' : undefined;

  const clickPing = fetch('/api/analytics/track', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: [{
        name: 'push_notification_click',
        path: url,
        properties: { nid, kind, ...(action ? { action } : {}) },
      }],
    }),
  }).catch(() => {});

  event.waitUntil(
    (async () => {
      if (action) {
        const acknowledged = await fetch('/api/auth/feedback', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId: rid, status: 'reviewed', reviewedVia: 'push_action' }),
        }).then((res) => res.ok).catch(() => false);

        if (acknowledged) {
          await clickPing;
          return;
        }
      }

      await Promise.all([
        clickPing,
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
          for (const client of windowClients) {
            if (client.url.includes(url) && 'focus' in client) {
              return client.focus();
            }
          }
          return clients.openWindow(url);
        }),
      ]);
    })()
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
