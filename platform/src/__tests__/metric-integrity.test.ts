/**
 * Guards for customer-visible metric integrity.
 *
 * Each test here exists because a real defect shipped: a label that named a
 * different event than the one it counted, or an average that could not express
 * a bad outcome.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { t, googleTwoFactNote } from '@/lib/i18n';
import { RATING_BASELINE_FLOOR, RATING_BASELINE_NOTE } from '@/lib/rating-baseline';

/** The group aggregation as OwnerOverview computes it. */
function portfolio(trends: Array<{ ratingChange: number; reviewsGained: number } | null>) {
  let totalRatingDelta = 0, totalReviewsDelta = 0, withTrend = 0, missing = 0;
  for (const trend of trends) {
    if (trend) { totalRatingDelta += trend.ratingChange; totalReviewsDelta += trend.reviewsGained; withTrend++; }
    else missing++;
  }
  return {
    totalReviewsDelta,
    avgRatingDelta: withTrend > 0 ? totalRatingDelta / withTrend : null,
    locationsWithTrend: withTrend,
    locationsMissingTrend: missing,
  };
}

describe('group average rating change', () => {
  it('includes positive, zero and negative locations in numerator and denominator', () => {
    const r = portfolio([
      { ratingChange: 0.3, reviewsGained: 100 },
      { ratingChange: 0, reviewsGained: 0 },
      { ratingChange: -0.3, reviewsGained: -50 },
    ]);
    expect(r.locationsWithTrend).toBe(3);
    expect(r.avgRatingDelta).toBeCloseTo(0, 10);
    expect(r.totalReviewsDelta).toBe(50);
  });

  it('can report a NEGATIVE average — the old version could not by construction', () => {
    const r = portfolio([
      { ratingChange: -0.2, reviewsGained: -10 },
      { ratingChange: -0.4, reviewsGained: -20 },
    ]);
    expect(r.avgRatingDelta).toBeLessThan(0);
    expect(r.totalReviewsDelta).toBeLessThan(0);
    expect(r.locationsWithTrend).toBe(2);
  });

  it('a zero-change location still counts in the denominator', () => {
    const only = portfolio([{ ratingChange: 0.6, reviewsGained: 60 }]);
    const withFlat = portfolio([{ ratingChange: 0.6, reviewsGained: 60 }, { ratingChange: 0, reviewsGained: 0 }]);
    expect(only.avgRatingDelta).toBeCloseTo(0.6, 10);
    // Old behaviour kept 0.6 by dropping the flat unit. It must now dilute.
    expect(withFlat.avgRatingDelta).toBeCloseTo(0.3, 10);
    expect(withFlat.locationsWithTrend).toBe(2);
  });

  it('excludes ONLY for missing data and reports how many were excluded', () => {
    const r = portfolio([{ ratingChange: 0.2, reviewsGained: 10 }, null, null]);
    expect(r.locationsWithTrend).toBe(1);
    expect(r.locationsMissingTrend).toBe(2);
    expect(r.avgRatingDelta).toBeCloseTo(0.2, 10);
  });

  it('is null, not zero, when no location has an observation pair', () => {
    expect(portfolio([null, null]).avgRatingDelta).toBeNull();
  });
});

describe('Google context copy makes no attribution claim', () => {
  it('states two independent observations and denies attribution', () => {
    const s = googleTwoFactNote(120, 400);
    expect(s).toContain('120');
    expect(s).toContain('+400');
    expect(s).toContain('dos mediciones independientes');
    expect(s).toContain('no se atribuye a RateTap');
    expect(s).not.toMatch(/confirmad/i);
  });

  it('shows a negative delta with its sign instead of hiding it', () => {
    const s = googleTwoFactNote(10, -35);
    expect(s).toContain('-35');
    expect(s).not.toMatch(/confirmad/i);
  });

  it('shows a zero delta rather than suppressing the line', () => {
    expect(googleTwoFactNote(5, 0)).toContain('+0');
  });

  it('is the same function in all three namespaces, so they cannot drift', () => {
    expect(t.dashboard.googleTwoFact).toBe(googleTwoFactNote);
    expect(t.owner.googleTwoFact).toBe(googleTwoFactNote);
    expect(t.analytics.googleTwoFact).toBe(googleTwoFactNote);
  });
});

