import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canUse,
  isSelfServe,
  planFor,
  selfServePrice,
  usesPlanRestaurantePrice,
  type Feature,
  type Plan,
} from '@/lib/entitlements';

const GROUP = 'grupo-estancia';

describe('planFor', () => {
  it.each<[string, string, string | null, Plan]>([
    ['group active', 'active', GROUP, 'paid'],
    ['group trialing', 'trialing', GROUP, 'trial'],
    ['group canceled', 'canceled', GROUP, 'blocked'],
    ['group past_due', 'past_due', GROUP, 'blocked'],
    ['group paused (unknown status)', 'paused', GROUP, 'blocked'],
    ['self-serve trialing', 'trialing', null, 'trial'],
    ['self-serve active', 'active', null, 'paid'],
    ['self-serve canceled', 'canceled', null, 'free'],
    ['self-serve expired', 'expired', null, 'free'],
    ['self-serve past_due', 'past_due', null, 'free'],
  ])('%s -> %s', (_label, subscriptionStatus, groupKey, expected) => {
    expect(planFor({ subscriptionStatus, groupKey })).toBe(expected);
  });
});

describe('canUse', () => {
  const features: Feature[] = ['feedback_text', 'alerts', 'maps_rank', 'weekly_report'];

  it.each<[Plan, boolean]>([
    ['trial', true],
    ['paid', true],
    ['free', false],
    ['blocked', false],
  ])('plan %s -> %s for every feature', (plan, expected) => {
    for (const feature of features) expect(canUse(plan, feature)).toBe(expected);
  });
});

describe('isSelfServe / usesPlanRestaurantePrice', () => {
  it('is self-serve only when group_key is null', () => {
    expect(isSelfServe({ groupKey: null })).toBe(true);
    expect(isSelfServe({ groupKey: GROUP })).toBe(false);
  });

  it('prices only single-location self-serve restaurants at Plan Restaurante', () => {
    expect(usesPlanRestaurantePrice({ groupKey: null, locationsBand: null })).toBe(true);
    expect(usesPlanRestaurantePrice({ groupKey: null, locationsBand: '1' })).toBe(true);
    expect(usesPlanRestaurantePrice({ groupKey: null, locationsBand: '2-5' })).toBe(false);
    expect(usesPlanRestaurantePrice({ groupKey: null, locationsBand: '6+' })).toBe(false);
    expect(usesPlanRestaurantePrice({ groupKey: GROUP, locationsBand: '1' })).toBe(false);
  });
});

describe('selfServePrice', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 299 monthly and 2490 annual', () => {
    vi.stubEnv('SELF_SERVE_MONTHLY_MXN', '');
    vi.stubEnv('SELF_SERVE_ANNUAL_MXN', '');
    expect(selfServePrice('monthly')).toBe(299);
    expect(selfServePrice('annual')).toBe(2490);
  });

  it('reads the env overrides', () => {
    vi.stubEnv('SELF_SERVE_MONTHLY_MXN', '349');
    vi.stubEnv('SELF_SERVE_ANNUAL_MXN', '2990');
    expect(selfServePrice('monthly')).toBe(349);
    expect(selfServePrice('annual')).toBe(2990);
  });

  it('falls back to the default on an invalid value', () => {
    vi.stubEnv('SELF_SERVE_MONTHLY_MXN', 'abc');
    vi.stubEnv('SELF_SERVE_ANNUAL_MXN', '-5');
    expect(selfServePrice('monthly')).toBe(299);
    expect(selfServePrice('annual')).toBe(2490);
  });
});
