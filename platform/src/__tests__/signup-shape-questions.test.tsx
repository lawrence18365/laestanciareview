/**
 * US-14 T3: the two tap questions on /contacto, their validation, the 6+
 * founder alert, and the neutral (no-waiter) copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => {
  process.env.OWNER_NOTIFICATION_EMAIL = 'founders@example.com';
  process.env.SESSION_SECRET = 'session-secret-for-tests';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  return {
    provisionSignupAtomic: vi.fn(async () => ({ id: 77, slug: 'tacos-del-centro' })),
    sendLargeGroupSignupAlert: vi.fn(async () => undefined),
    sendOwnerSignupNotification: vi.fn(async () => undefined),
    sendWelcomeEmail: vi.fn(async () => undefined),
    recordProductEvent: vi.fn(async () => undefined),
    sendMail: vi.fn(async () => ({ success: true })),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 60_000 })),
  getClientIP: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }));
vi.mock('@/lib/tokens', () => ({
  randomToken: vi.fn(() => 'token'),
  tokenHash: vi.fn(async () => 'token-hash'),
}));
vi.mock('@/lib/stripe', () => ({ TRIAL_DAYS: 30 }));
vi.mock('@/lib/commercial-tracking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/commercial-tracking')>()),
  trackCommercialEvent: vi.fn(async () => ({ id: 1 })),
  upsertCommercialLead: vi.fn(async () => ({ lead: { id: 41 }, deduped: false, eventId: 1 })),
}));
vi.mock('@/lib/signup-provisioning', () => ({
  provisionSignupAtomic: mocks.provisionSignupAtomic,
  SignupConflictError: class SignupConflictError extends Error {},
}));
vi.mock('@/lib/product-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/product-events')>()),
  recordProductEvent: mocks.recordProductEvent,
}));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));
vi.mock('@/lib/qr', () => ({
  generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,test'),
  reviewUrlFor: vi.fn((slug: string) => `https://example.com/r/${slug}`),
}));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppWelcome: vi.fn(async () => undefined) }));
vi.mock('@/lib/meta-conversions', () => ({
  sendCompleteRegistrationEvent: vi.fn(async () => undefined),
}));
vi.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['innerJoin', 'from']) chain[m] = vi.fn(() => chain);
  chain.where = vi.fn(() => ({ limit: async () => [] }));
  const database = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  return { db: database, transactionDb: { transaction: vi.fn() } };
});
vi.mock('next/script', () => ({ default: () => null }));
vi.mock('@/components/GooglePlaceSearch', () => ({ default: () => null }));
vi.mock('@/lib/analytics-client', () => ({ track: vi.fn(), getSessionId: () => null }));

import { signupSchema } from '@/lib/validations';
import { POST } from '@/app/api/signup/create-checkout/route';
import ContactoForm from '@/app/contacto/ContactoForm';

// The route imports the real email module only through this mock, so the alert
// helper under test (email.ts) is exercised separately below.
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendLargeGroupSignupAlert: mocks.sendLargeGroupSignupAlert,
  sendOwnerSignupNotification: mocks.sendOwnerSignupNotification,
  sendWelcomeEmail: mocks.sendWelcomeEmail,
}));

const validSignup = {
  businessName: 'Tacos del Centro',
  contactName: 'Ana López',
  email: 'ana@example.com',
  phone: '+52 55 1234 5678',
  city: 'Ciudad de México',
  password: 'correct-horse',
};

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('https://app.ratetapmx.com/api/signup/create-checkout', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ ...validSignup, ...extra }),
  });
}

describe('signupSchema onboarding answers', () => {
  it('accepts every allowed locationsBand and teamMode value', () => {
    for (const locationsBand of ['1', '2-5', '6+']) {
      for (const teamMode of ['solo', 'team']) {
        const r = signupSchema.safeParse({ ...validSignup, locationsBand, teamMode });
        expect(r.success).toBe(true);
        if (r.success) {
          expect(r.data.locationsBand).toBe(locationsBand);
          expect(r.data.teamMode).toBe(teamMode);
        }
      }
    }
  });

  it('rejects values outside the allowed sets', () => {
    expect(signupSchema.safeParse({ ...validSignup, locationsBand: '10' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, locationsBand: '' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, teamMode: 'both' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, teamMode: 'SOLO' }).success).toBe(false);
  });

  it('treats missing fields (legacy clients) as absent', () => {
    const r = signupSchema.safeParse(validSignup);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.locationsBand ?? null).toBeNull();
      expect(r.data.teamMode ?? null).toBeNull();
    }
  });
});

describe('create-checkout route onboarding answers', () => {
  beforeEach(() => {
    mocks.provisionSignupAtomic.mockClear();
    mocks.sendLargeGroupSignupAlert.mockClear();
    mocks.recordProductEvent.mockClear();
  });

  it('rejects an invalid answer with 400 and provisions nothing', async () => {
    const res = await POST(request({ locationsBand: '99', teamMode: 'solo' }));
    expect(res.status).toBe(400);
    expect(mocks.provisionSignupAtomic).not.toHaveBeenCalled();
  });

  it('legacy request without the answers provisions with nulls and sends no alert', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.provisionSignupAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ teamMode: null, locationsBand: null }),
    );
    expect(mocks.sendLargeGroupSignupAlert).not.toHaveBeenCalled();
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'signup_completed',
        properties: expect.objectContaining({ locations_band: null, team_mode: null }),
      }),
    );
  });

  it.each(['1', '2-5'])('band %s passes through and sends no alert', async (band) => {
    const res = await POST(request({ locationsBand: band, teamMode: 'team' }));
    expect(res.status).toBe(200);
    expect(mocks.provisionSignupAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ teamMode: 'team', locationsBand: band }),
    );
    expect(mocks.sendLargeGroupSignupAlert).not.toHaveBeenCalled();
  });

  it('6+ provisions, records both answers and sends the founder alert', async () => {
    const res = await POST(request({ locationsBand: '6+', teamMode: 'team' }));
    expect(res.status).toBe(200);
    expect(mocks.provisionSignupAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ teamMode: 'team', locationsBand: '6+' }),
    );
    expect(mocks.sendLargeGroupSignupAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendLargeGroupSignupAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantName: 'Tacos del Centro',
        city: 'Ciudad de México',
        contactName: 'Ana López',
        phone: '+52 55 1234 5678',
        email: 'ana@example.com',
        slug: 'tacos-del-centro',
      }),
    );
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ locations_band: '6+', team_mode: 'team' }),
      }),
    );
  });

  it('a failing alert never fails the signup', async () => {
    mocks.sendLargeGroupSignupAlert.mockRejectedValueOnce(new Error('smtp down'));
    const res = await POST(request({ locationsBand: '6+', teamMode: 'solo' }));
    expect(res.status).toBe(200);
  });
});

describe('sendLargeGroupSignupAlert', () => {
  it('emails the founders with the required subject and details', async () => {
    const { sendLargeGroupSignupAlert } = await vi.importActual<typeof import('@/lib/email')>(
      '@/lib/email',
    );
    mocks.sendMail.mockClear();
    await sendLargeGroupSignupAlert({
      restaurantName: 'Grupo <Brasa>',
      contactName: 'Ana López',
      email: 'ana@example.com',
      phone: '+52 55 1234 5678',
      city: 'Monterrey',
      slug: 'grupo-brasa',
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const arg = mocks.sendMail.mock.calls[0] as unknown as [
      { to: string; subject: string; html: string },
    ];
    const mail = arg[0];
    expect(mail.to).toBe('founders@example.com');
    expect(mail.subject).toBe('Nuevo registro: grupo de 6+ sucursales');
    for (const piece of ['Grupo &lt;Brasa&gt;', 'Monterrey', 'Ana López', '+52 55 1234 5678', 'ana@example.com', '/commercial-leads']) {
      expect(mail.html).toContain(piece);
    }
  });

  it('swallows a mailer failure', async () => {
    const { sendLargeGroupSignupAlert } = await vi.importActual<typeof import('@/lib/email')>(
      '@/lib/email',
    );
    mocks.sendMail.mockRejectedValueOnce(new Error('boom'));
    await expect(
      sendLargeGroupSignupAlert({
        restaurantName: 'X', contactName: 'Y', email: 'a@b.co', phone: '5555555', city: 'Z', slug: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('/contacto form', () => {
  const html = renderToStaticMarkup(<ContactoForm pilotOffer={false} />);
  const source = readFileSync(
    path.resolve(__dirname, '../app/contacto/ContactoForm.tsx'),
    'utf8',
  );

  it('renders both tap questions as required radio options', () => {
    for (const text of [
      '¿Cuántas sucursales tienes?', '2 a 5', '6 o más',
      '¿Quién atiende a tus clientes?', 'Solo yo', 'Tengo meseros',
    ]) {
      expect(html).toContain(text);
    }
    for (const value of ['1', '2-5', '6+', 'solo', 'team']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html.match(/type="radio"[^>]*required|required=""[^>]*type="radio"/g)?.length).toBe(5);
  });

  it('no longer assumes waiters in the header or steps', () => {
    expect(source).not.toContain('QR de tus meseros');
    expect(source).not.toContain('Escanea el QR del mesero');
    expect(html).toContain('Listo en 2 minutos.');
    expect(html).toContain('Tu cliente escanea tu QR');
  });

  it('keeps the above-the-fold copy within 30 words', () => {
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)![1];
    const sub = html.match(/<\/h1><p[^>]*>(.*?)<\/p>/)![1];
    const words = `${h1} ${sub}`.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(30);
  });
});
