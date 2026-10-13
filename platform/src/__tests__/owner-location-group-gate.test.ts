/**
 * An owner session may read another location by slug only inside its own
 * group. A NULL-group location (self-serve trial) is a different island, and an
 * owner with a NULL group_key reaches no other location (SQ-186).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  session: { slug: 'owner', role: 'owner' } as { slug: string; role: string },
  viewerGroup: 'grupo-estancia' as string | null,
  targetGroup: null as string | null,
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ verifySession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/queries', () => ({
  getGroupKeyBySlug: vi.fn(async () => mocks.viewerGroup),
  getRestaurantBySlug: vi.fn(async (slug: string) => ({
    id: 5,
    slug,
    name: slug,
    groupKey: mocks.targetGroup,
  })),
  getStaffList: vi.fn(async () => [{ id: 1, name: 'Ana' }]),
  getLeaderboard: vi.fn(async () => []),
  getWeeklyStats: vi.fn(async () => ({})),
  getRecentFeedback: vi.fn(async () => []),
}));

import { GET as staffGET } from '@/app/api/staff/route';
import { GET as dashboardGET } from '@/app/api/reviews/dashboard/route';

const call = (handler: typeof staffGET, slug: string) =>
  handler(new NextRequest(`http://localhost/api/x?restaurant=${slug}`));

describe.each([
  ['GET /api/staff', staffGET],
  ['GET /api/reviews/dashboard', dashboardGET],
])('%s owner group gate', (_name, handler) => {
  beforeEach(() => {
    mocks.session = { slug: 'owner', role: 'owner' };
    mocks.viewerGroup = 'grupo-estancia';
    mocks.targetGroup = 'grupo-estancia';
  });

  it('lets the owner read a location of its own group', async () => {
    expect((await call(handler, 'estancia-leon')).status).toBe(200);
  });

  it('refuses a self-serve (NULL-group) location', async () => {
    mocks.targetGroup = null;
    expect((await call(handler, 'cocteles-chelita')).status).toBe(403);
  });

  it('refuses a location of a different group', async () => {
    mocks.targetGroup = 'otro-grupo';
    expect((await call(handler, 'otro')).status).toBe(403);
  });

  it('refuses every other location to an owner with a NULL group_key', async () => {
    mocks.viewerGroup = null;
    mocks.targetGroup = null;
    expect((await call(handler, 'cocteles-chelita')).status).toBe(403);
    mocks.targetGroup = 'grupo-estancia';
    expect((await call(handler, 'estancia-leon')).status).toBe(403);
  });

  it('still lets a location read its own data whatever its group', async () => {
    mocks.session = { slug: 'cocteles-chelita', role: 'gm' };
    mocks.targetGroup = null;
    expect((await call(handler, 'cocteles-chelita')).status).toBe(200);
  });
});
