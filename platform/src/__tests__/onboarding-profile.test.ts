import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  competitorLine,
  isGroupLead,
  isSolo,
  parseGoogleProfile,
  qrPlacementTip,
  reviewGoal,
  type GoogleProfile,
} from '@/lib/onboarding-profile';

const baseProfile: GoogleProfile = {
  primaryType: 'pizza_restaurant',
  types: ['pizza_restaurant', 'restaurant'],
  takeout: false,
  delivery: false,
  dineIn: true,
  lat: 21.12,
  lng: -101.68,
  formattedAddress: 'Calle 1, León',
  competitors: [],
  fetchedAt: '2026-10-13T12:00:00.000Z',
};

const wordCount = (s: string) => s.trim().split(/\s+/).length;

describe('isSolo / isGroupLead', () => {
  it('isSolo is true only for team_mode solo; NULL (legacy) is false', () => {
    expect(isSolo({ teamMode: 'solo' })).toBe(true);
    expect(isSolo({ teamMode: 'team' })).toBe(false);
    expect(isSolo({ teamMode: null })).toBe(false);
    expect(isSolo({ teamMode: 'garbage' })).toBe(false);
  });

  it('isGroupLead is true only for the 6+ band', () => {
    expect(isGroupLead({ locationsBand: '6+' })).toBe(true);
    expect(isGroupLead({ locationsBand: '2-5' })).toBe(false);
    expect(isGroupLead({ locationsBand: '1' })).toBe(false);
    expect(isGroupLead({ locationsBand: null })).toBe(false);
  });
});

describe('parseGoogleProfile', () => {
  it('round-trips a valid profile', () => {
    const withCompetitors = {
      ...baseProfile,
      competitors: [
        { name: 'Rival', reviewCount: 120, rating: 4.4, distanceM: 300 },
      ],
    };
    expect(parseGoogleProfile(JSON.parse(JSON.stringify(withCompetitors)))).toEqual(withCompetitors);
  });

  it('returns null (never throws) for null, undefined, primitives and arrays', () => {
    for (const bad of [null, undefined, 0, 'x', true, [], [1, 2]]) {
      expect(() => parseGoogleProfile(bad)).not.toThrow();
      expect(parseGoogleProfile(bad)).toBeNull();
    }
  });

  it('returns null without a string fetchedAt', () => {
    expect(parseGoogleProfile({})).toBeNull();
    expect(parseGoogleProfile({ ...baseProfile, fetchedAt: 123 })).toBeNull();
  });

  it('degrades malformed fields to null/empty instead of throwing', () => {
    const parsed = parseGoogleProfile({
      fetchedAt: '2026-10-13T00:00:00.000Z',
      primaryType: 42,
      types: ['bar', 7, null],
      takeout: 'yes',
      lat: 'north',
      lng: Number.NaN,
      competitors: [
        { name: 'ok', reviewCount: 10, rating: 'x', distanceM: null },
        { name: '', reviewCount: 5 },
        { name: 'no count' },
        null,
        'junk',
      ],
    });
    expect(parsed).toEqual({
      primaryType: null,
      types: ['bar'],
      takeout: null,
      delivery: null,
      dineIn: null,
      lat: null,
      lng: null,
      formattedAddress: null,
      competitors: [{ name: 'ok', reviewCount: 10, rating: null, distanceM: null }],
      fetchedAt: '2026-10-13T00:00:00.000Z',
    });
  });

  it('keeps at most 3 competitors and tolerates a non-array competitors field', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `c${i}`, reviewCount: i, rating: null, distanceM: null,
    }));
    expect(parseGoogleProfile({ ...baseProfile, competitors: many })?.competitors).toHaveLength(3);
    expect(parseGoogleProfile({ ...baseProfile, competitors: 'nope' })?.competitors).toEqual([]);
  });
});

