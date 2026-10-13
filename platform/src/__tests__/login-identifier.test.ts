/**
 * Login resolves a free-text identifier (slug, name or manager email) on the
 * server; there is no public account list. Covers the login route, the
 * forgot-password route, the resolver's tier order and the removed endpoint.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: number;
  name: string;
  slug: string;
  managerEmail: string | null;
  adminPasswordHash: string | null;
  isOwner: boolean;
  isRegional: boolean;
  region: string | null;
};

function row(over: Partial<Row> & { slug: string }): Row {
  return {
    id: 1,
    name: over.slug,
    managerEmail: null,
    adminPasswordHash: `h:pw-${over.slug}`,
    isOwner: false,
    isRegional: false,
    region: null,
    ...over,
  };
}

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(async (_id: string) => [] as unknown[]),
  createSession: vi.fn(async () => undefined),
  sendReset: vi.fn(async () => undefined),
  resetToken: vi.fn(async (_slug: string) => 'tok' as string | null),
  dbUpdates: [] as unknown[],
  selectQueue: [] as unknown[][],
  whereCalls: 0,
  queryLog: [] as Array<{ condition: unknown; orderBy: unknown; limit: number | null }>,
}));

vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  findLoginCandidates: mocks.candidates,
}));
vi.mock('@/lib/auth', () => ({
  // Test hashes look like `h:<password>`; the dummy timing hash never matches.
  // `legacy-<pw>` stands in for an old colon-less SHA-256 hash.
  verifyPassword: vi.fn(
    async (plain: string, stored: string) => stored === `h:${plain}` || stored === `legacy-${plain}`,
  ),
  hashPassword: vi.fn(async () => 'upgraded'),
}));
vi.mock('@/lib/session', () => ({ createSession: mocks.createSession }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: () => null }));
vi.mock('@/lib/reset-token', () => ({ generateResetToken: mocks.resetToken }));
vi.mock('@/lib/email', () => ({ sendPasswordResetEmail: mocks.sendReset }));
vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        mocks.dbUpdates.push(v);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          mocks.whereCalls++;
          mocks.queryLog.push({ condition, orderBy: null, limit: null });
          const entry = mocks.queryLog[mocks.queryLog.length - 1];
          const done = {
            limit: vi.fn(async (n: number) => {
              entry.limit = n;
              return mocks.selectQueue.shift() ?? [];
            }),
          };
          return {
            ...done,
            orderBy: vi.fn((col: unknown) => {
              entry.orderBy = col;
              return done;
            }),
          };
        }),
      })),
    })),
  },
}));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { normalizeLoginName } from '@/lib/queries';
import { restaurants } from '@/db/schema';
import { t } from '@/lib/i18n';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const render = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);
const paramsOf = (condition: unknown) => render(condition).params;
/** Which resolver tier a rendered WHERE clause belongs to. */
function tierOf(condition: unknown): 'slug' | 'name' | 'email' {
  const text = render(condition).sql;
  if (text.includes('manager_email')) return 'email';
  if (text.includes('translate(')) return 'name';
  return 'slug';
}

// The route tests mock findLoginCandidates; the resolver tests need the real one.
const realResolver = () =>
  vi.importActual<typeof import('@/lib/queries')>('@/lib/queries').then((m) => m.findLoginCandidates);

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const doLogin = (body: unknown) => login(post('/api/auth/login', body));
const doForgot = (body: unknown) => forgot(post('/api/auth/forgot-password', body));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbUpdates.length = 0;
  mocks.selectQueue.length = 0;
  mocks.whereCalls = 0;
  mocks.queryLog.length = 0;
  mocks.candidates.mockImplementation(async () => []);
});

