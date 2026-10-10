/**
 * RateTap-internal sales surfaces (/commercial-leads, /prospects, /prospects-us
 * and their APIs) must be reachable by RateTap staff only. 'owner' and
 * 'regional' are CUSTOMER roles (Grupo Estancia's owner account, every pilot
 * self-signup), so the gate is an explicit slug allowlist: RATETAP_STAFF_SLUGS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  verifySessionValue: vi.fn(),
  select: vi.fn(),
  selectDistinct: vi.fn(),
  update: vi.fn(),
}));

class NavSignal extends Error {
  constructor(public kind: 'notFound' | 'redirect', public to?: string) {
    super(`${kind}${to ? `:${to}` : ''}`);
  }
}

vi.mock('@/lib/session', () => ({
  verifySession: mocks.verifySession,
  verifySessionValue: mocks.verifySessionValue,
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new NavSignal('notFound'); },
  redirect: (to: string) => { throw new NavSignal('redirect', to); },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/overview',
}));
vi.mock('@/db', () => ({
  db: { select: mocks.select, selectDistinct: mocks.selectDistinct, update: mocks.update },
}));
vi.mock('@/lib/commercial-tracking', () => ({ trackCommercialEvent: vi.fn() }));

import { isRateTapStaff } from '../lib/admin';
import { PATCH as patchCommercialLead } from '../app/api/commercial-leads/[id]/route';
import { POST as postProspectStatus } from '../app/api/prospects/status/route';
import CommercialLeadsPage from '../app/(app)/commercial-leads/page';
import ProspectsPage from '../app/prospects/page';
import KeyWestProspectsPage from '../app/prospects-us/page';
import { middleware } from '../middleware';
import DashboardNav from '../components/dashboard/DashboardNav';

/** Thenable query-builder stand-in: any chained call returns itself, awaiting yields rows. */
function chain(rows: unknown[]) {
  const c: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown[]) => unknown) => resolve(rows) : () => c),
  });
  return c;
}

const staff = { slug: 'ratetap-staff', role: 'owner' as const };
const customerOwner = { slug: 'owner', role: 'owner' as const };
const pilotOwner = { slug: 'pilot-taqueria', role: 'owner' as const };
const regional = { slug: 'regional-central', role: 'regional' as const, region: 'central' };

const LEAD = { id: 7, status: 'new', contactedAt: null, nextActionAt: null, wonAt: null, lostAt: null };

beforeEach(() => {
  vi.stubEnv('RATETAP_STAFF_SLUGS', 'ratetap-staff');
  mocks.select.mockImplementation(() => chain([LEAD]));
  mocks.selectDistinct.mockImplementation(() => chain([]));
  mocks.update.mockImplementation(() => chain([{ ...LEAD, placeId: 'p1', status: 'sent' }]));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const leadPatch = () =>
  new NextRequest('http://localhost:3000/api/commercial-leads/7', {
    method: 'PATCH',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'called' }),
  });
const prospectPost = () =>
  new NextRequest('http://localhost:3000/api/prospects/status', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ placeId: 'p1', action: 'contacted' }),
  });
const ctx = { params: Promise.resolve({ id: '7' }) };

async function signal(fn: () => Promise<unknown>): Promise<NavSignal | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof NavSignal) return e;
    throw e;
  }
}

describe('isRateTapStaff', () => {
  it('denies everyone when RATETAP_STAFF_SLUGS is unset or empty', () => {
    vi.stubEnv('RATETAP_STAFF_SLUGS', '');
    expect(isRateTapStaff(staff)).toBe(false);
    vi.unstubAllEnvs();
    delete process.env.RATETAP_STAFF_SLUGS;
    expect(isRateTapStaff(staff)).toBe(false);
  });
  it('matches listed slugs only (trimmed, case-insensitive) and never a null session', () => {
    vi.stubEnv('RATETAP_STAFF_SLUGS', ' Ratetap-Staff , founder ');
    expect(isRateTapStaff({ slug: 'ratetap-staff' })).toBe(true);
    expect(isRateTapStaff({ slug: 'founder' })).toBe(true);
    expect(isRateTapStaff(customerOwner)).toBe(false);
    expect(isRateTapStaff(null)).toBe(false);
  });
});

