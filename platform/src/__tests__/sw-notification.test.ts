import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type WaitableEvent = { waitUntil: (promise: Promise<unknown>) => void };
type WorkerHarness = ReturnType<typeof loadWorker>;

function loadWorker() {
  const handlers = new Map<string, (event: never) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const matchAll = vi.fn(() => Promise.resolve([]));
  const openWindow = vi.fn(() => Promise.resolve());
  const fetch = vi.fn(() => Promise.resolve());
  const self = {
    addEventListener: (name: string, handler: (event: never) => void) => handlers.set(name, handler),
    registration: { showNotification },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  const clients = { matchAll, openWindow };
  const source = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');

  new Function('self', 'clients', 'fetch', source)(self, clients, fetch);

  return { handlers, showNotification, matchAll, openWindow, fetch };
}

function dispatchPush(worker: WorkerHarness, payload: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  worker.handlers.get('push')?.({
    data: { json: () => payload, text: () => JSON.stringify(payload) },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  } as never);
  return Promise.all(waits);
}

function dispatchClick(
  worker: WorkerHarness,
  data: Record<string, unknown>,
  action = '',
) {
  const waits: Promise<unknown>[] = [];
  const close = vi.fn();
  worker.handlers.get('notificationclick')?.({
    action,
    notification: { data, close },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  } as never);
  return { close, settled: Promise.all(waits) };
}

describe('service worker notification handling', () => {
  it('adds the acknowledge action and keeps low-review notifications visible', async () => {
    const worker = loadWorker();

    await dispatchPush(worker, {
      title: 'Atención requerida',
      kind: 'low_review',
      rid: 42,
      nid: 99,
      url: '/inbox?rid=42',
    });

    expect(worker.showNotification).toHaveBeenCalledWith(
      'Atención requerida',
      expect.objectContaining({
        actions: [{ action: 'acknowledge', title: 'Lo atiendo' }],
        requireInteraction: true,
        data: expect.objectContaining({ rid: 42 }),
      }),
    );
  });

  it('does not add actions to positive-review notifications', async () => {
    const worker = loadWorker();

    await dispatchPush(worker, { kind: 'positive_review', rid: 42, url: '/dashboard' });

    expect(worker.showNotification).toHaveBeenCalledWith(
      'RateTap',
      expect.not.objectContaining({ actions: expect.anything() }),
    );
  });

  it('posts the shown event after displaying the notification', async () => {
    const worker = loadWorker();

    await dispatchPush(worker, { kind: 'low_review', rid: 42, nid: 99, url: '/inbox?rid=42' });

    expect(worker.fetch).toHaveBeenCalledWith('/api/analytics/track', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            name: 'push_notification_shown',
            path: '/inbox?rid=42',
            properties: { nid: 99, kind: 'low_review', rid: 42 },
          },
        ],
      }),
    });
    expect(worker.showNotification.mock.invocationCallOrder[0]).toBeLessThan(
      worker.fetch.mock.invocationCallOrder[0],
    );
  });

  it('acknowledges from the action without opening a window', async () => {
    const worker = loadWorker();
    const click = dispatchClick(
      worker,
      { url: '/inbox?rid=42', nid: 99, kind: 'low_review', rid: 42 },
      'acknowledge',
    );

    await click.settled;

    expect(click.close).toHaveBeenCalledOnce();
    expect(worker.fetch).toHaveBeenCalledWith('/api/auth/feedback', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: 42, status: 'reviewed', reviewedVia: 'push_action' }),
    });
    expect(worker.fetch).toHaveBeenCalledWith('/api/analytics/track', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            name: 'push_notification_click',
            path: '/inbox?rid=42',
            properties: { nid: 99, kind: 'low_review', action: 'acknowledge' },
          },
        ],
      }),
    });
    expect(worker.matchAll).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it('opens the notification URL for a plain click', async () => {
    const worker = loadWorker();
    const click = dispatchClick(worker, { url: '/inbox?rid=42', nid: 99, kind: 'low_review', rid: 42 });

    await click.settled;

    expect(click.close).toHaveBeenCalledOnce();
    expect(worker.openWindow).toHaveBeenCalledWith('/inbox?rid=42');
  });
});