describe('categoryLabel', () => {
  it.each([
    ['pizza_restaurant', 'pizzería'],
    ['seafood_restaurant', 'marisquería'],
    ['mexican_restaurant', 'restaurante mexicano'],
    ['bar', 'bar'],
    ['cafe', 'cafetería'],
    ['coffee_shop', 'cafetería'],
    ['taco_restaurant', 'taquería'],
    ['fast_food_restaurant', 'comida rápida'],
    ['steak_house', 'asador'],
    ['bakery', 'panadería'],
  ])('%s -> %s', (type, label) => {
    expect(categoryLabel(type)).toBe(label);
  });

  it('falls back to restaurante for unknown, null and prototype-key input', () => {
    expect(categoryLabel(null)).toBe('restaurante');
    expect(categoryLabel('')).toBe('restaurante');
    expect(categoryLabel('sushi_restaurant')).toBe('restaurante');
    expect(categoryLabel('constructor')).toBe('restaurante');
    expect(categoryLabel(undefined as unknown as string)).toBe('restaurante');
  });
});

describe('qrPlacementTip', () => {
  it('delivery or takeout gives the bag/box tip, for solo and team alike', () => {
    for (const flags of [{ delivery: true }, { takeout: true }]) {
      for (const mode of ['solo', 'team', null] as const) {
        expect(qrPlacementTip({ ...baseProfile, ...flags }, mode)).toBe(
          'Pégalo en la caja o la bolsa de cada pedido.',
        );
      }
    }
  });

  it('solo dine-in gets the cashier/table tip', () => {
    expect(qrPlacementTip(baseProfile, 'solo')).toBe('Ponlo en la caja de cobro o en cada mesa.');
    expect(qrPlacementTip(null, 'solo')).toBe('Ponlo en la caja de cobro o en cada mesa.');
  });

  it('team gets the waiter tip', () => {
    expect(qrPlacementTip(baseProfile, 'team')).toBe('Cada mesero muestra su QR al cobrar.');
    expect(qrPlacementTip(null, 'team')).toBe('Cada mesero muestra su QR al cobrar.');
  });

  it('null profile and null mode still return a tip', () => {
    expect(qrPlacementTip(null, null)).toBe('Ponlo en la caja de cobro o en cada mesa.');
  });

  it('every tip is at most 15 words', () => {
    const tips = [
      qrPlacementTip({ ...baseProfile, delivery: true }, 'solo'),
      qrPlacementTip(baseProfile, 'solo'),
      qrPlacementTip(baseProfile, 'team'),
    ];
    for (const tip of tips) expect(wordCount(tip)).toBeLessThanOrEqual(15);
  });
});

describe('reviewGoal', () => {
  it('is the current count plus 20', () => {
    expect(reviewGoal(0)).toBe(20);
    expect(reviewGoal(150)).toBe(170);
  });

  it('treats null and garbage as 0', () => {
    expect(reviewGoal(null)).toBe(20);
    expect(reviewGoal(Number.NaN)).toBe(20);
    expect(reviewGoal(undefined as unknown as number)).toBe(20);
  });
});

describe('competitorLine', () => {
  const c = (reviewCount: number) => ({ name: `n${reviewCount}`, reviewCount, rating: null, distanceM: null });

  it('is null when there are no competitors', () => {
    expect(competitorLine(10, [])).toBeNull();
    expect(competitorLine(null, [])).toBeNull();
    expect(competitorLine(10, null as unknown as [])).toBeNull();
  });

  it('lists the 3 counts smallest first', () => {
    expect(competitorLine(5, [c(310), c(48), c(120)])).toBe('Los 3 más cerca tienen 48, 120 y 310.');
  });

  it('handles 2 and 1 competitors', () => {
    expect(competitorLine(5, [c(120), c(48)])).toBe('Los 2 más cerca tienen 48 y 120.');
    expect(competitorLine(null, [c(48)])).toBe('El más cerca tiene 48.');
  });

  it('skips garbage entries', () => {
    expect(
      competitorLine(0, [c(7), null as unknown as ReturnType<typeof c>, { name: 'x' } as unknown as ReturnType<typeof c>]),
    ).toBe('El más cerca tiene 7.');
  });
});
