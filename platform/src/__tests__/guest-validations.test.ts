import { describe, it, expect } from 'vitest';
import {
  guestCaptureSchema,
  guestValidateSchema,
  guestUpdateSchema,
} from '@/lib/validations';

const validCapture = {
  restaurantSlug: 'estancia-leon',
  name: 'Juan García',
  whatsapp: '+52 55 1234 5678',
  birthdayMmdd: '15/06',
};

describe('guestCaptureSchema', () => {
  it('accepts a minimal valid input', () => {
    expect(guestCaptureSchema.safeParse(validCapture).success).toBe(true);
  });

  it('accepts a full input with all optional fields', () => {
    const full = {
      ...validCapture,
      preferences: ['Carne', 'Vino'],
      marketingConsent: true,
      promoType: 'wine',
      utmSource: 'qr',
      utmMedium: 'table',
      utmCampaign: 'agency-demo',
    };
    const result = guestCaptureSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    for (const key of ['restaurantSlug', 'name', 'whatsapp', 'birthdayMmdd'] as const) {
      const bad = { ...validCapture };
      delete (bad as Record<string, unknown>)[key];
      expect(guestCaptureSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects whatsapp containing letters', () => {
    const bad = { ...validCapture, whatsapp: '55-abc-1234' };
    expect(guestCaptureSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts whatsapp with spaces, dashes, parens, and plus', () => {
    for (const phone of ['+52 55 1234 5678', '(55) 1234-5678', '5512345678']) {
      expect(guestCaptureSchema.safeParse({ ...validCapture, whatsapp: phone }).success).toBe(true);
    }
  });

  it('rejects birthdays outside the DD/MM format', () => {
    for (const bad of ['1/1', '1/01', '01/1', '32/06', '15/13', '00/06', '15/00', 'abc', '15-06', '2025-06-15']) {
      const result = guestCaptureSchema.safeParse({ ...validCapture, birthdayMmdd: bad });
      expect(result.success, `should reject "${bad}"`).toBe(false);
    }
  });

  it('accepts valid DD/MM boundary values', () => {
    for (const ok of ['01/01', '31/12', '29/02', '30/04', '15/06']) {
      expect(
        guestCaptureSchema.safeParse({ ...validCapture, birthdayMmdd: ok }).success,
        `should accept "${ok}"`,
      ).toBe(true);
    }
  });

  it('caps preference array size', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `pref${i}`);
    expect(guestCaptureSchema.safeParse({ ...validCapture, preferences: tooMany }).success).toBe(false);
  });

  it('rejects over-long strings', () => {
    const longName = 'x'.repeat(256);
    expect(guestCaptureSchema.safeParse({ ...validCapture, name: longName }).success).toBe(false);
  });

  it('defaults marketingConsent to false when omitted', () => {
    const parsed = guestCaptureSchema.safeParse(validCapture);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.marketingConsent).toBe(false);
  });
});

describe('guestValidateSchema', () => {
  const valid = {
    restaurantSlug: 'estancia-leon',
    code: '1234',
    staffCode: 'JUANCARLOS',
    redemptionType: 'copa_vino' as const,
  };

  it('accepts a valid 4-digit code with a known redemption type', () => {
    expect(guestValidateSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts leading-zero codes', () => {
    // generateValidationCode can emit "0034" — must parse cleanly.
    expect(guestValidateSchema.safeParse({ ...valid, code: '0034' }).success).toBe(true);
  });

  it('rejects codes that are not exactly 4 digits', () => {
    for (const bad of ['123', '12345', 'abcd', '12.3', '12 34', '']) {
      expect(guestValidateSchema.safeParse({ ...valid, code: bad }).success, `"${bad}"`).toBe(false);
    }
  });

  it('rejects unknown redemption types', () => {
    const bad = { ...valid, redemptionType: 'cerveza' };
    expect(guestValidateSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts all three known redemption types', () => {
    for (const t of ['copa_vino', 'postre', 'otro'] as const) {
      expect(guestValidateSchema.safeParse({ ...valid, redemptionType: t }).success).toBe(true);
    }
  });

  it('rejects notes over 500 characters', () => {
    expect(
      guestValidateSchema.safeParse({ ...valid, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('guestUpdateSchema', () => {
  it('accepts an empty object (no-op patch)', () => {
    expect(guestUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a notes-only patch', () => {
    expect(guestUpdateSchema.safeParse({ notes: 'Prefers window seat' }).success).toBe(true);
  });

  it('rejects notes over 2000 characters', () => {
    expect(guestUpdateSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('accepts toggling marketing consent', () => {
    expect(guestUpdateSchema.safeParse({ marketingConsent: false }).success).toBe(true);
  });
});
