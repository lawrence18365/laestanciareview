import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  competitorLine,
  isFoodOrDrink,
  isGroupLead,
  isSolo,
  parseGoogleProfile,
  qrPlacementTip,
  reviewGoal,
  staffNoun,
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
    expect(parseGoogleProfile(JSON.parse(JSON.stringify(withCompetitors)))).toEqual({
      ...withCompetitors,
      primaryTypeLabel: null,
    });
  });

  it('keeps primaryTypeLabel; legacy rows without it parse to null', () => {
    expect(parseGoogleProfile({ ...baseProfile, primaryTypeLabel: ' Dentista ' })?.primaryTypeLabel).toBe(
      'Dentista',
    );
    expect(parseGoogleProfile({ ...baseProfile })?.primaryTypeLabel).toBeNull();
    expect(parseGoogleProfile({ ...baseProfile, primaryTypeLabel: 5 })?.primaryTypeLabel).toBeNull();
    expect(parseGoogleProfile({ ...baseProfile, primaryTypeLabel: '  ' })?.primaryTypeLabel).toBeNull();
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
      primaryTypeLabel: null,
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

  it('falls back to restaurante for unknown, null and food types without a label', () => {
    expect(categoryLabel(null)).toBe('restaurante');
    expect(categoryLabel('')).toBe('restaurante');
    expect(categoryLabel('sushi_restaurant')).toBe('restaurante');
    expect(categoryLabel(undefined as unknown as string)).toBe('restaurante');
  });

  it('never returns an Object.prototype member for a prototype key', () => {
    // 'constructor' is not food: negocio (it used to be 'restaurante' for every unknown type).
    expect(categoryLabel('constructor')).toBe('negocio');
    expect(categoryLabel('toString')).toBe('negocio');
  });

  it('non-food: the lowercased Places label, else negocio (never restaurante)', () => {
    expect(categoryLabel('dentist', 'Dentista')).toBe('dentista');
    expect(categoryLabel('laundry', 'Lavandería')).toBe('lavandería');
    expect(categoryLabel('liquor_store', 'Tienda de vinos y licores')).toBe('tienda de vinos y licores');
    expect(categoryLabel('dentist')).toBe('negocio');
    expect(categoryLabel('dentist', null)).toBe('negocio');
    expect(categoryLabel('dentist', '  ')).toBe('negocio');
  });

  it('the table label wins over the Places label; a food type with a label uses the label', () => {
    expect(categoryLabel('pizza_restaurant', 'Pizzería italiana')).toBe('pizzería');
    expect(categoryLabel('ramen_restaurant', 'Restaurante de ramen')).toBe('restaurante de ramen');
    expect(categoryLabel(null, 'Dentista')).toBe('dentista');
  });
});

describe('isFoodOrDrink', () => {
  const p = (primaryType: string | null, types: string[] = []) => ({ primaryType, types });

  it('is true for restaurants, bars, cafes, bakeries, takeout/delivery and night clubs', () => {
    for (const t of ['restaurant', 'sushi_restaurant', 'bar', 'wine_bar', 'cafe', 'coffee_shop', 'bakery', 'meal_takeaway', 'meal_delivery', 'night_club', 'steak_house']) {
      expect(isFoodOrDrink(p(t))).toBe(true);
    }
    expect(isFoodOrDrink(p('hotel', ['hotel', 'restaurant']))).toBe(true);
    expect(isFoodOrDrink(p(null, ['cafe']))).toBe(true);
  });

  it('is false for a dentist, a laundry and a liquor store, even with the generic food/store types', () => {
    expect(isFoodOrDrink(p('dentist', ['dentist', 'health']))).toBe(false);
    expect(isFoodOrDrink(p('laundry', ['laundry', 'point_of_interest']))).toBe(false);
    expect(isFoodOrDrink(p('liquor_store', ['liquor_store', 'store', 'food']))).toBe(false);
    expect(isFoodOrDrink(p(null, ['dentist']))).toBe(false);
  });

  it('treats a null profile and a profile with no type information as food (legacy)', () => {
    expect(isFoodOrDrink(null)).toBe(true);
    expect(isFoodOrDrink(p(null, []))).toBe(true);
  });
});

describe('staffNoun', () => {
  it('is meseros for food/drink and for a null profile, tu equipo otherwise', () => {
    expect(staffNoun(null)).toBe('meseros');
    expect(staffNoun(baseProfile)).toBe('meseros');
    expect(staffNoun({ ...baseProfile, primaryType: 'dentist', types: ['dentist'] })).toBe('tu equipo');
    expect(staffNoun({ ...baseProfile, primaryType: 'liquor_store', types: ['liquor_store', 'store'] })).toBe(
      'tu equipo',
    );
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

  it('non-food: no waiter, table or cashier-table wording', () => {
    const dentist = { ...baseProfile, primaryType: 'dentist', types: ['dentist'] };
    expect(qrPlacementTip(dentist, 'team')).toBe('Cada persona de tu equipo muestra su QR al cobrar.');
    expect(qrPlacementTip(dentist, 'solo')).toBe('Ponlo en tu mostrador o en la recepción.');
  });

  it('every tip is at most 15 words', () => {
    const dentist = { ...baseProfile, primaryType: 'dentist', types: ['dentist'] };
    const tips = [
      qrPlacementTip(dentist, 'team'),
      qrPlacementTip(dentist, 'solo'),
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
