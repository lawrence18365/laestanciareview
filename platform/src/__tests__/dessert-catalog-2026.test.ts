import { describe, expect, it } from 'vitest';
import {
  MENU,
  TEMPLATES,
  computePricing,
  dishById,
  emptyConfig,
  isDishOffered,
  migrateConfig,
} from '@/lib/quote-data';

// Official year-round dessert list from La Estancia (Oct 2026). po7 keeps its
// per-person cake price; po17 is seasonal, so it is checked separately below.
const YEAR_ROUND_DESSERTS: Record<string, { nombre: string; precio: number }> = {
  po19: { nombre: 'Flan Napolitano', precio: 145 },
  po3: { nombre: 'Pastel Estancia (rebanada)', precio: 160 },
  po20: { nombre: 'Pastel de plátano kiwi', precio: 170 },
  po21: { nombre: 'Trilogía de alfajores', precio: 135 },
  po22: { nombre: 'Crème brûlée', precio: 160 },
  po7: { nombre: 'Pastel Personalizado', precio: 20 },
  po8: { nombre: 'Banoffee', precio: 190 },
  po9: { nombre: 'Cannolis de mascarpone con pistache', precio: 190 },
  po10: { nombre: 'Cheesecake de Lotus', precio: 190 },
  po11: { nombre: 'Crepas de Nutella', precio: 160 },
  po12: { nombre: 'Gelatina de guanábana', precio: 135 },
  po13: { nombre: 'Mousse de chocolate amargo', precio: 170 },
  po14: { nombre: 'Pasta filo con ate, queso y salsa de dulce de leche', precio: 190 },
  po15: { nombre: 'Pastel de chocolate alemán', precio: 180 },
  po16: { nombre: 'Vesubio de chocolate', precio: 180 },
};

const HOLIDAY_MENU_IDS = [
  'fiestas-menu-1',
  'fiestas-menu-2',
  'fiestas-menu-3',
  'fiestas-menu-4',
];

describe('2026 dessert catalog', () => {
  it('lists exactly the 15 year-round desserts at their official prices', () => {
    const yearRound = MENU.filter(
      (dish) => dish.categoria === 'Postres' && !dish.retired && !dish.season,
    );

    expect(yearRound.map((dish) => dish.id).sort()).toEqual(
      Object.keys(YEAR_ROUND_DESSERTS).sort(),
    );
    expect(
      Object.fromEntries(
        yearRound.map((dish) => [dish.id, { nombre: dish.nombre, precio: dish.precio }]),
      ),
    ).toEqual(YEAR_ROUND_DESSERTS);
  });

  it('hides the retired Cookie Skillet from pickers', () => {
    const cookie = dishById('po1');
    expect(cookie).toBeDefined();
    expect(isDishOffered(cookie!)).toBe(false);
    expect(isDishOffered(cookie!, new Date('2026-10-26T12:00:00-06:00'))).toBe(false);
  });

  it('offers Panna cotta de naranja only in October and November, Mexico City time', () => {
    const pannaCotta = dishById('po17');
    expect(pannaCotta?.season?.months).toEqual([10, 11]);

    expect(isDishOffered(pannaCotta!, new Date('2026-10-26'))).toBe(true);
    // Still Nov 30 in Mexico City even though it is already Dec 1 in UTC.
    expect(isDishOffered(pannaCotta!, new Date('2026-11-30T23:00:00-06:00'))).toBe(true);
    expect(isDishOffered(pannaCotta!, new Date('2026-12-01T12:00:00-06:00'))).toBe(false);
    expect(isDishOffered(pannaCotta!, new Date('2027-09-15T12:00:00-06:00'))).toBe(false);
  });

  it('prices Tarta de calabaza at $190 and offers it in the same Oct-Nov window', () => {
    const tarta = dishById('po18');
    expect(tarta).toMatchObject({ nombre: 'Tarta de calabaza', categoria: 'Postres', precio: 190 });
    expect(tarta?.season?.months).toEqual([10, 11]);
    expect(isDishOffered(tarta!, new Date('2026-11-30T23:00:00-06:00'))).toBe(true);
    expect(isDishOffered(tarta!, new Date('2026-12-01T12:00:00-06:00'))).toBe(false);
  });

  it('offers Banoffee all year round', () => {
    const banoffee = dishById('po8');
    expect(isDishOffered(banoffee!, new Date('2026-12-01T12:00:00-06:00'))).toBe(true);
    expect(isDishOffered(banoffee!, new Date('2027-09-15T12:00:00-06:00'))).toBe(true);
  });

  it('still resolves retired dishes for saved quotes', () => {
    expect(dishById('po1')).toMatchObject({
      nombre: 'Cookie Skillet con Helado',
      precio: 140,
      retired: true,
    });
    expect(dishById('po2')).toMatchObject({ nombre: 'Flan Napolitano', precio: 120, retired: true });
    expect(dishById('po4')).toMatchObject({ nombre: 'Pastel de Kiwi y Plátano', precio: 160, retired: true });
    expect(dishById('po5')).toMatchObject({ nombre: 'Alfajores Argentinos', precio: 120, desc: '3 piezas', retired: true });
    expect(dishById('po6')).toMatchObject({ nombre: 'Crème Brulée', precio: 140, retired: true });
  });

  it.each(['carta', 'asado'] as const)('preserves historical %s dessert prices and IDs', (modo) => {
    const expectedById = { po2: 1680, po4: 2240, po5: 1680, po6: 1960 };
    const originalUnitPrices = { po2: 120, po4: 160, po5: 120, po6: 140 };
    for (const [id, total] of Object.entries(expectedById)) {
      const config = emptyConfig(modo);
      config.evento.personas = 10;
      const serializedIds = JSON.stringify({ [id]: 10 });
      if (modo === 'carta') config.carta.cantidades = JSON.parse(serializedIds);
      else {
        config.asado.cantidades = JSON.parse(serializedIds);
        config.asado.bebidas = 'a-la-carta';
      }
      const original = JSON.stringify(config);
      const restored = migrateConfig(JSON.parse(original));
      const quantities = modo === 'carta' ? restored.carta.cantidades : restored.asado.cantidades;
      const unitPrice = dishById(id)!.precio;
      expect(unitPrice).toBe(originalUnitPrices[id as keyof typeof originalUnitPrices]);
      expect(quantities).toEqual({ [id]: 10 });
      const linePrice = unitPrice * quantities[id];
      expect(linePrice).toBe(originalUnitPrices[id as keyof typeof originalUnitPrices] * 10);
      expect(computePricing(restored).precioTotalFinal).toBe(total);
      expect(JSON.stringify(restored)).toBe(original);
    }
  });
});

