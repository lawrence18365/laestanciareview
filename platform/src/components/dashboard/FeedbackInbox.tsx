'use client';

import { useState, useMemo } from 'react';
import { downloadCSV } from '@/lib/csv';
import { t } from '@/lib/i18n';

interface FeedbackItem {
  id: number;
  rating: number;
  customerName: string | null;
  customerEmail: string | null;
  feedback: string | null;
  staffName: string | null;
  staffCode: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: string;
}

interface Props {
  initialFeedback: FeedbackItem[];
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  margin: 0,
  marginBottom: '1rem',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  borderRadius: 0,
  border: active ? '1px solid var(--border-dark)' : '1px solid var(--panel-border)',
  background: active ? 'var(--text-main)' : 'var(--panel-bg)',
  color: active ? '#FFFFFF' : 'var(--text-muted)',
  fontSize: '0.7rem',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
});

const statusBorderColors: Record<string, string> = {
  new: 'var(--gold)',
  reviewed: 'var(--blue)',
  resolved: 'var(--green)',
};

const statusBadge = (status: string): React.CSSProperties => {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    new: { bg: 'var(--gold-light)', color: 'var(--gold)', border: 'var(--gold)' },
    reviewed: { bg: 'rgba(37,99,235,0.08)', color: 'var(--blue)', border: 'var(--blue)' },
    resolved: { bg: 'var(--green-light)', color: 'var(--green)', border: 'var(--green)' },
  };
  const s = map[status] ?? map.new;
  return {
    padding: '0.15rem 0.5rem',
    borderRadius: 0,
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    background: s.bg,
    color: s.color,
    border: `1px solid ${s.border}`,
  };
};

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderRadius: 0,
  border: '1px solid var(--border-dark)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-sans)',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
};

const actionButton = (color: string, bg: string, borderColor: string): React.CSSProperties => ({
  padding: '0.3rem 0.75rem',
  borderRadius: 0,
  border: `1px solid ${borderColor}`,
  background: bg,
  color: color,
  fontSize: '0.65rem',
  fontWeight: 600,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  textDecoration: 'none',
  fontFamily: 'var(--font-sans)',
});

