import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const stripeSessionCreate = vi.fn();
  const insertedValues: Array<Record<string, unknown>> = [];
  const updatedValues: Array<Record<string, unknown>> = [];
  const transactionDbTransaction = vi.fn();
  const checkRateLimitAsync = vi.fn(async () => ({
    allowed: true,
    resetAt: Date.now() + 60_000,
  }));

  return {
    stripeSessionCreate,
    insertedValues,
    updatedValues,
    transactionDbTransaction,
    checkRateLimitAsync,
    getStripe: vi.fn(() => ({
      checkout: { sessions: { create: stripeSessionCreate } },
    })),
    trackCommercialEvent: vi.fn(async () => ({ id: 1 })),
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
  randomToken: vi.fn((bytes?: number) => bytes ? 'pending-id-token' : 'status-token'),
  tokenHash: vi.fn(async () => 'status-token-hash'),
}));
vi.mock('@/lib/stripe', () => ({
  getStripe: mocks.getStripe,
  STRIPE_PRICE_ID: 'price_test',
  STRIPE_SETUP_PRICE_ID: 'price_setup_test',
  TRIAL_DAYS: 30,
}));
vi.mock('@/lib/commercial-tracking', () => ({
  trackCommercialEvent: mocks.trackCommercialEvent,
  upsertCommercialLead: mocks.upsertCommercialLead,
}));
vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'tacos-del-centro'),
  slugify: vi.fn(() => 'tacos-del-centro'),
}));
vi.mock('@/lib/email', () => ({
  sendOwnerLeadNotification: vi.fn(async () => undefined),
  sendOwnerSignupNotification: vi.fn(async () => undefined),
  sendWelcomeEmail: vi.fn(async () => undefined),
}));
vi.mock('@/lib/qr', () => ({
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,test'),
  reviewUrlFor: vi.fn((slug: string) => `https://example.com/r/${slug}`),
}));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppWelcome: vi.fn(async () => undefined) }));
vi.mock('@/lib/meta-conversions', () => ({
  sendCompleteRegistrationEvent: vi.fn(async () => undefined),
}));
vi.mock('@/db', () => {
  const database = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
        const query = Promise.resolve(undefined) as Promise<void> & {
          returning: () => Promise<Array<{ id: number }>>;
        };
        query.returning = vi.fn(async () => [{ id: 77, slug: 'tacos-del-centro' }]);
        return query;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  mocks.transactionDbTransaction.mockImplementation(
    async (callback: (tx: typeof database) => Promise<unknown>) => callback(database),
  );
  return {
    db: database,
    transactionDb: { transaction: mocks.transactionDbTransaction },
  };
});

import { POST } from '@/app/api/signup/create-checkout/route';
import { GET as exchangePilotCode } from '@/app/api/signup/pilot-access/route';
import { PILOT_ACCESS_COOKIE } from '@/lib/pilot';

const validSignup = {
  businessName: 'Tacos del Centro',
  contactName: 'Ana López',
  email: 'ana@example.com',
  phone: '+52 55 1234 5678',
  city: 'Ciudad de México',
  password: 'correct-horse',
  shippingAddress: {
    line1: 'Reforma 100',
    city: 'Ciudad de México',
    state: 'CDMX',
    postalCode: '06600',
  },
};

function signupRequest(pilotAccess?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (pilotAccess) headers.set('cookie', `${PILOT_ACCESS_COOKIE}=${pilotAccess}`);

  return new NextRequest('https://app.ratetapmx.com/api/signup/create-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...validSignup,
      landingPath: '/contacto?utm_source=test',
      metadata: {
        landing_url: 'https://app.ratetapmx.com/contacto?utm_source=test',
      },
    }),
  });
}

function responseCookie(response: Response, name: string): string | undefined {
  const match = response.headers.get('set-cookie')?.match(new RegExp(`${name}=([^;]*)`));
  return match?.[1] || undefined;
}

describe('founder pilot signup', () => {
  beforeEach(() => {
    process.env.PILOT_CODE = 'founder-secret';
    process.env.SESSION_SECRET = 'session-secret-for-tests';
    mocks.stripeSessionCreate.mockReset();
    mocks.getStripe.mockClear();
    mocks.trackCommercialEvent.mockClear();
    mocks.upsertCommercialLead.mockClear();
    mocks.insertedValues.length = 0;
    mocks.updatedValues.length = 0;
    mocks.transactionDbTransaction.mockClear();
    mocks.checkRateLimitAsync.mockClear();
  });

  afterEach(() => {
    delete process.env.PILOT_CODE;
    delete process.env.SESSION_SECRET;
  });

  it('provisions a flagged 30-day pilot without creating a Stripe session', async () => {
    const exchangeResponse = await exchangePilotCode(new NextRequest(
      'https://app.ratetapmx.com/api/signup/pilot-access?pilot=founder-secret',
    ));
    const pilotAccess = responseCookie(exchangeResponse, PILOT_ACCESS_COOKIE);
    expect(pilotAccess).toBeTruthy();
    expect(exchangeResponse.headers.get('location')).toBe('https://app.ratetapmx.com/contacto');
    expect(exchangeResponse.headers.get('location')).not.toContain('founder-secret');
    expect(exchangeResponse.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith(
      'pilot-code-validation:127.0.0.1',
      5,
      10 * 60_000,
    );

    const response = await POST(signupRequest(pilotAccess));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://app.ratetapmx.com/bienvenida');
    expect(body.url).not.toContain('token');
    expect(response.headers.get('set-cookie')).toContain('ratetap_signup_access=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.getStripe).not.toHaveBeenCalled();
    expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
    expect(mocks.transactionDbTransaction).toHaveBeenCalledOnce();
    expect(mocks.upsertCommercialLead).toHaveBeenCalledWith(expect.objectContaining({
      landingPath: '/contacto?utm_source=test',
      metadata: expect.objectContaining({
        landing_url: 'https://app.ratetapmx.com/contacto?utm_source=test',
      }),
    }));
    const restaurantValues = mocks.insertedValues.find((values) => values.pilot === true);
    expect(restaurantValues).toEqual(expect.objectContaining({
      name: validSignup.businessName,
      pilot: true,
      subscriptionStatus: 'trialing',
      trialEndsAt: expect.any(Date),
    }));

    const trialMs = (restaurantValues!.trialEndsAt as Date).getTime() - Date.now();
    expect(trialMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(trialMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    expect(mocks.updatedValues).toContainEqual(expect.objectContaining({
      status: 'provisioned',
      restaurantId: 77,
    }));
  });

  it('charges the setup fee and saves the card when the pilot code is invalid', async () => {
    mocks.stripeSessionCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/test',
    });

    const exchangeResponse = await exchangePilotCode(new NextRequest(
      'https://app.ratetapmx.com/api/signup/pilot-access?pilot=wrong-code',
    ));
    expect(responseCookie(exchangeResponse, PILOT_ACCESS_COOKIE)).toBeUndefined();

    const response = await POST(signupRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://checkout.stripe.com/c/pay/test');
    expect(mocks.insertedValues.some((values) => values.pilot === true)).toBe(false);
    expect(mocks.getStripe).toHaveBeenCalledOnce();
    expect(mocks.stripeSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      customer_creation: 'always',
      line_items: [{ price: 'price_setup_test', quantity: 1 }],
      payment_intent_data: expect.objectContaining({ setup_future_usage: 'off_session' }),
      metadata: expect.objectContaining({ flow: 'setup_fee_then_trial' }),
    }));
    expect(mocks.insertedValues).toContainEqual(expect.objectContaining({
      status: 'checkout_started',
    }));
  });
});
