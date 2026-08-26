import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ASADO,
  EMPTY_CARTA,
  EMPTY_INDIV,
  EMPTY_OPCIONES,
  PAQUETES_BEBIDAS,
  TEMPLATES,
  computePricing,
  emptyConfig,
  resolveBeveragePackage,
} from '@/lib/quote-data';

function beverageSubtotal(id: string): number {
  const config = emptyConfig('individual');
  config.evento.personas = 1;
  config.indiv.bebidas = id;
  config.indiv.precioPP = 0;
  config.indiv.incluyeIVA = true;
  config.indiv.incluyeServicio = false;
  return computePricing(config).subtotalVenta;
}

describe('quote beverage package ids', () => {
  it("prices legacy 'completo' as the $300 Básico package", () => {
    expect(beverageSubtotal('completo')).toBe(300);
    expect(beverageSubtotal('completo')).toBe(beverageSubtotal('basico'));
  });

  it("prices legacy 'sin-alcohol' as the $200 alcohol-free package", () => {
    expect(beverageSubtotal('sin-alcohol')).toBe(200);
    expect(beverageSubtotal('sin-alcohol')).toBe(
      beverageSubtotal('barra-libre-sin-alcohol'),
    );
  });

  it('prices an unknown package at $0 without throwing or warning repeatedly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => beverageSubtotal('not-a-package')).not.toThrow();
    expect(beverageSubtotal('not-a-package')).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Unresolved beverage package id "not-a-package"; it is being priced at $0.',
    );

    warn.mockRestore();
  });

  it('keeps every template and empty-state bebida id resolvable', () => {
    const templateIds = TEMPLATES.flatMap((template) =>
      template.config.bebidas ? [template.config.bebidas] : [],
    );
    const ids = [
      ...templateIds,
      EMPTY_INDIV.bebidas,
      EMPTY_OPCIONES.bebidas,
      EMPTY_ASADO.bebidas,
      EMPTY_CARTA.bebidas,
    ];

    for (const id of ids) {
      const pkg = resolveBeveragePackage(id);
      expect(pkg, `Expected beverage package "${id}" to resolve`).toBeDefined();
      expect(PAQUETES_BEBIDAS).toContain(pkg);
    }
  });
});
