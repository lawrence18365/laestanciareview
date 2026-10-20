import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Browser enrollment path. The module reads its VAPID key and the browser
 * globals at import time, so every test stubs the globals first, resets the
 * module registry and imports it fresh.
 */

const ENDPOINT = 'https://push.example/device-a';
const NEW_ENDPOINT = 'https://push.example/device-b';
const REMEMBERED_ENDPOINT_KEY = 'ratetap_push_endpoint';

let order: string[];

function fakeSubscription(endpoint = ENDPOINT) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn(async () => {
      order.push('unsubscribe');
      return true;
    }),
  };
}

function fakeRegistration(subscription: ReturnType<typeof fakeSubscription> | null) {
  return {
    active: { state: 'activated' },
    pushManager: {
      getSubscription: vi.fn(async () => {
        order.push('getSubscription');
        return subscription;
      }),
      subscribe: vi.fn(async () => {
        order.push('subscribe');
        return subscription ?? fakeSubscription();
      }),
    },
  };
}

type FakeSubscription = ReturnType<typeof fakeSubscription>;
type FakeRegistration = ReturnType<typeof fakeRegistration>;

/**
 * A device whose browser subscription can change: dropping it clears the
 * registration and the next subscribe() mints a brand new endpoint, the way a
 * real browser behaves after `unsubscribe()`.
 */
function fakeChangeableDevice(
  initialEndpoint: string | null,
  nextEndpoint: string,
): { registration: FakeRegistration; initial: FakeSubscription | null } {
  let current: FakeSubscription | null = initialEndpoint
    ? fakeSubscription(initialEndpoint)
    : null;
  const initial = current;

  if (current) {
    const unsubscribe = current.unsubscribe;
    current.unsubscribe = vi.fn(async () => {
      const result = await unsubscribe();
      current = null;
      return result;
    });
  }

  const registration = {
    active: { state: 'activated' },
    pushManager: {
      getSubscription: vi.fn(async () => {
        order.push('getSubscription');
        return current;
      }),
      subscribe: vi.fn(async () => {
        order.push('subscribe');
        current = fakeSubscription(nextEndpoint);
        return current;
      }),
    },
  };

  return { registration: registration as FakeRegistration, initial };
}

interface BrowserOptions {
  permission?: NotificationPermission;
  requestPermissionResult?: NotificationPermission;
  existingSubscription?: ReturnType<typeof fakeSubscription> | null;
  registration?: FakeRegistration;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>;
}