describe('login route', () => {
  it('logs in with an identifier and creates the session for the matched slug', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'estancia-leon' })]);
    const res = await doLogin({ identifier: 'La Estancia León', password: 'pw-estancia-leon' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slug: 'estancia-leon', role: 'gm' });
    expect(mocks.candidates).toHaveBeenCalledWith('La Estancia León');
    expect(mocks.createSession).toHaveBeenCalledWith('estancia-leon', 'gm', undefined);
  });

  it('keeps the owner and regional roles and region', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'owner', isOwner: true })]);
    expect((await (await doLogin({ identifier: 'owner', password: 'pw-owner' })).json()).role).toBe('owner');

    mocks.candidates.mockResolvedValue([row({ slug: 'reg-norte', isRegional: true, region: 'norte' })]);
    const res = await doLogin({ identifier: 'reg-norte', password: 'pw-reg-norte' });
    expect((await res.json()).role).toBe('regional');
    expect(mocks.createSession).toHaveBeenLastCalledWith('reg-norte', 'regional', 'norte');
  });

  it('ambiguous email: logs in when exactly one account accepts the password', async () => {
    mocks.candidates.mockResolvedValue([
      row({ id: 1, slug: 'a', managerEmail: 'x@y.mx', adminPasswordHash: 'h:shared-a' }),
      row({ id: 2, slug: 'b', managerEmail: 'x@y.mx', adminPasswordHash: 'h:shared-b' }),
    ]);
    const res = await doLogin({ identifier: 'X@Y.mx', password: 'shared-b' });
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe('b');
  });

  it('ambiguous email: several or no password matches give the generic error', async () => {
    mocks.candidates.mockResolvedValue([
      row({ id: 1, slug: 'a', adminPasswordHash: 'h:same' }),
      row({ id: 2, slug: 'b', adminPasswordHash: 'h:same' }),
    ]);
    const both = await doLogin({ identifier: 'x@y.mx', password: 'same' });
    const none = await doLogin({ identifier: 'x@y.mx', password: 'other' });
    for (const res of [both, none]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Credenciales inválidas' });
    }
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('unknown identifier, wrong password and unset password return the same status and body', async () => {
    mocks.candidates.mockResolvedValue([]);
    const unknown = await doLogin({ identifier: 'nope', password: 'x' });

    mocks.candidates.mockResolvedValue([row({ slug: 'real' })]);
    const wrong = await doLogin({ identifier: 'real', password: 'bad' });

    mocks.candidates.mockResolvedValue([row({ slug: 'nopw', adminPasswordHash: null })]);
    const unset = await doLogin({ identifier: 'nopw', password: 'x' });

    const bodies = await Promise.all([unknown, wrong, unset].map((r) => r.json()));
    expect([unknown.status, wrong.status, unset.status]).toEqual([401, 401, 401]);
    expect(bodies).toEqual([
      { error: 'Credenciales inválidas' },
      { error: 'Credenciales inválidas' },
      { error: 'Credenciales inválidas' },
    ]);
  });

  it('still accepts the legacy { slug, password } body', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'estancia-leon' })]);
    const res = await doLogin({ slug: 'estancia-leon', password: 'pw-estancia-leon' });
    expect(res.status).toBe(200);
    expect(mocks.candidates).toHaveBeenCalledWith('estancia-leon');
  });

  it('rejects a missing identifier or password with 400', async () => {
    expect((await doLogin({ password: 'x' })).status).toBe(400);
    expect((await doLogin({ identifier: '  ', password: 'x' })).status).toBe(400);
    expect((await doLogin({ identifier: 'a' })).status).toBe(400);
  });

  it('upgrades a legacy SHA-256 hash after a successful login', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'old', adminPasswordHash: 'legacy-pw-old' })]);
    expect((await doLogin({ identifier: 'old', password: 'pw-old' })).status).toBe(200);
    expect(mocks.dbUpdates).toEqual([{ adminPasswordHash: 'upgraded' }]);
  });
});

describe('forgot-password route', () => {
  it('returns an identical response for an existing and a non-existing account', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'real', name: 'Real', managerEmail: 'm@real.mx' })]);
    const existing = await doForgot({ identifier: 'real' });
    expect(mocks.sendReset).toHaveBeenCalledTimes(1);
    expect(mocks.sendReset).toHaveBeenCalledWith(expect.objectContaining({ to: 'm@real.mx', restaurantName: 'Real' }));

    mocks.candidates.mockResolvedValue([]);
    const missing = await doForgot({ identifier: 'ghost' });
    expect(mocks.sendReset).toHaveBeenCalledTimes(1);

    expect(existing.status).toBe(missing.status);
    expect(await existing.json()).toEqual(await missing.json());
    expect(await (await doForgot({ identifier: 'ghost' })).json()).toEqual({
      ok: true,
      message: 'Si la cuenta existe, te enviamos un correo.',
    });
  });

  it('is identical when the account exists but has no manager email, and for the legacy slug body', async () => {
    mocks.candidates.mockResolvedValue([row({ slug: 'noemail', managerEmail: null })]);
    const res = await doForgot({ slug: 'noemail' });
    expect(res.status).toBe(200);
    expect(mocks.sendReset).not.toHaveBeenCalled();
    expect((await res.json()).message).toBe('Si la cuenta existe, te enviamos un correo.');
  });
});