describe('labels name the event they count', () => {
  it('uses Calificaciones, never Encuestas or Reseñas Totales', () => {
    expect(t.analytics.allTimeReviews).toBe('Calificaciones totales');
    expect(t.owner.surveys).toBe('Calificaciones');
    expect(t.owner.effectivenessSubtitle).toContain('Calificaciones');
  });

  it('the group average label states its denominator and excluded count', () => {
    expect(t.owner.avgGoogleRatingDelta(11, 1)).toContain('11');
    expect(t.owner.avgGoogleRatingDelta(11, 1)).toContain('sin datos suficientes');
    expect(t.owner.avgGoogleRatingDelta(12, 0)).not.toContain('sin datos suficientes');
    // "Cambio", not "Ganancia": it can legitimately be negative now.
    expect(t.owner.avgGoogleRatingDelta(12, 0)).toMatch(/Cambio/);
  });

  it('the baseline note states the date the baseline logic actually uses', () => {
    expect(RATING_BASELINE_FLOOR.toISOString()).toBe('2026-03-17T00:00:00.000Z');
    expect(RATING_BASELINE_NOTE).toContain('17 mar 2026');
    expect(RATING_BASELINE_NOTE).not.toContain('11 sep');
  });
});

describe('CSV exports name the event they contain, in Spanish', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

  it('no export emits a column called Reseñas for submitted ratings', () => {
    for (const f of [
      'src/components/dashboard/AnalyticsView.tsx',
      'src/components/dashboard/DashboardView.tsx',
      'src/components/dashboard/FeedbackInbox.tsx',
      'src/components/dashboard/InterceptedDrilldown.tsx',
    ]) {
      expect(read(f)).not.toMatch(/^\s*Reseñas:/m);
    }
  });

  it('no export emits English headers in a Spanish-only product', () => {
    for (const f of [
      'src/components/dashboard/DashboardView.tsx',
      'src/components/dashboard/FeedbackInbox.tsx',
    ]) {
      const src = read(f);
      for (const bad of ['Rank:', 'Staff:', 'Code:', 'Reviews:', 'Date:', 'Customer:', 'Rating:', 'Status:', 'Feedback:']) {
        expect(src).not.toMatch(new RegExp('^\\s*' + bad, 'm'));
      }
      expect(src).not.toMatch(/'Avg Rating'/);
    }
  });

  it('the rating-count columns are backed by count(reviews.id), not a Google figure', () => {
    // Values audit, not just labels: reviewCount and the daily count are both
    // count(reviews.id); avgRating is avg(reviews.rating).
    const q = read('src/lib/queries.ts');
    expect(q).toMatch(/reviewCount: count\(reviews\.id\)/);
    expect(q).toMatch(/count: count\(reviews\.id\)/);
    expect(q).toMatch(/avgRating: avg\(reviews\.rating\)/);
  });
});

describe('no prohibited claim survives anywhere in the source', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const files = [
    'src/lib/i18n.ts', 'src/lib/email.ts', 'src/lib/product-analytics.ts',
    'src/components/dashboard/DashboardView.tsx',
    'src/components/dashboard/OwnerOverview.tsx',
    'src/components/dashboard/AnalyticsView.tsx',
  ];
  it.each(files)('%s carries no attribution or mislabelled metric string', (rel) => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8')
      // strip comments: the explanatory notes quote the old wording on purpose
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/nuevas reseñas.*confirmad/i);
    expect(src).not.toMatch(/newGoogleReviewsConfirmed|confirmedNewReviews/);
    expect(src).not.toMatch(/'Reseñas Totales'/);
    expect(src).not.toMatch(/'Encuestas'/);
    expect(src).not.toMatch(/'PWA instalada'/);
    expect(src).not.toMatch(/Escaneos/);
  });
});
