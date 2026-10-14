import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SQ-226: optional "¿Qué esperabas lograr?" free text after a goal chip.
 * POST /api/onboarding/expectation records `signup_expectation` once per
 * restaurant. Same guards as the goal route: gm session, same origin,
 * self-serve only.
 */

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  recordProductEvent: vi.fn(async () => undefined),
  existing: [] as Array<{ id: number }>,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.existing }),
      }),
    }),
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ has: () => false, delete: () => undefined }),
}));
vi.mock('@/lib/session', () => ({
  verifySession: mocks.verifySession,
  createSession: vi.fn(),
}));
vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));
vi.mock('@/lib/product-events', async (orig) => ({
  ...(await orig<typeof import('@/lib/product-events')>()),
  recordProductEvent: mocks.recordProductEvent,
}));

import { POST } from '../app/api/onboarding/expectation/route';
import { PRODUCT_EVENT_NAMES } from '@/lib/product-events';

const SOLO = { id: 7, slug: 'pizzeria-lupita', groupKey: null, teamMode: 'solo' };

function post(body: unknown, origin = 'http://localhost:3000') {
  return POST(
    new Request('http://localhost:3000/api/onboarding/expectation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.verifySession.mockReset();
  mocks.getRestaurantBySlug.mockReset();
  mocks.recordProductEvent.mockClear();
  mocks.existing = [];
  mocks.verifySession.mockResolvedValue({ role: 'gm', slug: 'pizzeria-lupita' });
  mocks.getRestaurantBySlug.mockResolvedValue(SOLO);
});

describe('signup_expectation event', () => {
  it('is a known product event name', () => {
    expect((PRODUCT_EVENT_NAMES as readonly string[]).includes('signup_expectation')).toBe(true);
  });
});

describe('POST /api/onboarding/expectation', () => {
  it('requires a gm session (401 without one, or for owner sessions)', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect((await post({ text: 'hola' })).status).toBe(401);
    mocks.verifySession.mockResolvedValue({ role: 'owner', slug: null });
    expect((await post({ text: 'hola' })).status).toBe(401);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin POST', async () => {
    const res = await post({ text: 'hola' }, 'https://evil.example');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('accepts exactly 280 characters and rejects 281', async () => {
    const ok = await post({ text: 'a'.repeat(280) });
    expect(ok.status).toBe(200);
    const tooLong = await post({ text: 'a'.repeat(281) });
    expect(tooLong.status).toBe(400);
    expect(mocks.recordProductEvent).toHaveBeenCalledTimes(1);
  });

  it('trims the text and rejects an empty answer', async () => {
    expect((await post({ text: '   ' })).status).toBe(400);
    expect((await post({ text: 'x' })).status).toBe(200);
    expect((await post({ text: '  salir primero  ' })).status).toBe(200);
    expect(mocks.recordProductEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ properties: { text: 'salir primero' } }),
    );
  });

  it('records signup_expectation with {text} for the session restaurant', async () => {
    const res = await post({ text: 'Ej. salir primero en Google Maps' });
    expect(res.status).toBe(200);
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'signup_expectation',
        restaurantId: 7,
        path: '/bienvenida',
        properties: { text: 'Ej. salir primero en Google Maps' },
      }),
    );
  });

  it('answers 409 on a second answer and records nothing', async () => {
    mocks.existing = [{ id: 99 }];
    const res = await post({ text: 'otra vez' });
    expect(res.status).toBe(409);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('refuses group members (not self-serve)', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({ ...SOLO, groupKey: 'estancia' });
    expect((await post({ text: 'hola' })).status).toBe(403);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });
});
