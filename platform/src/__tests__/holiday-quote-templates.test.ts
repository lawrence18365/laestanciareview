import { describe, expect, it } from 'vitest';
import {
  ADDON_PRESETS,
  HOLIDAY_CAMPAIGN_TAG,
  TEMPLATES,
  computePricing,
  dishById,
  emptyConfig,
} from '@/lib/quote-data';
import { quoteCreateSchema, quoteUpdateSchema } from '@/lib/validations';

// The campaign Leslie is running Oct 27 – Dec 19: four fixed-price holiday
// menus. They must lead TEMPLATES so they are the first thing she sees.
const HOLIDAY_MENUS = [
  { id: 'fiestas-menu-1', precioPP: 950, platos: ['pa17', 'm2', 'm4'] },
  { id: 'fiestas-menu-2', precioPP: 995, platos: ['pa20', 'pa22', 'm1'] },
  { id: 'fiestas-menu-3', precioPP: 1200, platos: ['pa13', 'pa1'] },
  { id: 'fiestas-menu-4', precioPP: 1450, platos: ['pa29', 'pa27'] },
];

function precioLabel(precioPP: number): string {
  return `$${precioPP.toLocaleString('es-MX')}/pp con IVA`;
}

describe('holiday party quote templates', () => {
  it('ships the four holiday menus first, in price order', () => {
    expect(TEMPLATES.slice(0, HOLIDAY_MENUS.length).map((t) => t.id)).toEqual(
      HOLIDAY_MENUS.map((m) => m.id),
    );
  });

  it.each(HOLIDAY_MENUS)(
    '$id is a fixed-price individual menu with resolvable dishes',
    ({ id, precioPP, platos }) => {
      const template = TEMPLATES.find((t) => t.id === id);
      expect(template, `Expected template "${id}" to exist`).toBeDefined();
      if (!template) return;

      expect(template.modo).toBe('individual');
      expect(template.precioPP).toBe(precioPP);
      expect(template.precioLabel).toBe(precioLabel(precioPP));
      expect(template.subtitulo).toBe('Fiestas de fin de año');
      expect(template.campaignTag).toBe(HOLIDAY_CAMPAIGN_TAG);
      // Corporate campaign: the client must never see the default "Boda".
      expect(template.tipoEvento).toBe('Empresarial');
      expect(HOLIDAY_CAMPAIGN_TAG).toBe('Posadas 2026');

      // One price per person, IVA included, no service charge, drinks à la carte.
      expect(template.config.precioPP).toBe(precioPP);
      expect(template.config.costoPP).toBe(Math.round(precioPP * 0.42));
      expect(template.config.incluyeIVA).toBe(true);
      expect(template.config.incluyeServicio).toBe(false);
      expect(template.config.bebidas).toBe('a-la-carta');
      expect(template.config.sopas).toEqual([]);
      expect(template.config.postres).toEqual([]);

      expect(template.config.platos).toEqual(platos);
      for (const dishId of platos) {
        const dish = dishById(dishId);
        expect(dish, `Expected dish "${dishId}" to resolve via dishById`).toBeDefined();
      }
    },
  );

  it('prices Menú 1 at $950/pp, and $1,450/pp with both add-ons', () => {
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

    // $950/pp with IVA already included and no service charge.
    expect(computePricing(config).precioFinalPP).toBe(950);

    config.extraSections = ADDON_PRESETS.map((preset, i) => ({
      id: `addon-${i}`,
      nombre: preset.nombre,
      descripcion: preset.descripcion,
      precioPP: preset.precioPP,
      costoPP: 0,
    }));

    // 950 + 350 (barra de vino) + 150 (cóctel) = 1,450.
    expect(computePricing(config).precioFinalPP).toBe(1450);
  });
});

describe('quote campaignTag validation', () => {
  const base = { clientName: 'Corporativo León', configJson: {} };

  it('accepts and trims a campaign tag', () => {
    const parsed = quoteCreateSchema.parse({ ...base, campaignTag: '  Posadas 2026  ' });
    expect(parsed.campaignTag).toBe('Posadas 2026');
  });

  it('accepts an omitted or null campaign tag', () => {
    expect(quoteCreateSchema.parse(base).campaignTag).toBeUndefined();
    expect(quoteCreateSchema.parse({ ...base, campaignTag: null }).campaignTag).toBeNull();
  });

  it('rejects a campaign tag longer than 60 characters', () => {
    const result = quoteCreateSchema.safeParse({ ...base, campaignTag: 'x'.repeat(61) });
    expect(result.success).toBe(false);
  });

  it('carries the campaign tag into the update schema', () => {
    const parsed = quoteUpdateSchema.parse({ ...base, campaignTag: 'Posadas 2026' });
    expect(parsed.campaignTag).toBe('Posadas 2026');
  });
});
