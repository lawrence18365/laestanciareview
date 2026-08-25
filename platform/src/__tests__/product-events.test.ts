import { describe, it, expect, beforeAll } from 'vitest';

// Both modules under test transitively import @/db, which reads DATABASE_URL
// at module load. Follow the established pattern: stub the env var, then
// dynamic-import inside beforeAll.
let productEvents: typeof import('@/lib/product-events');
let push: typeof import('@/lib/push');

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  productEvents = await import('@/lib/product-events');
  push = await import('@/lib/push');
});

describe('trackBatchSchema', () => {
  it('accepts a valid batch', () => {
    const result = productEvents.trackBatchSchema.safeParse({
      events: [
        {
          name: 'page_view',
          path: '/dashboard?src=push',
          display_mode: 'standalone',
          session_id: 'rt-abc123',
          properties: { role: 'gm' },
        },
        { name: 'app_open' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown event names', () => {
    const result = productEvents.trackBatchSchema.safeParse({
      events: [{ name: 'delete_everything' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects batches over 20 events', () => {
    const result = productEvents.trackBatchSchema.safeParse({
      events: Array.from({ length: 21 }, () => ({ name: 'page_view' })),
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 20 events', () => {
    const result = productEvents.trackBatchSchema.safeParse({
      events: Array.from({ length: 20 }, () => ({ name: 'page_view' })),
    });
    expect(result.success).toBe(true);
  });
});

describe('PUBLIC_EVENT_NAMES', () => {
  it('contains only names present in PRODUCT_EVENT_NAMES', () => {
    const all = new Set<string>(productEvents.PRODUCT_EVENT_NAMES);
    for (const name of productEvents.PUBLIC_EVENT_NAMES) {
      expect(all.has(name)).toBe(true);
    }
  });

  it('keeps authenticated push banner events private', () => {
    const publicNames = new Set<string>(productEvents.PUBLIC_EVENT_NAMES);
    for (const name of [
      'push_banner_shown',
      'push_banner_suppressed',
      'push_banner_dismissed',
      'push_subscribe_click',
      'push_subscribe_failed',
      'push_permission_revoked_detected',
      'push_subscription_healed',
    ]) {
      expect(publicNames.has(name)).toBe(false);
    }
  });
});

describe('withPushTracking', () => {
  it('appends params to a bare path', () => {
    expect(push.withPushTracking('/dashboard', 42)).toBe('/dashboard?src=push&nid=42');
  });

  it('appends params when a query string already exists', () => {
    expect(push.withPushTracking('/guests?filter=today', 7)).toBe(
      '/guests?filter=today&src=push&nid=7',
    );
  });
});
