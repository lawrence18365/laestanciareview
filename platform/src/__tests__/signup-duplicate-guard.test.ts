import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const insertedValues: Array<Record<string, unknown>> = [];
  /** Every condition object handed to a `where()` in the mocked db. */
  const whereConditions: unknown[] = [];
  /** Emails the fake restaurants table already holds (mixed case on purpose). */
  const storedEmails: string[] = [];
  /**
   * Restaurant the `lead -> pending_signups -> restaurants` lookups resolve to,
   * i.e. the account an earlier signup with the SAME lead already provisioned.
   * Both the pre-upsert conflict check and the in-transaction backstop read it.
   */
  let linkedRestaurant: { id: number; slug: string; managerEmail: string | null } | null =
    null;

  /** Chainable stand-in for drizzle's `from(...).innerJoin(...)...where(...)`. */
  type ChainableSelect = {
    innerJoin: (table: unknown, condition: unknown) => ChainableSelect;
    where: (condition: unknown) => { limit: (count: number) => Promise<unknown[]> };
  };

  /**
   * Drizzle renders `sql` templates as StringChunk wrappers, and interpolated
   * plain strings inline in the text. Flatten both so the mock can emulate
   * `lower(manager_email) = lower($1)` instead of trusting the caller.
   */
  function collect(node: unknown, depth = 0): { text: string; params: unknown[] } {
    if (depth > 10 || node == null) return { text: '', params: [] };
    if (typeof node === 'string') return { text: node, params: [] };
    if (typeof node !== 'object') return { text: '', params: [] };

    const ctor = (node as { constructor?: { name?: string } }).constructor?.name ?? '';
    const value = (node as { value?: unknown }).value;
    if (ctor === 'StringChunk') {
      return { text: Array.isArray(value) ? value.join('') : String(value ?? ''), params: [] };
    }
    if (ctor === 'Param') return { text: '', params: [value] };

    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return { text: '', params: [] };

    let text = '';
    const params: unknown[] = [];
    for (const chunk of chunks) {
      const part = collect(chunk, depth + 1);
      text += part.text;
      params.push(...part.params);
    }
    return { text, params };
  }

  function sqlText(node: unknown): string {
    return collect(node).text;
  }

  function searchable(node: unknown): string {
    const { text, params } = collect(node);
    return [text, ...params.map((p) => String(p))].join(' ').toLowerCase();
  }

  const database = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: vi.fn(() => {
        let joined = false;
        const chain: ChainableSelect = {
          innerJoin: () => {
            joined = true;
            return chain;
          },
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              limit: async () => {
                if (!joined) {
                  // Emulate `lower(manager_email) = lower($1)`.
                  const text = searchable(condition);
                  const hit =
                    text.includes('lower(') &&
                    storedEmails.some((email) => text.includes(email.toLowerCase()));
                  return hit ? [{ id: 4242 }] : [];
                }
                // Lead -> pending_signups -> restaurants: the pre-upsert
                // conflict check and the in-transaction backstop both resolve
                // to the account an earlier signup on this lead provisioned.
                return linkedRestaurant ? [{ ...linkedRestaurant }] : [];
              },
            };
          },
        };
        return chain;
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        const query = Promise.resolve(undefined) as Promise<void> & {
          returning: () => Promise<Array<{ id: number; slug: string }>>;
        };
        query.returning = vi.fn(async () => [{ id: 77, slug: 'tacos-del-centro' }]);
        return query;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };

  const transactionDbTransaction = vi.fn(
    async (callback: (tx: typeof database) => Promise<unknown>) => callback(database),
  );

  return {
    database,
    transactionDbTransaction,
    insertedValues,
    whereConditions,
    storedEmails,
    sqlText,
    setLinkedRestaurant: (
      value: { id: number; slug: string; managerEmail: string | null } | null,
    ) => {
      linkedRestaurant = value;
    },
    checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 60_000 })),
    trackCommercialEvent: vi.fn(async () => ({ id: 1 })),
    sendWelcomeEmail: vi.fn(async () => undefined),
    upsertCommercialLead: vi.fn(async () => ({
      lead: { id: 41, status: 'new' },
      deduped: false,
      eventId: 1,
    })),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIP: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }));
vi.mock('@/lib/tokens', () => ({
  randomToken: vi.fn((bytes?: number) => (bytes ? 'pending-id-token' : 'status-token')),
  tokenHash: vi.fn(async () => 'status-token-hash'),
}));
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({ checkout: { sessions: { create: vi.fn() } } })),
  STRIPE_PRICE_ID: 'price_test',
  STRIPE_SETUP_PRICE_ID: 'price_setup_test',
  TRIAL_DAYS: 30,
}));
vi.mock('@/lib/commercial-tracking', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/commercial-tracking')>();
  return {
    ...original,
    trackCommercialEvent: mocks.trackCommercialEvent,
    upsertCommercialLead: mocks.upsertCommercialLead,
  };
});
vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'tacos-del-centro'),
  slugify: vi.fn(() => 'tacos-del-centro'),
}));
vi.mock('@/lib/email', () => ({
  sendOwnerLeadNotification: vi.fn(async () => undefined),
  sendOwnerSignupNotification: vi.fn(async () => undefined),
  sendWelcomeEmail: mocks.sendWelcomeEmail,
}));
vi.mock('@/lib/qr', () => ({
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,test'),
  reviewUrlFor: vi.fn((slug: string) => `https://example.com/r/${slug}`),
}));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppWelcome: vi.fn(async () => undefined) }));
vi.mock('@/lib/meta-conversions', () => ({
  sendCompleteRegistrationEvent: vi.fn(async () => undefined),
}));
vi.mock('@/db', () => ({
  db: mocks.database,
  transactionDb: { transaction: mocks.transactionDbTransaction },
}));

