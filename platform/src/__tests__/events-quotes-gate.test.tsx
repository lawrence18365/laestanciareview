/**
 * Quotes and event leads are La Estancia-only (hasEventsQuotes): the catalog in
 * lib/quote-data.ts is La Estancia's own menu. A non-Estancia GM gets no
 * Leads/Cotizaciones links, 404s on the pages and on the quote and manual-lead
 * APIs, and never touches the database. An Estancia GM passes the gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

class NavSignal extends Error {
  constructor(public kind: 'notFound' | 'redirect', public to?: string) {
    super(`${kind}${to ? `:${to}` : ''}`);
  }
}

vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new NavSignal('notFound'); },
  redirect: (to: string) => { throw new NavSignal('redirect', to); },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('@/db', () => ({
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.delete },
}));

import { hasEventsQuotes } from '../lib/brands';
import QuotesPage from '../app/(app)/quotes/page';
import NewQuotePage from '../app/(app)/quotes/new/page';
import EditQuotePage from '../app/(app)/quotes/[id]/page';
import LeadsPage from '../app/(app)/leads/page';
import { GET as listQuotes, POST as createQuote } from '../app/api/quotes/route';
import { GET as getQuote, PUT as saveQuote, DELETE as deleteQuote } from '../app/api/quotes/[id]/route';
import { POST as sendQuote } from '../app/api/quotes/[id]/send/route';
import { POST as createManualLead } from '../app/api/leads/manual/route';
import DashboardNav from '../components/dashboard/DashboardNav';

/** Thenable query-builder stand-in: any chained call returns itself, awaiting yields rows. */
function chain(rows: unknown[]) {
  const c: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown[]) => unknown) => resolve(rows) : () => c),
  });
  return c;
}

const RESTAURANT = { id: 77, slug: 'estancia-leon', name: 'Estancia Leon' };
const ctx = { params: Promise.resolve({ id: '9' }) };

const gm = (slug: string) => ({ slug, role: 'gm' as const });
const req = (method: string, path: string, raw?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: raw,
  });

/** True only when the call hit notFound(); any other outcome means the gate let it through. */
async function hitsNotFound(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (e) {
    return e instanceof NavSignal && e.kind === 'notFound';
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('hasEventsQuotes', () => {
  it('is true for every La Estancia location', () => {
    for (const slug of ['estancia-leon', 'estancia-juarez', 'estancia-queretaro']) {
      expect(hasEventsQuotes(slug)).toBe(true);
    }
  });

  it('is false for other brands, customer roll-up accounts and unknown slugs', () => {
    for (const slug of ['regio-norte', 'harbors-veracruz', 'la-silla-juarez', 'steakcompany-queretaro', 'real', 'owner', 'regional-central', 'unknown']) {
      expect(hasEventsQuotes(slug)).toBe(false);
    }
  });
});

describe('DashboardNav events links', () => {
  const nav = (showEventsQuotes?: boolean) =>
    renderToStaticMarkup(
      <DashboardNav restaurantName="x" logoSrc="" logoDarkBg={false} showEventsQuotes={showEventsQuotes} />,
    );

  it('shows no Leads or Cotizaciones links when the flag is off or omitted', () => {
    for (const markup of [nav(false), nav()]) {
      expect(markup).not.toContain('href="/leads"');
      expect(markup).not.toContain('href="/quotes"');
      expect(markup).toContain('href="/guests"');
    }
  });

  it('shows both links when the flag is on', () => {
    const markup = nav(true);
    expect(markup).toContain('href="/leads"');
    expect(markup).toContain('href="/quotes"');
  });
});

describe('quote and lead pages', () => {
  beforeEach(() => {
    mocks.select.mockImplementation(() => chain([RESTAURANT]));
  });

  it('404s a non-Estancia GM before any query runs', async () => {
    mocks.verifySession.mockResolvedValue(gm('regio-norte'));

    expect(await hitsNotFound(() => QuotesPage())).toBe(true);
    expect(await hitsNotFound(() => NewQuotePage({ searchParams: Promise.resolve({}) }))).toBe(true);
    expect(await hitsNotFound(() => EditQuotePage(ctx))).toBe(true);
    expect(await hitsNotFound(() => LeadsPage({ searchParams: Promise.resolve({}) }))).toBe(true);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('lets a La Estancia GM past the gate', async () => {
    mocks.verifySession.mockResolvedValue(gm('estancia-leon'));

    // Rendering is not exercised here; only that the gate does not call notFound().
    expect(await hitsNotFound(() => QuotesPage())).toBe(false);
    expect(await hitsNotFound(() => NewQuotePage({ searchParams: Promise.resolve({}) }))).toBe(false);
    expect(await hitsNotFound(() => EditQuotePage(ctx))).toBe(false);
    expect(await hitsNotFound(() => LeadsPage({ searchParams: Promise.resolve({}) }))).toBe(false);
  });
});

describe('quote and manual-lead APIs', () => {
  it('404s a non-Estancia GM and never reads or writes the database', async () => {
    mocks.verifySession.mockResolvedValue(gm('regio-norte'));

    const responses = await Promise.all([
      listQuotes(),
      createQuote(req('POST', '/api/quotes', '{}')),
      getQuote(req('GET', '/api/quotes/9'), ctx),
      saveQuote(req('PUT', '/api/quotes/9', '{}'), ctx),
      deleteQuote(req('DELETE', '/api/quotes/9'), ctx),
      sendQuote(req('POST', '/api/quotes/9/send'), ctx),
      createManualLead(req('POST', '/api/leads/manual', '{}')),
    ]);

    for (const res of responses) expect(res.status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('keeps the La Estancia APIs reachable (malformed body reaches the parser, not the gate)', async () => {
    mocks.verifySession.mockResolvedValue(gm('estancia-leon'));
    mocks.select.mockImplementation(() => chain([RESTAURANT]));

    expect((await createQuote(req('POST', '/api/quotes', '{not json'))).status).toBe(400);
    expect((await createManualLead(req('POST', '/api/leads/manual', '{not json'))).status).toBe(400);
  });
});
