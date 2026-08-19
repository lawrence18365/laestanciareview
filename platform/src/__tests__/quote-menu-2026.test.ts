import { describe, expect, it } from 'vitest';
import { MENU } from '@/lib/quote-data';

const OFFICIAL_2026_PRICES: Record<string, number> = {
  // Entradas
  e1: 120,
  e2: 170,
  e3: 190,
  e4: 190,
  e5: 420,
  e6: 165,
  e7: 190,
  e8: 395,
  e9: 298,
  e10: 190,
  e11: 210,
  e12: 298,
  e13: 265,
  e14: 350,
  e15: 310,
  e16: 600,
  e17: 1200,

  // Sopas
  s1: 180,
  s2: 190,
  s3: 230,
  s4: 135,
  s5: 155,
  s6: 165,
  s7: 165,

  // Ensaladas
  en1: 140,
  en2: 195,
  en3: 195,
  en4: 195,
  en5: 195,
  en6: 195,
  en7: 195,
  en8: 195,
  en9: 295,

  // Pastas
  p1: 240,
  p2: 270,
  p3: 270,
  p4: 350,

  // Parrilla
  pa1: 685,
  pa2: 1120,
  pa3: 1670,
  pa4: 1120,
  pa5: 1670,
  pa6: 795,
  pa7: 1325,
  pa8: 795,
  pa9: 1325,
  pa10: 1220,
  pa11: 2250,
  pa12: 620,
  pa13: 990,
  pa14: 485,
  pa15: 795,
  pa16: 498,
  pa17: 485,
  pa18: 550,
  pa19: 450,
  pa20: 610,
  pa21: 520,
  pa22: 475,
  pa23: 450,
  pa24: 925,
  pa25: 1360,
  pa26: 375,
  pa27: 950,
  pa28: 1780,
  pa29: 950,
  pa30: 1780,
  pa31: 1430,
  pa32: 2390,

  // Del Mar
  m1: 370,
  m2: 350,
  m3: 450,
  m4: 380,
  m5: 620,

  // Guarniciones published in the restaurant menu
  g1: 60,
  g2: 60,
  g3: 60,
  g4: 60,
  g5: 60,
  g6: 60,
  g7: 60,
  g8: 60,
  g9: 75,
  g10: 60,
  g11: 60,
  g12: 90,
  g13: 60,
  g14: 90,
};

describe('official La Estancia Argentina 2026 menu', () => {
  it('keeps every published RateTap dish at the official price', () => {
    const pricesById = Object.fromEntries(MENU.map((dish) => [dish.id, dish.precio]));

    expect(pricesById).toMatchObject(OFFICIAL_2026_PRICES);
  });

  it('uses the published 500g portion for Pechuga a las Brasas', () => {
    expect(MENU.find((dish) => dish.id === 'pa26')?.peso).toBe('500g');
  });
});