export default function FeedbackInbox({ initialFeedback }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>(initialFeedback);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest');

  const filtered = useMemo(() => {
    const result = items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (ratingFilter > 0 && item.rating !== ratingFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (item.customerName ?? '').toLowerCase();
        const text = (item.feedback ?? '').toLowerCase();
        const staff = (item.staffName ?? '').toLowerCase();
        if (!name.includes(q) && !text.includes(q) && !staff.includes(q)) return false;
      }
      return true;
    });

    return result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return b.createdAt.localeCompare(a.createdAt);
        case 'oldest':
          return a.createdAt.localeCompare(b.createdAt);
        case 'highest':
          return b.rating - a.rating || b.createdAt.localeCompare(a.createdAt);
        case 'lowest':
          return a.rating - b.rating || b.createdAt.localeCompare(a.createdAt);
        default:
          return 0;
      }
    });
  }, [items, statusFilter, ratingFilter, search, sortBy]);

  async function updateStatus(id: number, newStatus: string) {
    try {
      const res = await fetch('/api/auth/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: id, status: newStatus }),
      });

      if (res.ok) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: newStatus as FeedbackItem['status'] } : item,
          ),
        );
      }
    } catch {
      // Network error — status stays unchanged in UI
    }
  }

  function handleExport() {
    const rows = filtered.map((f) => ({
      Date: f.createdAt.slice(0, 10),
      Customer: f.customerName ?? '',
      Email: f.customerEmail ?? '',
      Rating: f.rating,
      Staff: f.staffName ?? '',
      Status: f.status,
      Feedback: f.feedback ?? '',
    }));
    downloadCSV(rows, 'feedback-export.csv');
  }

  const counts = useMemo(() => {
    const c = { all: items.length, new: 0, reviewed: 0, resolved: 0 };
    for (const item of items) {
      c[item.status]++;
    }
    return c;
  }, [items]);

  if (initialFeedback.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <section className="flat-panel" style={{
          padding: '4rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '0.75rem',
        }}>
          <p style={{
            margin: 0,
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}>
            BANDEJA DE ENTRADA
          </p>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 600,
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-main)',
          }}>
            Aún no hay comentarios de clientes
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.9375rem',
            color: 'var(--text-muted)',
            maxWidth: 420,
            lineHeight: 1.5,
          }}>
            Aparecerán aquí cuando alguien deje feedback.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['all', 'new', 'reviewed', 'resolved'] as const).map((s) => (
            <button key={s} style={tabStyle(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? t.inbox.all : s === 'new' ? t.inbox.new : s === 'reviewed' ? t.inbox.reviewed : t.inbox.resolved} ({counts[s]})
            </button>
          ))}
        </div>

        <select
          value={ratingFilter}
          onChange={(e) => setRatingFilter(Number(e.target.value))}
          style={{
            ...inputStyle,
            padding: '0.4rem 0.6rem',
          }}
        >
          <option value={0}>{t.inbox.allRatings}</option>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r} ★
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'highest' | 'lowest')}
          style={{
            ...inputStyle,
            padding: '0.4rem 0.6rem',
          }}
        >
          <option value="newest">{t.inbox.sortNewest}</option>
          <option value="oldest">{t.inbox.sortOldest}</option>
          <option value="highest">{t.inbox.sortHighest}</option>
          <option value="lowest">{t.inbox.sortLowest}</option>
        </select>

        <input
          type="text"
          placeholder={t.inbox.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            ...inputStyle,
            flex: 1,
            minWidth: 180,
          }}
        />

        <button
          onClick={handleExport}
          style={actionButton('var(--text-main)', 'var(--panel-bg)', 'var(--border-dark)')}
        >
          {t.inbox.exportCsv}
        </button>
      </div>

      {/* Feedback List */}
      <section className="flat-panel" style={{ padding: '1.5rem' }}>
        <h2 style={sectionLabel}>
          {t.inbox.customerFeedback} ({filtered.length})
        </h2>

        {filtered.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 }}>
            {t.inbox.noFeedbackMatches}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtered.map((fb) => (
              <div
                key={fb.id}
                style={{
                  padding: '1rem',
                  borderRadius: 0,
                  background: 'var(--bg-base)',
                  borderLeft: `3px solid ${statusBorderColors[fb.status] ?? 'var(--border-dark)'}`,
                  border: '1px solid var(--panel-border)',
                  borderLeftWidth: 3,
                  borderLeftColor: statusBorderColors[fb.status] ?? 'var(--border-dark)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>
                      {fb.customerName || t.inbox.anonymous}
                    </span>
                    <span style={statusBadge(fb.status)}>
                      {fb.status}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}
                    {' · '}
                    {fb.createdAt.slice(0, 10)}
                    {fb.staffName && ` · ${fb.staffName}`}
                  </span>
                </div>

                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {fb.feedback}
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {fb.status === 'new' && (
                    <button
                      onClick={() => updateStatus(fb.id, 'reviewed')}
                      style={actionButton('var(--blue)', 'rgba(37,99,235,0.08)', 'var(--blue)')}
                    >
                      {t.inbox.markReviewed}
                    </button>
                  )}
                  {fb.status !== 'resolved' && (
                    <button
                      onClick={() => updateStatus(fb.id, 'resolved')}
                      style={actionButton('var(--green)', 'var(--green-light)', 'var(--green)')}
                    >
                      {t.inbox.resolve}
                    </button>
                  )}
                  {fb.customerEmail && (
                    <a
                      href={`mailto:${encodeURIComponent(fb.customerEmail)}?subject=${encodeURIComponent(t.inbox.reYourFeedback)}`}
                      style={actionButton('var(--text-main)', 'transparent', 'var(--border-dark)')}
                    >
                      {t.inbox.replyViaEmail}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
