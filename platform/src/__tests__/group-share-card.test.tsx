import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupShareCard, { groupShareCities } from '@/components/dashboard/GroupShareCard';
import type { GroupShareSummary } from '@/lib/maps-rank-group';

function share(overrides: Partial<GroupShareSummary> = {}): GroupShareSummary {
  return {
    city: 'Monterrey',
    keyword: 'restaurante centro',
    measured: 9,
    avgTop3: 0,
    pointsAny: 0,
    pointsTwoPlus: 0,
    holders: [],
    prevAvgTop3: null,
    runDate: '2026-10-05',
    prevRunDate: null,
    ...overrides,
  };
}

function render(summaries: GroupShareSummary[]): string {
  return renderToStaticMarkup(<GroupShareCard summaries={summaries} />);
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('GroupShareCard', () => {
  beforeEach(() => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when the flag is off', () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    expect(render([share({ pointsAny: 3, avgTop3: 2 })])).toBe('');
  });

  it('renders nothing when there are no summaries', () => {
    expect(render([])).toBe('');
  });

  it('renders nothing when no summary has measured points', () => {
    expect(render([share({ measured: 0 })])).toBe('');
  });

  it('renders the title, the short footnote and the search label', () => {
    const html = render([share({ keyword: 'cabrito Monterrey', avgTop3: 1, pointsAny: 4 })]);

    expect(html).toContain('Tu grupo en el top 3 de Google Maps');
    expect(html).toContain('● = lugares del grupo en el top 3 · 9 puntos por ciudad');
    expect(html).toContain('cabrito');
    expect(html).not.toContain('cabrito Monterrey');
    expect(html).toContain('Monterrey');
    expect(html).toContain('4/9');
  });

  it('rounds the average to filled dots out of three', () => {
    const html = render([share({ avgTop3: 2.4, pointsAny: 5 })]);

    // The footnote also contains one literal "●", so the table has 2 filled + 1 from the footnote.
    expect(count(html, '●')).toBe(3);
    expect(count(html, '○')).toBe(1);
  });

  it('shows the opportunity word when there are no holders', () => {
    const html = render([share()]);

    expect(html).toContain('Oportunidad');
    expect(html).toContain('#B45309');
  });

  it('collapses holders of the same brand', () => {
    const html = render([share({
      avgTop3: 2,
      pointsAny: 5,
      holders: [
        { restaurantId: 1, name: 'La Silla Juárez', points: 3 },
        { restaurantId: 2, name: 'La Silla Huexotitla', points: 2 },
      ],
    })]);

    expect(html).toContain('La Silla ×2');
  });

  it('shows at most two holders and then the count of the rest', () => {
    const html = render([share({
      avgTop3: 1,
      pointsAny: 4,
      holders: [
        { restaurantId: 1, name: 'Uno', points: 4 },
        { restaurantId: 2, name: 'Dos', points: 3 },
        { restaurantId: 3, name: 'Tres', points: 2 },
      ],
    })]);

    expect(html).toContain('Uno, Dos');
    expect(html).toContain('+1');
    expect(html).not.toContain('Tres');
  });

  it('shows the trend arrow only when the rounded average changed', () => {
    expect(render([share({ avgTop3: 1.4, pointsAny: 1, prevAvgTop3: 0.6 })])).not.toMatch(/▲|▼/);
    expect(render([share({ avgTop3: 2, pointsAny: 2, prevAvgTop3: 0.6 })])).toContain('▲');
    expect(render([share({ avgTop3: 0, pointsAny: 0, prevAvgTop3: 2 })])).toContain('▼');
  });

  it('escapes the keyword', () => {
    const html = render([share({ keyword: 'x <b>' })]);

    expect(html).toContain('x &lt;b&gt;');
  });

  it('never renders the old sentence wording', () => {
    const html = render([share({ pointsAny: 3, avgTop3: 1, prevAvgTop3: 0.4, holders: [{ restaurantId: 1, name: 'Centro', points: 3 }] })]);

    expect(html).not.toContain('al menos 1 de los 3 primeros');
    expect(html).not.toContain('2 o más');
    expect(html).not.toContain('fuera del top 3');
    expect(html).not.toContain('antes');
  });
});

describe('groupShareCities', () => {
  it('sorts cities by row count, then rows by dots and points', () => {
    const cities = groupShareCities([
      share({ city: 'Puebla', keyword: 'a Puebla', avgTop3: 0, pointsAny: 0 }),
      share({ city: 'Monterrey', keyword: 'b Monterrey', avgTop3: 0, pointsAny: 0 }),
      share({ city: 'Monterrey', keyword: 'c Monterrey', avgTop3: 2, pointsAny: 1 }),
      share({ city: 'Monterrey', keyword: 'd Monterrey', avgTop3: 1, pointsAny: 9 }),
    ]);

    expect(cities.map((c) => c.city)).toEqual(['Monterrey', 'Puebla']);
    expect(cities[0].rows.map((r) => r.search)).toEqual(['c', 'd', 'b']);
  });

  it('drops summaries without measured points', () => {
    expect(groupShareCities([share({ measured: 0 })])).toEqual([]);
  });
});
