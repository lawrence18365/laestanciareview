import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupShareCard from '@/components/dashboard/GroupShareCard';
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

describe('GroupShareCard', () => {
  beforeEach(() => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when the flag is off', () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    expect(render([share({ pointsAny: 3, pointsTwoPlus: 2 })])).toBe('');
  });

  it('renders nothing when there are no summaries', () => {
    expect(render([])).toBe('');
  });

  it('renders nothing when no summary has measured points', () => {
    expect(render([share({ measured: 0 })])).toBe('');
  });

  it('renders the two-or-more wording with the title and footnote', () => {
    const html = render([share({ pointsAny: 6, pointsTwoPlus: 5 })]);

    expect(html).toContain('Tu grupo en el top 3 de Google Maps');
    expect(html).toContain('Monterrey · restaurante centro:');
    expect(html).toContain('2 o más de los 3 primeros en 5 de 9 puntos');
    expect(html).toContain('Medido en 9 puntos por ciudad.');
  });

  it('renders the at-least-one wording', () => {
    const html = render([share({ pointsAny: 2, pointsTwoPlus: 1 })]);

    expect(html).toContain('al menos 1 de los 3 primeros en 2 de 9 puntos');
  });

  it('renders the outside-top-3 wording', () => {
    const html = render([share()]);

    expect(html).toContain('fuera del top 3');
  });

  it('renders holders and the previous average', () => {
    const html = render([share({
      pointsAny: 1,
      pointsTwoPlus: 0,
      holders: [{ restaurantId: 1, name: 'Centro', points: 1 }],
      prevAvgTop3: 0.4,
    })]);

    expect(html).toContain('(Centro)');
    expect(html).toContain('antes 0.4 de 3');
  });

  it('escapes the keyword', () => {
    const html = render([share({ keyword: 'x <b>' })]);

    expect(html).toContain('x &lt;b&gt;');
  });
});
