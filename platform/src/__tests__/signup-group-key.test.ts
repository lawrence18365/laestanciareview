/**
 * A self-serve trial is its own island: provisioning must write group_key NULL
 * explicitly, so it never joins the Grupo Estancia owner/regional views (SQ-186).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'cocteles-chelita'),
  slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('@/db', () => {
  function insertBuilder() {
    return {
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.inserted.push(values);
        return { returning: vi.fn(async () => [{ id: 98, slug: 'cocteles-chelita' }]) };
      }),
    };
  }
  function selectBuilder() {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    // No existing restaurant for the lead, and the candidate slug is free.
    builder.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return builder;
  }
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(selectBuilder),
    insert: vi.fn(insertBuilder),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };
  return {
    db: { insert: vi.fn(insertBuilder) },
    transactionDb: {
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { provisionSignupAtomic, provisionSignupRestaurant } from '@/lib/signup-provisioning';

const input = {
  businessName: 'Cocteles Chelita',
  email: 'chelita@example.com',
  passwordHash: 'hash',
  trialEndsAt: new Date('2026-11-12T00:00:00.000Z'),
};

describe('self-serve signup provisioning leaves group_key NULL', () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
  });

  it('provisionSignupRestaurant inserts group_key = null', async () => {
    await provisionSignupRestaurant(input);

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toHaveProperty('groupKey', null);
    expect(mocks.inserted[0]).toMatchObject({ subscriptionStatus: 'trialing' });
  });

  it('provisionSignupAtomic inserts group_key = null', async () => {
    await provisionSignupAtomic({ ...input, pendingSignupId: 'pending-1', leadId: 1 });

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toHaveProperty('groupKey', null);
    expect(mocks.inserted[0]).toMatchObject({ subscriptionStatus: 'trialing' });
  });
});