import { POST } from '@/app/api/signup/create-checkout/route';

const validSignup = {
  businessName: 'Tacos del Centro',
  contactName: 'Ana López',
  email: 'ana@example.com',
  phone: '+52 55 1234 5678',
  city: 'Ciudad de México',
  password: 'correct-horse',
};

function signupRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('https://app.ratetapmx.com/api/signup/create-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...validSignup, ...overrides }),
  });
}

describe('signup duplicate email guard', () => {
  beforeEach(() => {
    mocks.insertedValues.length = 0;
    mocks.whereConditions.length = 0;
    mocks.storedEmails.length = 0;
    mocks.setLinkedRestaurant(null);
    mocks.transactionDbTransaction.mockClear();
    mocks.upsertCommercialLead.mockClear();
    mocks.trackCommercialEvent.mockClear();
    mocks.checkRateLimitAsync.mockClear();
    mocks.sendWelcomeEmail.mockClear();
  });

  afterEach(() => {
    mocks.storedEmails.length = 0;
  });

  it('returns 409 with a login link and writes nothing when the email already has an account', async () => {
    mocks.storedEmails.push('ana@example.com');

    const response = await POST(signupRequest({ email: 'ANA@Example.com' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Ya existe una cuenta con este correo. Inicia sesión.');
    expect(body.loginUrl).toBe('/login');

    // The lookup is case-insensitive: lower(manager_email) = lower($1).
    expect(mocks.sqlText(mocks.whereConditions[0])).toContain('lower(');

    // No pending_signups / restaurants / commercial lead rows, no provisioning.
    expect(mocks.insertedValues).toHaveLength(0);
    expect(mocks.transactionDbTransaction).not.toHaveBeenCalled();
    expect(mocks.upsertCommercialLead).not.toHaveBeenCalled();
  });

  it('provisions normally when the email is new', async () => {
    const response = await POST(signupRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://app.ratetapmx.com/bienvenida');
    expect(mocks.transactionDbTransaction).toHaveBeenCalledOnce();
  });

  it('does not block a different email just because other accounts exist', async () => {
    mocks.storedEmails.push('otro@example.com');

    const response = await POST(signupRequest({ email: 'ana@example.com' }));

    expect(response.status).toBe(200);
    expect(mocks.transactionDbTransaction).toHaveBeenCalledOnce();
  });

  it('refuses to hand an existing restaurant to a different email on the same lead', async () => {
    // Account takeover path: leads are deduped by phone + business name, so an
    // attacker who knows the victim's public phone and business name lands on
    // the victim's lead — and must NOT be handed the victim's restaurant.
    mocks.setLinkedRestaurant({
      id: 4242,
      slug: 'restaurante-victima',
      managerEmail: 'victima@example.com',
    });

    const response = await POST(signupRequest({ email: 'atacante@example.com' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Ya existe una cuenta para este restaurante. Inicia sesión.');
    expect(body.loginUrl).toBe('/login');

    // No login/signup session cookie, no welcome email, no new restaurant row.
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(mocks.insertedValues.filter((v) => 'slug' in v)).toHaveLength(0);
  });

  it('detects the takeover BEFORE upserting the lead, so the victim lead is untouched', async () => {
    // The upsert rewrites the existing lead's email/name/metadata (leads are
    // deduped by phone + business name). A request we are going to refuse must
    // not have written anything at all, so the conflict must be found before
    // that upsert — not only inside the provisioning transaction.
    mocks.setLinkedRestaurant({
      id: 4242,
      slug: 'restaurante-victima',
      managerEmail: 'victima@example.com',
    });

    const response = await POST(signupRequest({ email: 'atacante@example.com' }));

    expect(response.status).toBe(409);
    expect(mocks.upsertCommercialLead).not.toHaveBeenCalled();
    expect(mocks.trackCommercialEvent).not.toHaveBeenCalled();
    expect(mocks.transactionDbTransaction).not.toHaveBeenCalled();
    expect(mocks.insertedValues).toHaveLength(0);
  });

  it('refuses when the linked account has no manager email to match against', async () => {
    mocks.setLinkedRestaurant({
      id: 4242,
      slug: 'restaurante-victima',
      managerEmail: null,
    });

    const response = await POST(signupRequest({ email: 'atacante@example.com' }));

    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('returns the same restaurant when the same lead is resubmitted with the same email', async () => {
    mocks.setLinkedRestaurant({
      id: 4242,
      slug: 'tacos-existentes',
      managerEmail: 'ana@example.com',
    });

    const response = await POST(signupRequest({ email: 'ANA@Example.com' }));
    const body = await response.json();

    // Idempotent retry: 200, and the existing account is reused (no second
    // restaurants row) — the email comparison is case-insensitive, so the
    // pre-upsert conflict check must let this one through to provisioning.
    expect(response.status).toBe(200);
    expect(body.url).toBe('https://app.ratetapmx.com/bienvenida');
    expect(mocks.upsertCommercialLead).toHaveBeenCalledOnce();
    expect(mocks.insertedValues.filter((v) => 'slug' in v)).toHaveLength(0);
    expect(mocks.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'tacos-existentes', to: 'ANA@Example.com' }),
    );
  });
});
