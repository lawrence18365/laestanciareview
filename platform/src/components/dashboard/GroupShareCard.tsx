import type { CSSProperties } from 'react';
import type { GroupShareSummary } from '@/lib/maps-rank-group';
import { t } from '@/lib/i18n';

const DOTS = 3;
const MAX_WHO = 2;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The keyword with the trailing city dropped: "cabrito Monterrey" -> "cabrito". */
function searchLabel(s: GroupShareSummary): string {
  const city = s.city.trim();
  const keyword = s.keyword.trim();
  const trailingCity = new RegExp(`\\s+${escapeRegExp(city)}$`, 'i');
  return city && trailingCity.test(keyword) ? keyword.replace(trailingCity, '') : keyword;
}

/** Brand guess from a restaurant name: everything but the last word ("La Silla Juárez" -> "La Silla"). */
function brandOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(' ') : words[0] ?? '';
}

/** Holders collapsed by brand: a unique holder keeps its full name, duplicates read "Brand ×n". */
function whoItems(s: GroupShareSummary): string[] {
  const order: string[] = [];
  const byBrand = new Map<string, { name: string; count: number }>();
  for (const h of s.holders) {
    const brand = brandOf(h.name);
    const entry = byBrand.get(brand);
    if (entry) entry.count += 1;
    else {
      byBrand.set(brand, { name: h.name, count: 1 });
      order.push(brand);
    }
  }
  return order.map((brand) => {
    const entry = byBrand.get(brand)!;
    return entry.count > 1 ? `${brand} ×${entry.count}` : entry.name;
  });
}

export interface GroupShareRow {
  search: string;
  /** Filled dots: round(avgTop3), 0..3. */
  filled: number;
  pointsAny: number;
  measured: number;
  /** Arrow only when the rounded average moved since the previous run. */
  trend: 'up' | 'down' | null;
  /** Empty when no holder: the row reads "Oportunidad". */
  who: string[];
  /** Holders past the first two. */
  whoMore: number;
}

export interface GroupShareCity {
  city: string;
  rows: GroupShareRow[];
}

/**
 * Group rows by city. Cities with more rows come first; within a city, rows with
 * more dots come first, then more points. Shared by the owner email and the /overview card.
 */
export function groupShareCities(summaries: GroupShareSummary[]): GroupShareCity[] {
  const byCity = new Map<string, GroupShareRow[]>();
  for (const s of summaries) {
    if (s.measured <= 0) continue;
    const filled = Math.min(DOTS, Math.max(0, Math.round(s.avgTop3)));
    let trend: GroupShareRow['trend'] = null;
    if (s.prevAvgTop3 != null && Math.round(s.prevAvgTop3) !== Math.round(s.avgTop3)) {
      trend = Math.round(s.avgTop3) > Math.round(s.prevAvgTop3) ? 'up' : 'down';
    }
    const who = whoItems(s);
    const row: GroupShareRow = {
      search: searchLabel(s),
      filled,
      pointsAny: s.pointsAny,
      measured: s.measured,
      trend,
      who: who.slice(0, MAX_WHO),
      whoMore: Math.max(0, who.length - MAX_WHO),
    };
    const city = s.city.trim();
    const rows = byCity.get(city) ?? [];
    rows.push(row);
    byCity.set(city, rows);
  }
  return [...byCity.entries()]
    .map(([city, rows]) => ({
      city,
      rows: rows.sort((a, b) => b.filled - a.filled || b.pointsAny - a.pointsAny),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || a.city.localeCompare(b.city));
}

const cell: CSSProperties = {
  padding: '0.5rem 0.5rem 0.5rem 0',
  verticalAlign: 'top',
  borderTop: '1px solid var(--border, #E5E5E5)',
};

export default function GroupShareCard({ summaries }: { summaries: GroupShareSummary[] }) {
  if (process.env.MAPS_RANK_ENABLED !== 'true') return null;
  const cities = groupShareCities(summaries);
  if (cities.length === 0) return null;

  return (
    <section className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)' }}>
        {t.groupShare.title}
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}>
        <tbody>
          {cities.map((c) => (
            <CityRows key={c.city} city={c.city} rows={c.rows} />
          ))}
        </tbody>
      </table>
      <p style={{ margin: '1rem 0 0 0', fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
        {t.groupShare.footnote}
      </p>
    </section>
  );
}

function CityRows({ city, rows }: { city: string; rows: GroupShareRow[] }) {
  return (
    <>
      <tr>
        <td colSpan={3} style={{ padding: '0.75rem 0 0.25rem 0', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {city}
        </td>
      </tr>
      {rows.map((row, i) => {
        const dotsTitle = t.groupShare.dotsTitle(row.pointsAny, row.measured);
        return (
          <tr key={i}>
            <td style={{ ...cell, width: '40%', color: 'var(--text-main)', fontWeight: 500 }}>{row.search}</td>
            <td style={{ ...cell, whiteSpace: 'nowrap' }} title={dotsTitle} aria-label={dotsTitle}>
              {Array.from({ length: DOTS }, (_, d) => (
                <span key={d} style={{ color: d < row.filled ? 'var(--primary, #059669)' : '#D4D4D4' }}>
                  {d < row.filled ? '●' : '○'}
                </span>
              ))}
              <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                {row.pointsAny}/{row.measured}
              </span>
              {row.trend && (
                <span style={{ marginLeft: '0.25rem', fontSize: '0.6875rem', color: 'var(--text-dim)' }}>
                  {row.trend === 'up' ? '▲' : '▼'}
                </span>
              )}
            </td>
            <td style={{ ...cell, color: 'var(--text-muted)' }}>
              {row.who.length === 0 ? (
                <strong style={{ color: '#B45309' }}>{t.groupShare.opportunity}</strong>
              ) : (
                <>
                  {row.who.join(', ')}
                  {row.whoMore > 0 && ` ${t.groupShare.more(row.whoMore)}`}
                </>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
