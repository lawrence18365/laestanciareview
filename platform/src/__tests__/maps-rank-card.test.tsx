import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import type { KeywordSummary } from '@/lib/maps-rank';

function summary(overrides: Partial<KeywordSummary> = {}): KeywordSummary {
  return {
    keyword: 'restaurante',
    measured: 9,
    top3: 0,
    top10: 0,
    found: 0,
    bestRank: null,
    prevTop3: null,
    runDate: '2026-10-05',
    prevRunDate: null,
    ...overrides,
  };
}

function render(summaries: KeywordSummary[]): string {
  return renderToStaticMarkup(<MapsRankCard summaries={summaries} />);
}

describe('MapsRankCard', () => {
  beforeEach(() => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when the flag is off', () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    expect(render([summary({ top3: 2 })])).toBe('');
  });

  it('renders nothing when there are no summaries', () => {
    expect(render([])).toBe('');
  });

  it('uses the top 3 band when the restaurant ranks in the top 3 at any point', () => {
    const html = render([summary({ top3: 4, top10: 6, measured: 9 })]);
    expect(html).toContain('top 3 en 4 de 9 puntos');
    expect(html).not.toContain('top 10 en');
  });

  it('uses the top 10 band when there are no top 3 points', () => {
    const html = render([summary({ top3: 0, top10: 6, measured: 9 })]);
    expect(html).toContain('top 10 en 6 de 9');
    expect(html).not.toContain('top 3 en');
  });

  it('shows the not-found band when neither top 3 nor top 10 is reached', () => {
    const html = render([summary({ top3: 0, top10: 0 })]);
    expect(html).toContain('No aparece en los primeros 20');
  });

  it('shows the previous top 3 count with an up arrow when top 3 improved', () => {
    const html = render([summary({ top3: 5, prevTop3: 2 })]);
    expect(html).toContain('antes 2');
    expect(html).toContain('↑');
    expect(html).not.toContain('↓');
  });

  it('shows a down arrow when top 3 dropped', () => {
    const html = render([summary({ top3: 1, prevTop3: 4 })]);
    expect(html).toContain('antes 4');
    expect(html).toContain('↓');
    expect(html).not.toContain('↑');
  });

  it('shows an equals sign when top 3 is unchanged', () => {
    const html = render([summary({ top3: 3, prevTop3: 3 })]);
    expect(html).toContain('antes 3');
    expect(html).toContain('aria-hidden="true">=</span>');
    expect(html).not.toContain('↑');
    expect(html).not.toContain('↓');
  });

  it('omits the previous count and arrow when there is no previous run', () => {
    const html = render([summary({ top3: 3, prevTop3: null })]);
    expect(html).not.toContain('antes');
    expect(html).not.toContain('↑');
    expect(html).not.toContain('↓');
  });

  it('never shows an exact rank number', () => {
    const html = render([summary({ top3: 1, top10: 2, bestRank: 2, found: 3 })]);
    expect(html).not.toMatch(/#\d/);
  });

  it('renders the title, every keyword, and the footer with the run date', () => {
    const html = render([
      summary({ keyword: 'tacos', top3: 2, measured: 9 }),
      summary({ keyword: 'brunch', top3: 0, top10: 0, measured: 9 }),
    ]);
    expect(html).toContain('Google Maps');
    expect(html).toContain('tacos');
    expect(html).toContain('brunch');
    expect(html).toContain('Medido el 2026-10-05 en 9 puntos alrededor de la sucursal.');
  });
});
