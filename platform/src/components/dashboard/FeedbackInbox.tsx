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

const card: React.CSSProperties = {
  background: 'var(--warm-white)',
  borderRadius: 10,
  padding: '1.5rem',
  boxShadow: 'var(--shadow-sm)',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-cormorant), serif',
  fontSize: '1.3rem',
  fontWeight: 600,
  marginTop: 0,
  marginBottom: '1rem',
  color: 'var(--espresso)',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  borderRadius: 6,
  border: 'none',
  background: active ? 'var(--espresso)' : 'var(--stone-100)',
  color: active ? 'var(--warm-white)' : 'var(--stone-700)',
  fontSize: '0.85rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

const statusColors: Record<string, { bg: string; color: string }> = {
  new: { bg: '#fef3c7', color: '#92400e' },
  reviewed: { bg: '#dbeafe', color: '#1e40af' },
  resolved: { bg: 'var(--success-light)', color: 'var(--success)' },
};

export default function FeedbackInbox({ initialFeedback }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>(initialFeedback);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<number>(0);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return items.filter((item) => {
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
  }, [items, statusFilter, ratingFilter, search]);

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
      Date: new Date(f.createdAt).toLocaleDateString(),
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
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
            padding: '0.4rem 0.6rem',
            borderRadius: 6,
            border: '1px solid var(--stone-300)',
            fontSize: '0.85rem',
            background: 'var(--warm-white)',
          }}
        >
          <option value={0}>{t.inbox.allRatings}</option>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r} ★
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder={t.inbox.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid var(--stone-300)',
            fontSize: '0.85rem',
            flex: 1,
            minWidth: 180,
          }}
        />

        <button
          onClick={handleExport}
          style={{
            padding: '0.4rem 1rem',
            borderRadius: 6,
            border: '1px solid var(--stone-300)',
            background: 'transparent',
            fontSize: '0.85rem',
            cursor: 'pointer',
            color: 'var(--stone-700)',
            fontWeight: 500,
          }}
        >
          {t.inbox.exportCsv}
        </button>
      </div>

      {/* Feedback List */}
      <section style={card}>
        <h2 style={sectionTitle}>
          {t.inbox.customerFeedback} ({filtered.length})
        </h2>

        {filtered.length === 0 ? (
          <p style={{ color: 'var(--stone-400)', fontSize: '0.9rem', fontStyle: 'italic', margin: 0 }}>
            {t.inbox.noFeedbackMatches}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtered.map((fb) => {
              const sc = statusColors[fb.status];
              return (
                <div
                  key={fb.id}
                  style={{
                    padding: '1rem',
                    borderRadius: 8,
                    background: 'var(--linen)',
                    borderLeft: `3px solid ${fb.rating >= 4 ? 'var(--success)' : fb.rating >= 3 ? 'var(--amber-500)' : '#dc2626'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                        {fb.customerName || t.inbox.anonymous}
                      </span>
                      <span
                        style={{
                          padding: '0.1rem 0.5rem',
                          borderRadius: 999,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          background: sc.bg,
                          color: sc.color,
                        }}
                      >
                        {fb.status}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--stone-500)' }}>
                      {'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}
                      {' · '}
                      {new Date(fb.createdAt).toLocaleDateString()}
                      {fb.staffName && ` · ${fb.staffName}`}
                    </span>
                  </div>

                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: 'var(--stone-700)' }}>
                    {fb.feedback}
                  </p>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {fb.status === 'new' && (
                      <button
                        onClick={() => updateStatus(fb.id, 'reviewed')}
                        style={{
                          padding: '0.25rem 0.7rem',
                          borderRadius: 6,
                          border: '1px solid #93c5fd',
                          background: '#dbeafe',
                          color: '#1e40af',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        {t.inbox.markReviewed}
                      </button>
                    )}
                    {fb.status !== 'resolved' && (
                      <button
                        onClick={() => updateStatus(fb.id, 'resolved')}
                        style={{
                          padding: '0.25rem 0.7rem',
                          borderRadius: 6,
                          border: '1px solid #86efac',
                          background: 'var(--success-light)',
                          color: 'var(--success)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        {t.inbox.resolve}
                      </button>
                    )}
                    {fb.customerEmail && (
                      <a
                        href={`mailto:${encodeURIComponent(fb.customerEmail)}?subject=${encodeURIComponent(t.inbox.reYourFeedback)}`}
                        style={{
                          padding: '0.25rem 0.7rem',
                          borderRadius: 6,
                          border: '1px solid var(--stone-300)',
                          background: 'transparent',
                          color: 'var(--stone-700)',
                          fontSize: '0.8rem',
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                      >
                        {t.inbox.replyViaEmail}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
