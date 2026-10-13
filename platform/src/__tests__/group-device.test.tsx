/**
 * Grupo Estancia keeps the restaurant dropdown on devices it already uses, via
 * the signed `rt_group` marker; everyone else gets the text field, and no route
 * or page returns an account list without a valid marker.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Account = { name: string; slug: string; groupKey: string | null };

const FIXTURE: Account[] = [
  { name: 'La Estancia Zeta', slug: 'estancia-zeta', groupKey: 'grupo-estancia' },
  { name: 'Dueño Grupo', slug: 'owner', groupKey: 'grupo-estancia' },
  { name: 'La Estancia Alfa', slug: 'estancia-alfa', groupKey: 'grupo-estancia' },
  { name: 'Otro Grupo Norte', slug: 'otro-norte', groupKey: 'otro-grupo' },
  { name: 'Tacos Prueba', slug: 'tacos-trial', groupKey: null },
];

const mocks = vi.hoisted(() => ({
  jar: new Map<string, { value: string; opts?: Record<string, unknown> }>(),
  candidates: vi.fn(async (_id: string) => [] as unknown[]),
  listCalls: [] as string[],
  selectLog: [] as Array<{ condition: unknown; orderBy: unknown }>,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name)!.value } : undefined),
    has: (name: string) => mocks.jar.has(name),
    set: (name: string, value: string, opts?: Record<string, unknown>) => {
      mocks.jar.set(name, { value, opts });
    },
    delete: (name: string) => {
      mocks.jar.delete(name);
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  findLoginCandidates: mocks.candidates,
  getGroupKeyBySlug: vi.fn(async (slug: string) => FIXTURE.find((a) => a.slug === slug)?.groupKey ?? null),
  getRestaurantBySlug: vi.fn(async (slug: string) => {
    const a = FIXTURE.find((x) => x.slug === slug);
    return a ? { ...a, subscriptionStatus: 'active', billingProvider: null } : null;
  }),
  getNewFeedbackCount: vi.fn(async () => 0),
  listGroupAccounts: vi.fn(async (groupKey: string) => {
    mocks.listCalls.push(groupKey);
    return FIXTURE.filter((a) => a.groupKey === groupKey)
      .map(({ name, slug }) => ({ name, slug }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),
}));
vi.mock('@/lib/auth', () => ({
  verifyPassword: vi.fn(async (plain: string, stored: string) => stored === `h:${plain}`),
  hashPassword: vi.fn(async () => 'upgraded'),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: () => null }));
vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => ({
          orderBy: vi.fn(async (col: unknown) => {
            mocks.selectLog.push({ condition, orderBy: col });
            return [];
          }),
        })),
      })),
    })),
  },
}));
vi.mock('@/components/dashboard/DashboardShell', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SubscriptionBlocked', () => ({ default: () => null }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import LoginPage from '@/app/login/page';
import ForgotPasswordPage from '@/app/forgot-password/page';
import GroupDeviceMarker from '@/app/login/GroupDeviceMarker';
import { markGroupDevice } from '@/app/login/mark-group-device';
import AppLayout from '@/app/(app)/layout';
import { GROUP_COOKIE, signGroupMarker, verifyGroupMarker } from '@/lib/group-device';
import { createSession } from '@/lib/session';
import { restaurants } from '@/db/schema';

const SRC = join(__dirname, '..');

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-session-secret';
});

beforeEach(() => {
  mocks.jar.clear();
  mocks.listCalls.length = 0;
  mocks.selectLog.length = 0;
  mocks.candidates.mockReset();
});

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const row = (slug: string) => {
  const a = FIXTURE.find((x) => x.slug === slug)!;
  return {
    id: 1,
    name: a.name,
    slug,
    groupKey: a.groupKey,
    managerEmail: null,
    adminPasswordHash: `h:pw-${slug}`,
    isOwner: false,
    isRegional: false,
    region: null,
  };
};

async function markedJar(groupKey = 'grupo-estancia') {
  mocks.jar.set(GROUP_COOKIE, { value: await signGroupMarker(groupKey) });
}

async function loginHtml() {
  return renderToStaticMarkup((await LoginPage()) as ReactElement);
}
async function forgotHtml() {
  return renderToStaticMarkup((await ForgotPasswordPage()) as ReactElement);
}
const optionLabels = (html: string) =>
  [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}|${m[2]}`);

describe('login dropdown', () => {
  it('a valid marker shows the original dropdown with exactly that group, ordered by name', async () => {
    await markedJar();
    const html = await loginHtml();
    expect(html).toContain('<select');
    expect(html).not.toContain('type="text"');
    expect(optionLabels(html)).toEqual([
      '|Selecciona tu restaurante',
      'owner|Dueño Grupo',
      'estancia-alfa|La Estancia Alfa',
      'estancia-zeta|La Estancia Zeta',
    ]);
    // No trial, no other group.
    expect(html).not.toContain('Tacos Prueba');
    expect(html).not.toContain('Otro Grupo Norte');
    expect(mocks.listCalls).toEqual(['grupo-estancia']);
    expect(html).toContain('¿No está tu restaurante? Escribe tu nombre o correo');
  });

  it('the dropdown queries one group, ordered by name', async () => {
    const { listGroupAccounts } = await vi.importActual<typeof import('@/lib/queries')>('@/lib/queries');
    await listGroupAccounts('grupo-estancia');
    expect(mocks.selectLog).toHaveLength(1);
    const rendered = new PgDialect().sqlToQuery(mocks.selectLog[0].condition as SQL);
    expect(rendered.sql).toContain('group_key');
    expect(rendered.params).toEqual(['grupo-estancia']);
    expect(mocks.selectLog[0].orderBy).toBe(restaurants.name);
    await listGroupAccounts('');
    expect(mocks.selectLog).toHaveLength(1);
  });

  it('no marker, a tampered marker or a forged marker gets the text field and no list', async () => {
    const good = await signGroupMarker('grupo-estancia');
    const [key, sig] = [good.slice(0, good.lastIndexOf(':')), good.slice(good.lastIndexOf(':') + 1)];
    const attempts: Array<string | null> = [
      null,
      'grupo-estancia:deadbeef',
      'grupo-estancia',
      ':' + sig,
      `otro-grupo:${sig}`, // valid signature of another key moved onto a different group
      `${key}:${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`, // one flipped signature character
      await signGroupMarker('otro-grupo').then((v) => v.replace('otro-grupo', 'grupo-estancia')),
    ];
    for (const value of attempts) {
      mocks.jar.clear();
      if (value !== null) mocks.jar.set(GROUP_COOKIE, { value });
      for (const html of [await loginHtml(), await forgotHtml()]) {
        expect(html).toContain('type="text"');
        expect(html).not.toContain('<select');
        expect(html).not.toContain('La Estancia');
      }
    }
    expect(mocks.listCalls).toEqual([]);
  });

  it('forgot-password uses the same rule', async () => {
    await markedJar();
    const html = await forgotHtml();
    expect(html).toContain('<select');
    expect(html).toContain('La Estancia Alfa');
    expect(html).not.toContain('Tacos Prueba');
  });

  it('verifyGroupMarker round-trips a signed key and rejects garbage', async () => {
    expect(await verifyGroupMarker(await signGroupMarker('grupo-estancia'))).toBe('grupo-estancia');
    expect(await verifyGroupMarker(undefined)).toBeNull();
    expect(await verifyGroupMarker('nonsense')).toBeNull();
  });
});

describe('marker is set on login', () => {
  it('a group account login sets the signed marker with the pinned cookie options', async () => {
    mocks.candidates.mockResolvedValue([row('estancia-alfa')]);
    const res = await login(post('/api/auth/login', { identifier: 'La Estancia Alfa', password: 'pw-estancia-alfa' }));
    expect(res.status).toBe(200);
    const cookie = mocks.jar.get(GROUP_COOKIE);
    expect(await verifyGroupMarker(cookie?.value)).toBe('grupo-estancia');
    expect(cookie?.opts).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it('the dropdown submit ({ slug, password }) logs in and marks the device', async () => {
    mocks.candidates.mockResolvedValue([row('owner')]);
    const res = await login(post('/api/auth/login', { slug: 'owner', password: 'pw-owner' }));
    expect(res.status).toBe(200);
    expect(mocks.candidates).toHaveBeenCalledWith('owner');
    expect(await verifyGroupMarker(mocks.jar.get(GROUP_COOKIE)?.value)).toBe('grupo-estancia');
  });

  it('a self-serve trial login does not set a marker', async () => {
    mocks.candidates.mockResolvedValue([row('tacos-trial')]);
    const res = await login(post('/api/auth/login', { identifier: 'tacos prueba', password: 'pw-tacos-trial' }));
    expect(res.status).toBe(200);
    expect(mocks.jar.has(GROUP_COOKIE)).toBe(false);
  });

  it('a failed login sets no marker', async () => {
    mocks.candidates.mockResolvedValue([row('estancia-alfa')]);
    const res = await login(post('/api/auth/login', { identifier: 'x', password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(mocks.jar.has(GROUP_COOKIE)).toBe(false);
  });
});

describe('already logged-in devices', () => {
  const hasMarkerComponent = (node: ReactNode): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(hasMarkerComponent);
    const el = node as ReactElement<{ children?: ReactNode }>;
    return el.type === GroupDeviceMarker || hasMarkerComponent(el.props?.children);
  };

  it('the app layout asks for the marker only for a group session without a valid one', async () => {
    await createSession('estancia-alfa', 'gm');
    expect(hasMarkerComponent(await AppLayout({ children: null }))).toBe(true);

    await markedJar();
    expect(hasMarkerComponent(await AppLayout({ children: null }))).toBe(false);

    mocks.jar.delete(GROUP_COOKIE);
    mocks.jar.set(GROUP_COOKIE, { value: 'grupo-estancia:forged' });
    expect(hasMarkerComponent(await AppLayout({ children: null }))).toBe(true);
  });

  it('the app layout never asks for a marker for a trial (no group_key)', async () => {
    await createSession('tacos-trial', 'gm');
    expect(hasMarkerComponent(await AppLayout({ children: null }))).toBe(false);
  });

  it('markGroupDevice marks a logged-in group account, once', async () => {
    await createSession('estancia-alfa', 'gm');
    await markGroupDevice();
    expect(await verifyGroupMarker(mocks.jar.get(GROUP_COOKIE)?.value)).toBe('grupo-estancia');
    const first = mocks.jar.get(GROUP_COOKIE);
    await markGroupDevice();
    expect(mocks.jar.get(GROUP_COOKIE)).toBe(first);
  });

  it('markGroupDevice does nothing without a session or for a trial', async () => {
    await markGroupDevice();
    expect(mocks.jar.has(GROUP_COOKIE)).toBe(false);
    await createSession('tacos-trial', 'gm');
    await markGroupDevice();
    expect(mocks.jar.has(GROUP_COOKIE)).toBe(false);
  });

  it('logout clears the session but keeps the marker', async () => {
    await createSession('estancia-alfa', 'gm');
    await markGroupDevice();
    expect(mocks.jar.has('ratetap_session')).toBe(true);
    const res = await logout(post('/api/auth/logout', {}));
    expect(res.status).toBe(200);
    expect(mocks.jar.has('ratetap_session')).toBe(false);
    expect(await verifyGroupMarker(mocks.jar.get(GROUP_COOKIE)?.value)).toBe('grupo-estancia');
  });
});

describe('no public account list', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  it('there is no list endpoint, and no API route reads the group accounts', () => {
    expect(existsSync(join(SRC, 'app/api/auth/restaurants'))).toBe(false);
    expect(existsSync(join(SRC, 'app/api/auth/group-accounts'))).toBe(false);
    for (const file of walk(join(SRC, 'app/api'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/listGroupAccounts|getKnownGroupAccounts/);
    }
  });

  it('only the two pages that check the marker first read the group accounts', () => {
    const users = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) => /getKnownGroupAccounts|listGroupAccounts/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(users).toEqual([
      'app/forgot-password/page.tsx',
      'app/login/page.tsx',
      'lib/group-device.ts',
      'lib/queries.ts',
    ]);
  });
});