describe('2026 dessert templates', () => {
  it.each(HOLIDAY_MENU_IDS)('%s ships the fixed promo desserts', (id) => {
    const template = TEMPLATES.find((t) => t.id === id);
    expect(template).toBeDefined();
    expect(template?.config.postres).toEqual(['po8', 'po14', 'po3']);
    expect(template?.postresFijos).toBe(true);
  });

  it('drops the retired dessert from the 3-options menu', () => {
    const template = TEMPLATES.find((t) => t.id === 'tres-tiempos-opciones');
    expect(template?.config.postres).toEqual(['po19', 'po3', 'po20']);
    expect(template?.config.postres).not.toContain('po1');
  });

  it('keeps retired dessert IDs out of every new template default', () => {
    const retired = new Set(MENU.filter((dish) => dish.categoria === 'Postres' && dish.retired).map((dish) => dish.id));
    for (const template of TEMPLATES) {
      expect((template.config.postres ?? []).filter((id) => retired.has(id))).toEqual([]);
    }
  });

  it('prices Menú 1 at $950/pp with the desserts included', () => {
    const menu = TEMPLATES.find((t) => t.id === 'fiestas-menu-1');
    expect(menu).toBeDefined();
    if (!menu) return;

    const config = emptyConfig('individual');
    config.evento.personas = 10;
    config.indiv = {
      ...config.indiv,
      sopas: menu.config.sopas ?? [],
      platos: menu.config.platos ?? [],
      postres: menu.config.postres ?? [],
      bebidas: menu.config.bebidas ?? 'a-la-carta',
      precioPP: menu.config.precioPP ?? 0,
      costoPP: menu.config.costoPP ?? 0,
      incluyeIVA: menu.config.incluyeIVA ?? true,
      incluyeServicio: menu.config.incluyeServicio ?? false,
    };

    // Desserts are included in the menu price, not billed on top.
    expect(config.indiv.postres).toEqual(['po8', 'po14', 'po3']);
    expect(computePricing(config).precioFinalPP).toBe(950);
  });
});
