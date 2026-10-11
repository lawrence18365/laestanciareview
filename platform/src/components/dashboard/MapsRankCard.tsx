import type { KeywordSummary } from '@/lib/maps-rank';
import { t } from '@/lib/i18n';

function band(s: KeywordSummary): string {
  if (s.top3 > 0) return t.mapsRank.top3(s.top3, s.measured);
  if (s.top10 > 0) return t.mapsRank.top10(s.top10, s.measured);
  return t.mapsRank.notFound;
}

function trend(s: KeywordSummary): { arrow: string; label: string } | null {
  if (s.prevTop3 === null) return null;
  if (s.top3 > s.prevTop3) return { arrow: '↑', label: t.mapsRank.up };
  if (s.top3 < s.prevTop3) return { arrow: '↓', label: t.mapsRank.down };
  return { arrow: '=', label: t.mapsRank.same };
}

export default function MapsRankCard({ summaries }: { summaries: KeywordSummary[] }) {
  if (process.env.MAPS_RANK_ENABLED !== 'true' || summaries.length === 0) return null;

  const runDate = summaries.map((s) => s.runDate).sort().at(-1) ?? '';

  return (
    <section className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)' }}>
        {t.mapsRank.title}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {summaries.map((s) => {
          const tr = trend(s);
          return (
            <li key={s.keyword} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.25rem 1rem' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{s.keyword}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
                {band(s)}
                {tr && (
                  <>
                    {' · '}
                    {t.mapsRank.before(s.prevTop3 ?? 0)}{' '}
                    <span aria-hidden="true">{tr.arrow}</span>
                    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                      {tr.label}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p style={{ margin: '1rem 0 0 0', fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
        {t.mapsRank.footer(runDate)}
      </p>
    </section>
  );
}
