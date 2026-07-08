'use client';

import { useState, useMemo } from 'react';
import { downloadCSV } from '@/lib/csv';
import { t } from '@/lib/i18n';
import { getBrandForSlug } from '@/lib/brands';

interface InterceptedReview {
  id: number;
  restaurantId: number;
  restaurantName: string;
  slug: string;
  rating: number;
  feedback: string | null;
  customerName: string | null;
  customerEmail: string | null;
  staffName: string | null;
  staffCode: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: string;
}

interface Props {
  reviews: InterceptedReview[];
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}, ${h}:${m}`;
}

const statusColors: Record<string, { bg: string; color: string; border: string }> = {
  new: { bg: 'var(--gold-light)', color: 'var(--gold)', border: 'var(--gold)' },
  reviewed: { bg: 'rgba(37,99,235,0.08)', color: 'var(--blue)', border: 'var(--blue)' },
  resolved: { bg: 'var(--green-light)', color: 'var(--green)', border: 'var(--green)' },
};

const statusLabel: Record<string, string> = {
  new: t.intercepted.new,
  reviewed: t.intercepted.reviewed,
  resolved: t.intercepted.resolved,
};

export default function InterceptedDrilldown({ reviews }: Props) {
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);

  // Get unique units
  const units = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; count: number }>();
    for (const r of reviews) {
      const key = r.slug;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { name: r.restaurantName, slug: r.slug, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [reviews]);

  // Get unique ratings present
  const ratingsPresent = useMemo(() => {
    const set = new Set<number>();
    for (const r of reviews) set.add(r.rating);
    return [...set].sort();
  }, [reviews]);

  // Filter reviews
  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (unitFilter !== 'all' && r.slug !== unitFilter) return false;
      if (ratingFilter !== 'all' && r.rating !== ratingFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [reviews, unitFilter, ratingFilter, statusFilter]);

  // Group by unit
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; reviews: InterceptedReview[] }>();
    for (const r of filtered) {
      const key = r.slug;
      const existing = map.get(key);
      if (existing) {
        existing.reviews.push(r);
      } else {
        map.set(key, { name: r.restaurantName, slug: r.slug, reviews: [r] });
      }
    }
    return [...map.values()].sort((a, b) => b.reviews.length - a.reviews.length);
  }, [filtered]);

  const handleExport = () => {
    downloadCSV(
      filtered.map((r) => ({
        Ubicación: r.restaurantName,
        Fecha: formatDateTime(r.createdAt),
        Calificación: r.rating,
        Cliente: r.customerName || t.intercepted.anonymous,
        Email: r.customerEmail || '',
        Personal: r.staffName || '',
        Código: r.staffCode || '',
        Comentario: r.feedback || '',
        Estado: statusLabel[r.status] || r.status,
      })),
      'feedback-privado.csv',
    );
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="stagger-1">
        <a
          href="/overview"
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-dim)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            marginBottom: '0.75rem',
          }}
        >
          &larr; {t.intercepted.backToOverview}
        </a>
        <h1 className="text-editorial" style={{ margin: '0 0 0.5rem 0' }}>
          {t.intercepted.title}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1rem' }}>
          {t.intercepted.subtitle}
        </p>
      </div>

      {/* Total banner */}
      <div
        className="card stagger-2"
        style={{
          padding: '1.5rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          borderLeft: '4px solid var(--gold)',
        }}
      >
        <div>
          <p style={{
            margin: 0,
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}>
            {t.intercepted.totalIntercepted}
          </p>
          <p className="font-numeric" style={{
            margin: '0.25rem 0 0',
            fontSize: '2.5rem',
            fontWeight: 700,
            color: 'var(--gold)',
            lineHeight: 1,
            fontFamily: 'var(--font-serif)',
          }}>
            {filtered.length}
          </p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {t.intercepted.subtitle}
          </p>
        </div>
        {filtered.length > 0 && (
          <button className="btn btn-outline" onClick={handleExport} style={{ fontSize: '0.8125rem', padding: '0.4rem 1rem' }}>
            {t.intercepted.exportCsv}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card stagger-2" style={{
        padding: '1rem 1.25rem',
        display: 'flex',
        gap: '0.75rem',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <select
          value={unitFilter}
          onChange={(e) => { setUnitFilter(e.target.value); setExpandedUnit(null); }}
          style={selectStyle}
        >
          <option value="all">{t.intercepted.allUnits} ({reviews.length})</option>
          {units.map((u) => (
            <option key={u.slug} value={u.slug}>{u.name} ({u.count})</option>
          ))}
        </select>

        <select
          value={ratingFilter === 'all' ? 'all' : String(ratingFilter)}
          onChange={(e) => setRatingFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          style={selectStyle}
        >
          <option value="all">{t.intercepted.allRatings}</option>
          {ratingsPresent.map((r) => (
            <option key={r} value={r}>{'★'.repeat(r)}{'☆'.repeat(5 - r)}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">{t.intercepted.allStatuses}</option>
          <option value="new">{t.intercepted.new}</option>
          <option value="reviewed">{t.intercepted.reviewed}</option>
          <option value="resolved">{t.intercepted.resolved}</option>
        </select>
      </div>

      {/* Empty state */}
      {grouped.length === 0 && (
        <div className="card stagger-3" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9375rem', fontFamily: 'var(--font-serif)' }}>
            {t.intercepted.noResults}
          </p>
        </div>
      )}

      {/* Per-unit groups */}
      {grouped.map((group) => {
        const brand = getBrandForSlug(group.slug);
        const isExpanded = expandedUnit === group.slug || unitFilter !== 'all';
        const showToggle = unitFilter === 'all';

        return (
          <section
            key={group.slug}
            className="card stagger-3"
            style={{ overflow: 'hidden' }}
          >
            {/* Unit header */}
            <div
              style={{
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                cursor: showToggle ? 'pointer' : 'default',
                borderBottom: isExpanded ? '1px solid var(--panel-border)' : 'none',
              }}
              onClick={() => {
                if (showToggle) setExpandedUnit(isExpanded ? null : group.slug);
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  overflow: 'hidden',
                  background: brand.darkBg ? '#000' : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  border: '1px solid var(--border-dark)',
                }}
              >
                <img
                  src={brand.logo}
                  alt={group.name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 2 }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem', fontFamily: 'var(--font-serif)', color: 'var(--text-main)' }}>
                  {group.name}
                </p>
              </div>

              <span className="font-numeric" style={{
                fontWeight: 700,
                fontSize: '1.25rem',
                color: 'var(--gold)',
              }}>
                {group.reviews.length}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                {t.intercepted.reviews(group.reviews.length)}
              </span>

              {showToggle && (
                <span style={{
                  fontSize: '1rem',
                  color: 'var(--text-dim)',
                  transition: 'transform 0.2s',
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}>
                  &#9662;
                </span>
              )}
            </div>

            {/* Expanded review list */}
            {isExpanded && (
              <div>
                {group.reviews.map((review) => (
                  <div
                    key={review.id}
                    style={{
                      padding: '1rem 1.25rem',
                      borderTop: '1px solid var(--panel-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    {/* Top row: rating + date + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <RatingBadge rating={review.rating} />
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                        {formatDateTime(review.createdAt)}
                      </span>
                      <StatusBadge status={review.status} />
                      <div style={{ flex: 1 }} />
                      {review.staffName && (
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                          {review.staffName}
                          {review.staffCode && (
                            <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>({review.staffCode})</span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Feedback text */}
                    {review.feedback ? (
                      <div style={{
                        padding: '0.75rem 1rem',
                        background: 'var(--bg-base)',
                        borderLeft: '3px solid var(--gold)',
                        fontSize: '0.9375rem',
                        lineHeight: 1.6,
                        color: 'var(--text-main)',
                        fontStyle: 'italic',
                      }}>
                        &ldquo;{review.feedback}&rdquo;
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        {t.intercepted.noFeedback}
                      </p>
                    )}

                    {/* Customer info */}
                    {(review.customerName || review.customerEmail) && (
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {review.customerName && <span style={{ fontWeight: 500 }}>{review.customerName}</span>}
                        {review.customerEmail && (
                          <span style={{ marginLeft: review.customerName ? 8 : 0, color: 'var(--text-dim)' }}>
                            {review.customerEmail}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ── Sub-components ── */

function RatingBadge({ rating }: { rating: number }) {
  const color = rating <= 2 ? 'var(--red)' : 'var(--gold)';
  const bg = rating <= 2 ? 'rgba(220,38,38,0.08)' : 'var(--gold-light)';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      padding: '0.15rem 0.5rem',
      fontSize: '0.8125rem',
      fontWeight: 700,
      color,
      background: bg,
      border: `1px solid ${color}`,
    }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = statusColors[status] ?? statusColors.new;
  return (
    <span style={{
      padding: '0.15rem 0.5rem',
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
    }}>
      {statusLabel[status] || status}
    </span>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  border: '1px solid var(--border-dark)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-sans)',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  borderRadius: 0,
};
