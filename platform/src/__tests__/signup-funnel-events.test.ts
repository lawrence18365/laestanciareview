import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The self-serve signup funnel is measured by name: the report and every
 * dashboard query match on these strings, and an event that is missing from the
 * allowlist is dropped silently by POST /api/analytics/track — no error, no row,
 * a funnel step that reads zero forever. These assertions pin the contract.
 */
const SIGNUP_FUNNEL_EVENTS = [
  'signup_page_view',
  'signup_form_started',
  'signup_place_selected',
  'signup_submit',
  'signup_submit_failed',
  'signup_completed',
  'onboarding_ready_shown',
  'onboarding_timed_out',
  'onboarding_google_search',
  'onboarding_google_saved',
  'onboarding_google_save_failed',
  'onboarding_cta_click',
] as const;

/** The subset fired before the visitor has a session cookie. */
const PUBLIC_SIGNUP_FUNNEL_EVENTS = [
  'signup_page_view',
  'signup_form_started',
  'signup_place_selected',
  'signup_submit',
  'signup_submit_failed',
  'onboarding_timed_out',
] as const;

// Both modules transitively import @/db, which reads DATABASE_URL at module
// load — same pattern as product-events.test.ts: stub the env then import.
let productEvents: typeof import('@/lib/product-events');
let validations: typeof import('@/lib/validations');

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  productEvents = await import('@/lib/product-events');
  validations = await import('@/lib/validations');
});

describe('signup funnel event names', () => {
  it('allows every signup funnel event', () => {
    const allowed = new Set<string>(productEvents.PRODUCT_EVENT_NAMES);
    for (const name of SIGNUP_FUNNEL_EVENTS) {
      expect(allowed.has(name), `${name} is missing from PRODUCT_EVENT_NAMES`).toBe(true);
    }
  });

  it('marks exactly the pre-session steps public and keeps signup_completed private', () => {
    const publicNames = new Set<string>(productEvents.PUBLIC_EVENT_NAMES);
    for (const name of PUBLIC_SIGNUP_FUNNEL_EVENTS) {
      expect(publicNames.has(name), `${name} should be public`).toBe(true);
    }

    // signup_completed is written server-side only, and the remaining
    // onboarding steps fire after the session cookie exists.
    for (const name of SIGNUP_FUNNEL_EVENTS) {
      if ((PUBLIC_SIGNUP_FUNNEL_EVENTS as readonly string[]).includes(name)) continue;
      expect(publicNames.has(name), `${name} should NOT be public`).toBe(false);
    }
    expect(publicNames.has('signup_completed')).toBe(false);
  });
});

describe('signupSchema analyticsSessionId', () => {
  const validSignup = {
    businessName: 'Tacos del Centro',
    contactName: 'Ana López',
    email: 'ana@example.com',
    phone: '+52 55 1234 5678',
    city: 'Ciudad de México',
    password: 'correct-horse',
  };

  it('accepts a per-tab analytics session id', () => {
    const result = validations.signupSchema.safeParse({
      ...validSignup,
      analyticsSessionId: 'rt-9f2c1d4e-5a6b-7c8d-9e0f-1a2b3c4d5e6f',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analyticsSessionId).toBe('rt-9f2c1d4e-5a6b-7c8d-9e0f-1a2b3c4d5e6f');
    }
  });

  it('accepts a signup without one', () => {
    const result = validations.signupSchema.safeParse(validSignup);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analyticsSessionId).toBeUndefined();
    }
  });

  it('rejects an analytics session id longer than 64 characters', () => {
    const result = validations.signupSchema.safeParse({
      ...validSignup,
      analyticsSessionId: 'x'.repeat(65),
    });

    expect(result.success).toBe(false);
  });
});
