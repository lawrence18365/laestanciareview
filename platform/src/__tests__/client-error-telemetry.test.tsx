/**
 * Client-error telemetry.
 *
 * The /quotes outage (10-14 sep 2026) was invisible for four days because nothing
 * in production recorded a browser exception: global-error.tsx reported to Sentry,
 * and NEXT_PUBLIC_SENTRY_DSN is configured in no environment. These tests pin the
 * replacement — the payload it must carry, and the hard size budget imposed by
 * /api/analytics/track (2 KB of properties, dropped WHOLE when exceeded).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILD_SHA, trackClientError } from '@/lib/analytics-client';
import QuotesError from '@/app/(app)/quotes/error';

const MAX_PROPERTIES_BYTES = 2048; // mirrors src/app/api/analytics/track/route.ts

const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);

function stubBrowser(pathname: string, search = '') {
  // Node 24 defines window-less globals such as `navigator` as getter-only, so
  // both are installed with defineProperty rather than assignment.
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { pathname, search },
      sessionStorage: { getItem: () => 'sid-abc', setItem: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} },
      matchMedia: () => ({ matches: false }),
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { sendBeacon: beacon },
    configurable: true,
    writable: true,
  });
}

function payloadOf(callIndex = 0) {
  const [, body] = beacon.mock.calls[callIndex];
  return body.text().then((t) => JSON.parse(t));
}

beforeEach(() => {
  beacon.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('trackClientError', () => {
  it('carries name, message, stack, route, quote id, display mode and build sha', async () => {
    stubBrowser('/quotes/46');
    trackClientError(new Error('boom'), { boundary: 'quotes-segment' });

    const payload = await payloadOf();
    expect(payload.events).toHaveLength(1);
    const event = payload.events[0];
    expect(event.name).toBe('client_error');
    expect(event.path).toBe('/quotes/46');
    expect(event.display_mode).toBe('browser');
    expect(event.properties.boundary).toBe('quotes-segment');
    expect(event.properties.error_name).toBe('Error');
    expect(event.properties.error_message).toBe('boom');
    expect(event.properties.quote_id).toBe('46');
    expect(event.properties.stack).toContain('client-error-telemetry');
    expect(event.properties.build_sha).toBe(BUILD_SHA);
  });

  it('stays under the endpoint cap even with a 5 KB message and a 15 KB stack', async () => {
    stubBrowser('/quotes/46/print');
    const error = new Error('x'.repeat(5000));
    error.stack = `Error: x\n${'    at frame (/app/chunk.js:1:1)\n'.repeat(500)}`;
    trackClientError(error, { boundary: 'global' });

    const payload = await payloadOf();
    const properties = payload.events[0].properties;
    expect(JSON.stringify(properties).length).toBeLessThan(MAX_PROPERTIES_BYTES);
    // The point of truncating: the small, load-bearing fields survive.
    expect(properties.error_name).toBe('Error');
    expect(properties.error_message.length).toBeLessThanOrEqual(241);
    expect(properties.stack.length).toBeLessThanOrEqual(901);
  });

  it('omits the quote id when the route has none', async () => {
    stubBrowser('/dashboard');
    trackClientError(new Error('boom'));
    const payload = await payloadOf();
    expect(payload.events[0].properties.quote_id).toBeUndefined();
  });

  it('never throws, not even without a window or with an unserializable value', () => {
    expect(() => trackClientError(new Error('no window'))).not.toThrow();

    stubBrowser('/quotes');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => trackClientError(circular)).not.toThrow();
    expect(() => trackClientError(undefined)).not.toThrow();
    expect(() => trackClientError('a string')).not.toThrow();
  });

  it('drops any context key that is not whitelisted, so a caller cannot smuggle a secret', async () => {
    stubBrowser('/quotes');
    trackClientError(new Error('boom'), {
      boundary: 'global',
      cookie: 'ratetap_session=estancia-leon:gm:…',
      authorization: 'Bearer sk_live_123',
      body: '{"password":"hunter2"}',
      DATABASE_URL: 'postgresql://user:pw@host/db',
    });

    const payload = await payloadOf();
    const properties = payload.events[0].properties;
    const serialized = JSON.stringify(properties);
    expect(properties.boundary).toBe('global');
    for (const secret of ['hunter2', 'sk_live_123', 'postgresql://', 'ratetap_session=']) {
      expect(serialized).not.toContain(secret);
    }
    // The only free-form text is the error's own message and stack.
    expect(Object.keys(properties).sort()).toEqual(
      ['boundary', 'build_sha', 'error_message', 'error_name', 'stack'].sort(),
    );
  });
});

describe('/quotes error boundary', () => {
  it('renders a Spanish recovery screen with a retry and a way out', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const html = renderToStaticMarkup(<QuotesError error={error} reset={() => {}} />);

    expect(html).toContain('No se pudieron abrir las cotizaciones');
    expect(html).toContain('Intentar de nuevo');
    expect(html).toContain('/dashboard');
    expect(html).toContain('abc123');
    // Says what did NOT happen: after a crash the fear is data loss.
    expect(html).toContain('siguen en el sistema');
  });

  it('reports the error instead of hiding it', () => {
    const source = readFileSync(path.resolve(__dirname, '../app/(app)/quotes/error.tsx'), 'utf8');
    expect(source).toContain("trackClientError(error, { boundary: 'quotes-segment' })");
  });
});
