/**
 * Provisioning persists the onboarding answers (US-14 T1) and a legacy call
 * without them inserts NULLs, so existing behavior is unchanged.
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

const base = {
  businessName: 'Cocteles Chelita',
  email: 'chelita@example.com',
  passwordHash: 'hash',
  trialEndsAt: new Date('2026-11-12T00:00:00.000Z'),
};

describe('provisioning persists teamMode / locationsBand', () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
  });

  it('provisionSignupRestaurant writes the answers and keeps group_key null', async () => {
    await provisionSignupRestaurant({ ...base, teamMode: 'solo', locationsBand: '1' });
    expect(mocks.inserted[0]).toMatchObject({ teamMode: 'solo', locationsBand: '1', groupKey: null });
  });

  it('provisionSignupAtomic writes the answers and keeps group_key null', async () => {
    await provisionSignupAtomic({
      ...base, pendingSignupId: 'p1', leadId: 1, teamMode: 'team', locationsBand: '6+',
    });
    expect(mocks.inserted[0]).toMatchObject({ teamMode: 'team', locationsBand: '6+', groupKey: null });
  });

  it('legacy calls without the answers insert NULLs (both paths)', async () => {
    await provisionSignupRestaurant(base);
    await provisionSignupAtomic({ ...base, pendingSignupId: 'p2', leadId: 2 });
    expect(mocks.inserted).toHaveLength(2);
    for (const row of mocks.inserted) {
      expect(row).toHaveProperty('teamMode', null);
      expect(row).toHaveProperty('locationsBand', null);
    }
  });

  it('explicit nulls insert NULLs', async () => {
    await provisionSignupAtomic({
      ...base, pendingSignupId: 'p3', leadId: 3, teamMode: null, locationsBand: null,
    });
    expect(mocks.inserted[0]).toMatchObject({ teamMode: null, locationsBand: null });
  });
});
