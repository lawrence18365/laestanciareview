/**
 * A business name may not contain "@": login resolves a typed email before any
 * name, so signup must never create a name that looks like an email.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signupSchema } from '@/lib/validations';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 60_000 })),
  getClientIP: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/db', () => ({ db: {} }));

import { POST } from '@/app/api/signup/create-checkout/route';

const valid = {
  businessName: 'La Estancia Centro',
  contactName: 'Juan Garcia',
  email: 'juan@example.com',
  phone: '+52 55 1234 5678',
  city: 'Monterrey',
  password: 'correct-horse',
};

function post(body: unknown, cookie?: string) {
  return new NextRequest('http://localhost/api/signup/create-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('signup business name', () => {
  it('schema rejects a name containing @ with the Spanish message', () => {
    const result = signupSchema.safeParse({ ...valid, businessName: 'juan@grupo.mx' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.businessName).toEqual([
        'El nombre no puede incluir @',
      ]);
    }
  });

  it('schema still accepts a normal name', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('the signup route answers 400 for a name with @', async () => {
    const res = await POST(post({ ...valid, businessName: 'Tacos @ Centro' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.fieldErrors.businessName).toEqual(['El nombre no puede incluir @']);
  });

  it('the pilot path shares the schema, so a name with @ is rejected there too', async () => {
    // The pilot flag only changes what happens after validation; validation runs first.
    const res = await POST(post({ ...valid, businessName: 'a@b.mx' }, 'pilot_access=anything'));
    expect(res.status).toBe(400);
  });
});