/** Install the minimum browser surface push-client touches. */
function stubBrowser(options: BrowserOptions = {}) {
  const subscription =
    options.existingSubscription === undefined
      ? fakeSubscription()
      : options.existingSubscription;
  const registration = options.registration ?? fakeRegistration(subscription);

  const serviceWorker = {
    register: vi.fn(async () => {
      order.push('register');
      return registration;
    }),
    getRegistration: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };

  const localStorage = {
    store: new Map<string, string>(),
    getItem(key: string) {
      return this.store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      this.store.set(key, value);
    },
    removeItem(key: string) {
      this.store.delete(key);
    },
  };

  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      order.push('requestPermission');
      return options.requestPermissionResult ?? 'granted';
    }),
  };

  vi.stubGlobal('window', {
    localStorage,
    PushManager: class {},
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('navigator', { serviceWorker, userAgent: 'Mozilla/5.0 (Linux; Android 15)' });
  vi.stubGlobal('Notification', notification);

  const fetchMock = vi.fn(
    options.fetchImpl ??
      (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  return { subscription, registration, notification, localStorage, fetchMock };
}

async function loadPushClient() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
  vi.resetModules();
  return import('@/lib/push-client');
}

beforeEach(() => {
  order = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

describe('subscribeToPush', () => {
  it('requests notification permission before touching the service worker', async () => {
    const browser = stubBrowser({
      permission: 'default',
      requestPermissionResult: 'granted',
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({ ok: true });

    // Safari/iOS only grant permission inside the tap: any await before the
    // request can lose the gesture, so register must come after.
    expect(order.indexOf('requestPermission')).toBe(0);
    expect(order.indexOf('requestPermission')).toBeLessThan(order.indexOf('register'));
    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(browser.fetchMock).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not re-prompt when permission is already granted', async () => {
    const browser = stubBrowser({ permission: 'granted' });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({ ok: true });

    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(order.indexOf('register')).toBe(0);
  });

  it('reports permission_denied without registering a service worker', async () => {
    const browser = stubBrowser({
      permission: 'default',
      requestPermissionResult: 'denied',
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'permission_denied',
    });
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('maps a real 409 push_device_conflict to device_conflict and keeps the remembered endpoint', async () => {
    const browser = stubBrowser({
      permission: 'granted',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: 'Este dispositivo ya recibe notificaciones de otra cuenta',
            code: 'push_device_conflict',
          }),
          { status: 409 },
        ),
    });
    browser.localStorage.store.set(
      REMEMBERED_ENDPOINT_KEY,
      'https://push.example/previous-account',
    );
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'device_conflict',
    });
    // A rejected registration must not claim the endpoint for this account
    // locally, or the next logout would revoke the other account's alerts.
    expect(browser.localStorage.getItem(REMEMBERED_ENDPOINT_KEY)).toBe(
      'https://push.example/previous-account',
    );
  });

  it.each([
    ['a different code', JSON.stringify({ code: 'endpoint_invalid' })],
    ['a body without a code', JSON.stringify({ error: 'conflict' })],
    ['a non-JSON body', 'conflict'],
  ])('maps a 409 with %s to post_failed', async (_label, body) => {
    const browser = stubBrowser({
      permission: 'granted',
      fetchImpl: async () => new Response(body, { status: 409 }),
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'post_failed',
    });
    expect(browser.localStorage.store.has(REMEMBERED_ENDPOINT_KEY)).toBe(false);
  });

  it('maps any other rejected registration to post_failed', async () => {
    stubBrowser({
      permission: 'granted',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'post_failed',
    });
  });

  it('reuses the browser subscription when registration is retried after a 500', async () => {
    const device = fakeChangeableDevice(null, NEW_ENDPOINT);
    const statuses = [500, 200];
    const browser = stubBrowser({
      permission: 'granted',
      registration: device.registration,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), { status: statuses.shift() ?? 200 }),
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'post_failed',
    });
    expect(device.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(browser.localStorage.store.has(REMEMBERED_ENDPOINT_KEY)).toBe(false);

    // Retrying persists the subscription the browser already holds instead of
    // minting a second endpoint with the push service.
    await expect(push.subscribeToPush()).resolves.toEqual({ ok: true });
    expect(device.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(browser.localStorage.getItem(REMEMBERED_ENDPOINT_KEY)).toBe(NEW_ENDPOINT);
  });

  it('reports unsupported when the browser exposes no Notification API', async () => {
    stubBrowser({ permission: 'granted' });
    vi.stubGlobal('Notification', undefined);
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('reports unsupported when the browser exposes no PushManager', async () => {
    stubBrowser({ permission: 'granted' });
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      matchMedia: () => ({ matches: false }),
    });
    const push = await loadPushClient();

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('reports no_vapid_key without touching the browser APIs', async () => {
    const browser = stubBrowser({ permission: 'granted' });
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const push = await import('@/lib/push-client');

    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'no_vapid_key',
    });
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('replaceDeviceSubscription', () => {
  it('drops the previous subscription before enrolling this account', async () => {
    const previous = fakeSubscription('https://push.example/other-account');
    const browser = stubBrowser({ permission: 'granted', existingSubscription: previous });
    const push = await loadPushClient();

    await expect(push.replaceDeviceSubscription()).resolves.toEqual({ ok: true });

    expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
    expect(order.indexOf('unsubscribe')).toBeLessThan(order.indexOf('register'));
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('replaces a conflicting device subscription and remembers the new endpoint', async () => {
    const device = fakeChangeableDevice(ENDPOINT, NEW_ENDPOINT);
    let postStatus = 409;
    const browser = stubBrowser({
      permission: 'granted',
      registration: device.registration,
      fetchImpl: async () =>
        new Response(
          JSON.stringify(
            postStatus === 409
              ? {
                  error: 'Este dispositivo ya recibe notificaciones de otra cuenta',
                  code: 'push_device_conflict',
                }
              : { ok: true },
          ),
          { status: postStatus },
        ),
    });
    const push = await loadPushClient();

    // The conflict state the banner reacts to: the endpoint is owned elsewhere.
    await expect(push.subscribeToPush()).resolves.toEqual({
      ok: false,
      reason: 'device_conflict',
    });
    expect(browser.localStorage.store.has(REMEMBERED_ENDPOINT_KEY)).toBe(false);

    order = [];
    postStatus = 200;
    await expect(push.replaceDeviceSubscription()).resolves.toEqual({ ok: true });

    expect(device.initial?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(device.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const posts = browser.fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(posts.at(-1)).toMatchObject({ endpoint: NEW_ENDPOINT });
    expect(browser.localStorage.getItem(REMEMBERED_ENDPOINT_KEY)).toBe(NEW_ENDPOINT);
    // Permission is already granted, so replacing never prompts again.
    expect(Notification.permission).toBe('granted');
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports subscribe_threw when the old subscription cannot be dropped', async () => {
    const previous = fakeSubscription('https://push.example/other-account');
    previous.unsubscribe = vi.fn(async () => {
      throw new Error('unsubscribe failed');
    });
    const browser = stubBrowser({ permission: 'granted', existingSubscription: previous });
    const push = await loadPushClient();

    await expect(push.replaceDeviceSubscription()).resolves.toEqual({
      ok: false,
      reason: 'subscribe_threw',
    });
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(browser.fetchMock).not.toHaveBeenCalled();
  });
});

describe('healPushSubscriptionIfOrphaned', () => {
  it('reports failed for a rejected registration and heals on the retry', async () => {
    let postStatus = 500;
    const browser = stubBrowser({
      permission: 'granted',
      fetchImpl: async (_input, init) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ ok: true }), { status: postStatus })
          : new Response(JSON.stringify({ active: false }), { status: 200 }),
    });
    const push = await loadPushClient();
    const subscription = fakeSubscription() as unknown as PushSubscription;

    await expect(push.healPushSubscriptionIfOrphaned(subscription)).resolves.toBe('failed');
    expect(browser.localStorage.store.has(REMEMBERED_ENDPOINT_KEY)).toBe(false);

    postStatus = 200;
    await expect(push.healPushSubscriptionIfOrphaned(subscription)).resolves.toBe('healed');
    expect(browser.localStorage.getItem(REMEMBERED_ENDPOINT_KEY)).toBe(ENDPOINT);
  });

  it('reports failed when the ownership lookup itself fails', async () => {
    const browser = stubBrowser({
      permission: 'granted',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    const push = await loadPushClient();

    await expect(
      push.healPushSubscriptionIfOrphaned(fakeSubscription() as unknown as PushSubscription),
    ).resolves.toBe('failed');
    expect(browser.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports not_needed without writing when the row is already active', async () => {
    const browser = stubBrowser({
      permission: 'granted',
      fetchImpl: async () => new Response(JSON.stringify({ active: true }), { status: 200 }),
    });
    const push = await loadPushClient();

    await expect(
      push.healPushSubscriptionIfOrphaned(fakeSubscription() as unknown as PushSubscription),
    ).resolves.toBe('not_needed');
    expect(browser.fetchMock).toHaveBeenCalledTimes(1);
    expect(browser.localStorage.store.has(REMEMBERED_ENDPOINT_KEY)).toBe(false);
  });
});

describe('revokeDeviceOnLogout', () => {
  it('resolves after the timeout even when the revocation request hangs', async () => {
    stubBrowser({
      permission: 'granted',
      fetchImpl: () => new Promise(() => {}),
    });
    const push = await loadPushClient();

    const startedAt = Date.now();
    await expect(push.revokeDeviceOnLogout(50)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('leaves the browser subscription alone when another account owns this device', async () => {
    const subscription = fakeSubscription();
    const browser = stubBrowser({
      permission: 'granted',
      existingSubscription: subscription,
      fetchImpl: async () =>
        new Response(JSON.stringify({ active: false }), { status: 200 }),
    });
    browser.localStorage.store.set(REMEMBERED_ENDPOINT_KEY, ENDPOINT);
    const push = await loadPushClient();

    await push.revokeDeviceOnLogout(1_000);

    // The DELETE is scoped to the logging-out restaurant, so it would no-op
    // while the browser unsubscribe would cut the other account's alerts.
    expect(browser.fetchMock).toHaveBeenCalledWith(
      `/api/push/subscribe?endpoint=${encodeURIComponent(ENDPOINT)}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(browser.fetchMock).not.toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(browser.localStorage.getItem(REMEMBERED_ENDPOINT_KEY)).toBe(ENDPOINT);
  });

  it('revokes the server row and browser subscription when this account owns them', async () => {
    const subscription = fakeSubscription();
    const browser = stubBrowser({
      permission: 'granted',
      existingSubscription: subscription,
      fetchImpl: async (_input, init) =>
        init?.method === 'GET'
          ? new Response(JSON.stringify({ active: true }), { status: 200 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    browser.localStorage.store.set('ratetap_push_endpoint', ENDPOINT);
    const push = await loadPushClient();

    await push.revokeDeviceOnLogout(1_000);

    expect(browser.fetchMock).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ endpoint: ENDPOINT, reason: 'user_unsubscribe' }),
      }),
    );
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    // The remembered endpoint is cleared so the next account starts clean.
    expect(browser.localStorage.store.has('ratetap_push_endpoint')).toBe(false);
  });
});
