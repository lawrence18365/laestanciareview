/**
 * POST /api/restaurants sets group_key. An owner/regional session defaults to
 * its own group, resolved from the DB by slug, and cannot create into another
 * group. The admin key alone (no session) may pass groupKey explicitly.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  session: null as null | { slug: string; role: 'gm' | 'owner' | 'regional' },
  getGroupKeyBySlug: vi.fn(async (_slug: string) => 'grupo-estancia' as string | null),
}));

vi.mock('@/lib/auth', () => ({
  requireAdminKey: () => true,
  unauthorizedResponse: () => new Response(null, { status: 401 }),
  hashPassword: vi.fn(async () => 'hash'),
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => mocks.session),
}));

vi.mock('@/lib/queries', () => ({
  getGroupKeyBySlug: mocks.getGroupKeyBySlug,
}));

vi.mock('@/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.inserted.push(values);
        return { returning: vi.fn(async () => [{ id: 7, name: 'Nueva', slug: 'nueva' }]) };
      }),
    })),
  },
}));

import { POST } from '@/app/api/restaurants/route';

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nueva', slug: 'nueva', ...body }),
    }),
  );
}

describe('POST /api/restaurants group_key', () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.session = null;
    mocks.getGroupKeyBySlug.mockClear();
    mocks.getGroupKeyBySlug.mockResolvedValue('grupo-estancia');
  });

  it('defaults an owner session to its group, resolved from the DB', async () => {
    mocks.session = { slug: 'la-estancia-leon', role: 'owner' };
    const res = await post({});
    expect(res.status).toBe(201);
    expect(mocks.getGroupKeyBySlug).toHaveBeenCalledWith('la-estancia-leon');
    expect(mocks.inserted[0].groupKey).toBe('grupo-estancia');
  });

  it('refuses an owner session that names a different group', async () => {
    mocks.session = { slug: 'la-estancia-leon', role: 'owner' };
    const res = await post({ groupKey: 'otro-grupo' });
    expect(res.status).toBe(403);
    expect(mocks.inserted).toHaveLength(0);
  });

  it('lets an admin-key caller without a session set groupKey explicitly', async () => {
    const res = await post({ groupKey: 'grupo-estancia' });
    expect(res.status).toBe(201);
    expect(mocks.getGroupKeyBySlug).not.toHaveBeenCalled();
    expect(mocks.inserted[0].groupKey).toBe('grupo-estancia');
  });

  it('writes a NULL group_key when neither session nor groupKey is given', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect(mocks.inserted[0].groupKey).toBeNull();
  });
});
