import { describe, expect, it } from 'vitest';
import { signupSchema } from '@/lib/validations';

const validSignup = {
  businessName: 'La Estancia Centro',
  contactName: 'Juan Garcia',
  email: 'juan@example.com',
  phone: '+52 55 1234 5678',
  city: 'Monterrey',
  password: 'correct-horse',
  shippingAddress: {
    line1: 'Calle 123',
    city: 'Monterrey',
    state: 'Nuevo Leon',
    postalCode: '64000',
  },
};

describe('signupSchema', () => {
  it('accepts marketing attribution for checkout signups', () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      source: 'home',
      landingPath: '/contacto?utm_source=meta',
      utmSource: 'meta',
      utmMedium: 'paid-social',
      utmCampaign: 'may-trial',
      offer: 'trial_checkout',
      metadata: {
        source_cluster: 'homepage',
        cta_context: 'hero',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.utmSource).toBe('meta');
      expect(result.data.offer).toBe('trial_checkout');
    }
  });

  it('rejects overlong attribution fields', () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      source: 'x'.repeat(121),
    });

    expect(result.success).toBe(false);
  });
});
