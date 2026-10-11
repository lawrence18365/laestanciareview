import type { GroupShareSummary } from '@/lib/maps-rank-group';
import { t } from '@/lib/i18n';

const MAX_HOLDERS = 3;
const TWO_PLUS_MIN = 5;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "{city} · {keyword}", with the trailing city dropped from the keyword. */
function placeLabel(s: GroupShareSummary): string {
  const city = s.city.trim();
  const keyword = s.keyword.trim();
  const trailingCity = new RegExp(`\\s+${escapeRegExp(city)}$`, 'i');
  const bare = city && trailingCity.test(keyword) ? keyword.replace(trailingCity, '') : keyword;
  return `${city} · ${bare}`;
}

/** Counts only, never exact ranks or server names. */
function resultText(s: GroupShareSummary): string {
  let text: string;
  if (s.pointsTwoPlus >= TWO_PLUS_MIN) text = t.groupShare.twoPlus(s.pointsTwoPlus, s.measured);
  else if (s.pointsAny >= 1) text = t.groupShare.anyOne(s.pointsAny, s.measured);
  else text = t.groupShare.none;
  if (s.holders.length > 0) {
    text += ' ' + t.groupShare.holders(s.holders.slice(0, MAX_HOLDERS).map((h) => h.name).join(', '));
  }
  if (s.prevAvgTop3 != null) text += ` · ${t.groupShare.before(s.prevAvgTop3)}`;
  return text;
}

/** One row per city x search, in input order. Shared by the owner email and the /overview card. */
export function groupShareRows(summaries: GroupShareSummary[]): { label: string; result: string }[] {
  return summaries
    .filter((s) => s.measured > 0)
    .map((s) => ({ label: placeLabel(s), result: resultText(s) }));
}

export default function GroupShareCard({ summaries }: { summaries: GroupShareSummary[] }) {
  if (process.env.MAPS_RANK_ENABLED !== 'true') return null;
  const rows = groupShareRows(summaries);
  if (rows.length === 0) return null;

  return (
    <section className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)' }}>
        {t.groupShare.title}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {rows.map((row, i) => (
          <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' }}>
            <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.label}:</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>{row.result}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: '1rem 0 0 0', fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
        {t.groupShare.footnote}
      </p>
    </section>
  );
}