describe('findLoginCandidates', () => {
  it('normalizes names: case, accents, ñ and extra whitespace', () => {
    expect(normalizeLoginName('  La  ESTANCIA León ')).toBe('la estancia leon');
    expect(normalizeLoginName('Peña Ñandú Güero')).toBe('pena nandu guero');
  });

  it('returns the first non-empty tier: slug, then name, then email', async () => {
    const findLoginCandidates = await realResolver();
    mocks.selectQueue.push([{ slug: 'by-slug' }]);
    expect(await findLoginCandidates('x')).toEqual([{ slug: 'by-slug' }]);
    expect(mocks.whereCalls).toBe(1);

    mocks.whereCalls = 0;
    mocks.selectQueue.push([], [{ slug: 'by-name' }]);
    expect(await findLoginCandidates('x')).toEqual([{ slug: 'by-name' }]);
    expect(mocks.whereCalls).toBe(2);

    mocks.whereCalls = 0;
    mocks.selectQueue.push([], [], [{ slug: 'by-email' }]);
    expect(await findLoginCandidates('a@b.mx')).toEqual([{ slug: 'by-email' }]);
    expect(mocks.whereCalls).toBe(3);
  });

  it('orders every tier by id ascending before the LIMIT 10 cap', async () => {
    const findLoginCandidates = await realResolver();
    mocks.selectQueue.push([], [], [{ slug: 'by-email' }]);
    await findLoginCandidates('x');
    expect(mocks.queryLog.map((q) => tierOf(q.condition))).toEqual(['slug', 'name', 'email']);
    for (const q of mocks.queryLog) {
      expect(q.orderBy).toBe(restaurants.id);
      expect(q.limit).toBe(10);
    }
  });

  it('an "@" identifier checks the email tier first, even when a business name equals it', async () => {
    const findLoginCandidates = await realResolver();
    // Email tier answers first; a restaurant named like the email never gets queried.
    mocks.selectQueue.push([{ slug: 'by-email' }], [{ slug: 'named-like-email' }]);
    expect(await findLoginCandidates('Juan@Grupo.mx')).toEqual([{ slug: 'by-email' }]);
    expect(mocks.queryLog.map((q) => tierOf(q.condition))).toEqual(['email']);
    expect(paramsOf(mocks.queryLog[0].condition)).toEqual(['juan@grupo.mx']);
  });

  it('an "@" identifier falls back to slug, then name, when no email matches', async () => {
    const findLoginCandidates = await realResolver();
    mocks.selectQueue.push([], [], [{ slug: 'by-name' }]);
    expect(await findLoginCandidates('a@b.mx')).toEqual([{ slug: 'by-name' }]);
    expect(mocks.queryLog.map((q) => tierOf(q.condition))).toEqual(['email', 'slug', 'name']);
    for (const q of mocks.queryLog) expect(q.orderBy).toBe(restaurants.id);
  });

  it('an identifier without "@" keeps slug, name, email order', async () => {
    const findLoginCandidates = await realResolver();
    await findLoginCandidates('estancia leon');
    expect(mocks.queryLog.map((q) => tierOf(q.condition))).toEqual(['slug', 'name', 'email']);
  });

  it('returns nothing and runs no query for a blank identifier', async () => {
    expect(await (await realResolver())('   ')).toEqual([]);
    expect(mocks.whereCalls).toBe(0);
  });
});

describe('login copy', () => {
  it('the placeholder example resolves in prod: stored name is "Estancia Leon"', () => {
    expect(t.login.restaurantPlaceholder).toMatch(/Estancia León/);
    expect(t.login.restaurantPlaceholder).not.toMatch(/La Estancia/);
    expect(normalizeLoginName('Estancia León')).toBe(normalizeLoginName('Estancia Leon'));
  });
});

describe('public restaurant list', () => {
  it('the /api/auth/restaurants route no longer exists', () => {
    expect(existsSync(join(process.cwd(), 'src/app/api/auth/restaurants/route.ts'))).toBe(false);
  });
});