describe('PATCH /api/commercial-leads/[id]', () => {
  it.each([['customer owner', customerOwner], ['pilot self-signup owner', pilotOwner], ['regional', regional]])(
    '%s gets 404 and never touches the database',
    async (_n, session) => {
      mocks.verifySession.mockResolvedValue(session);
      const res = await patchCommercialLead(leadPatch(), ctx);
      expect(res.status).toBe(404);
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it('unauthenticated gets 401', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect((await patchCommercialLead(leadPatch(), ctx)).status).toBe(401);
  });
  it('staff session updates the lead (200)', async () => {
    mocks.verifySession.mockResolvedValue(staff);
    const res = await patchCommercialLead(leadPatch(), ctx);
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });
  it('the owner role alone is no longer enough when the allowlist is unset', async () => {
    vi.stubEnv('RATETAP_STAFF_SLUGS', '');
    mocks.verifySession.mockResolvedValue(staff);
    expect((await patchCommercialLead(leadPatch(), ctx)).status).toBe(404);
  });
});

describe('POST /api/prospects/status', () => {
  it.each([['customer owner', customerOwner], ['pilot self-signup owner', pilotOwner], ['regional', regional]])(
    '%s gets 404 and never touches the database',
    async (_n, session) => {
      mocks.verifySession.mockResolvedValue(session);
      const res = await postProspectStatus(prospectPost());
      expect(res.status).toBe(404);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it('unauthenticated gets 401', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect((await postProspectStatus(prospectPost())).status).toBe(401);
  });
  it('staff session advances the prospect (200)', async () => {
    mocks.verifySession.mockResolvedValue(staff);
    const res = await postProspectStatus(prospectPost());
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });
});

describe.each([
  ['/commercial-leads page', () => CommercialLeadsPage()],
  ['/prospects page', () => ProspectsPage({ searchParams: Promise.resolve({}) })],
  ['/prospects-us page', () => KeyWestProspectsPage()],
])('%s', (_name, render) => {
  it.each([['customer owner', customerOwner], ['pilot self-signup owner', pilotOwner], ['regional', regional]])(
    '%s gets notFound() before any data is read',
    async (_n, session) => {
      mocks.verifySession.mockResolvedValue(session);
      expect(await signal(render)).toMatchObject({ kind: 'notFound' });
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.selectDistinct).not.toHaveBeenCalled();
    },
  );
  it('without a session redirects to /login', async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect(await signal(render)).toMatchObject({ kind: 'redirect', to: '/login' });
  });
  it('staff session renders (200)', async () => {
    mocks.verifySession.mockResolvedValue(staff);
    mocks.select.mockImplementation(() => chain([])); // empty tables: only the gate is under test
    await expect(render()).resolves.toBeTruthy();
    if (_name !== '/prospects-us page') expect(mocks.select).toHaveBeenCalled(); // staff really reaches the data
  });
});

describe('middleware', () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(`https://app.ratetapmx.com${path}`, cookie ? { headers: { cookie: `ratetap_session=${cookie}` } } : {});

  it.each(['/prospects-us', '/prospects', '/commercial-leads'])('%s without a session redirects to /login', async (path) => {
    const res = await middleware(req(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
  it.each(['/prospects-us', '/prospects', '/commercial-leads'])('%s returns 404 for customer owner and regional sessions', async (path) => {
    for (const session of [customerOwner, regional]) {
      mocks.verifySessionValue.mockResolvedValue(session);
      expect((await middleware(req(path, 'x'))).status).toBe(404);
    }
  });
  it.each(['/prospects-us', '/prospects', '/commercial-leads'])('%s passes through for a staff session', async (path) => {
    mocks.verifySessionValue.mockResolvedValue(staff);
    expect((await middleware(req(path, 'x'))).status).toBe(200);
  });
  it('customer-facing owner pages stay open to owner sessions', async () => {
    mocks.verifySessionValue.mockResolvedValue(customerOwner);
    for (const path of ['/overview', '/insights']) expect((await middleware(req(path, 'x'))).status).toBe(200);
  });
});

describe('DashboardNav', () => {
  const nav = (props: { isOwner?: boolean; isRegional?: boolean; isStaff?: boolean }) =>
    renderToStaticMarkup(<DashboardNav restaurantName="x" logoSrc="" logoDarkBg={false} {...props} />);

  it('never shows internal sales links to customer owner or regional sessions', () => {
    for (const html of [nav({ isOwner: true }), nav({ isOwner: true, isRegional: true }), nav({})]) {
      expect(html).not.toContain('/commercial-leads');
      expect(html).not.toContain('/prospects');
    }
  });
  it('shows them to staff and keeps the owner links', () => {
    const html = nav({ isOwner: true, isStaff: true });
    expect(html).toContain('/commercial-leads');
    expect(html).toContain('/prospects');
    expect(html).toContain('/overview');
    expect(html).toContain('/insights');
  });
});
