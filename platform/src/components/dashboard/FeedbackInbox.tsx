'use client';

import { useState, useMemo } from 'react';
import { t } from '@/lib/i18n';
import { track } from '@/lib/analytics-client';
import { downloadCSV } from '@/lib/csv';
import { classifyReview, SEVERITY_LABEL } from '@/lib/review-classification';
import {
  partitionFocused,
  RESOLUTION_LABEL,
  RESOLUTIONS,
  reviewedViaFor,
  statusPatchBody,
  type Resolution,
} from '@/lib/review-recovery';

interface FeedbackItem {
  id: number;
  rating: number;
  customerName: string | null;
  customerEmail: string | null;
  feedback: string | null;
  staffName: string | null;
  staffCode: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  resolution: Resolution | null;
  createdAt: string;
}

interface Props {
  initialFeedback: FeedbackItem[];
  focusReviewId?: number;
  focusSource?: 'push' | 'email';
}

type FeedbackSection = 'complaints' | 'recognitions';
type StatusFilter = 'all' | FeedbackItem['status'] | 'read';

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

const sectionTabStyle = (active: boolean, positive: boolean): React.CSSProperties => ({
  ...tabStyle(active),
  padding: '0.65rem 1.25rem',
  borderColor: active && positive ? 'var(--green)' : active ? 'var(--border-dark)' : 'var(--panel-border)',
  background: active && positive ? 'var(--green)' : active ? 'var(--text-main)' : 'var(--panel-bg)',
});

const statusBorderColors: Record<string, string> = {
  new: 'var(--gold)',
  reviewed: 'var(--blue)',
  resolved: 'var(--green)',
};

const statusBadge = (status: string, positive: boolean): React.CSSProperties => {
  if (positive) {
    return {
      padding: '0.15rem 0.5rem',
      borderRadius: 0,
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: status === 'new' ? 'var(--panel-bg)' : 'var(--green-light)',
      color: 'var(--green)',
      border: '1px solid var(--green)',
    };
  }

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

const statusLabel = (status: FeedbackItem['status'], positive: boolean): string => {
  if (positive) return status === 'new' ? t.inbox.unread : t.inbox.read;
  if (status === 'new') return t.inbox.new;
  if (status === 'reviewed') return t.inbox.reviewed;
  return t.inbox.resolved;
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
  color,
  fontSize: '0.65rem',
  fontWeight: 600,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  textDecoration: 'none',
  fontFamily: 'var(--font-sans)',
});

export default function FeedbackInbox({ initialFeedback, focusReviewId, focusSource }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>(initialFeedback);
  const [activeSection, setActiveSection] = useState<FeedbackSection>('complaints');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [ratingFilter, setRatingFilter] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest');
  const [resolvingReviewId, setResolvingReviewId] = useState<number | null>(null);

  const positiveSection = activeSection === 'recognitions';
  const { pinned: pinnedItem, rest: listItems } = useMemo(
    () => partitionFocused(items, focusReviewId),
    [items, focusReviewId],
  );

  // Placement follows the same classification the alerts use. A 4-star review
  // whose text is a complaint belongs in "Por atender", not "Reconocimientos" —
  // otherwise the inbox contradicts the push the GM just received.
  const classified = useMemo(
    () => new Map(items.map((item) => [
      item.id,
      classifyReview({ rating: item.rating, feedback: item.feedback }),
    ])),
    [items],
  );

  const isRecognition = (item: FeedbackItem) => !classified.get(item.id)?.actionable;

  const sectionCounts = useMemo(() => {
    let complaints = 0;
    let recognitions = 0;
    for (const item of listItems) {
      if (isRecognition(item)) recognitions++;
      else complaints++;
    }
    return { complaints, recognitions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, classified]);

  const sectionItems = useMemo(
    () => listItems.filter((item) => isRecognition(item) === positiveSection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listItems, positiveSection, classified],
  );

  const filtered = useMemo(() => {
    const result = sectionItems.filter((item) => {
      if (statusFilter === 'read' && item.status === 'new') return false;
      if (statusFilter !== 'all' && statusFilter !== 'read' && item.status !== statusFilter) {
        return false;
      }
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
  }, [sectionItems, statusFilter, ratingFilter, search, sortBy]);

  async function updateStatus(
    id: number,
    newStatus: 'reviewed' | 'resolved',
    resolution?: Resolution,
  ) {
    try {
      const reviewedVia = reviewedViaFor({ id, focusReviewId, focusSource });
      const res = await fetch('/api/auth/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusPatchBody({
          reviewId: id,
          status: newStatus,
          reviewedVia,
          ...(resolution ? { resolution } : {}),
        })),
      });

      if (res.ok) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: newStatus, resolution: resolution ?? item.resolution }
              : item,
          ),
        );
        setResolvingReviewId(null);
      }
    } catch {
      // Network error — status stays unchanged in UI
    }
  }

  function handleExport() {
    track('csv_export', { feature: 'inbox' });
    // Spanish headers to match the rest of the product, and each header names the
    // value it holds: Calificación is the star rating the guest submitted.
    const rows = filtered.map((f) => ({
      Fecha: f.createdAt.slice(0, 10),
      Cliente: f.customerName ?? '',
      Email: f.customerEmail ?? '',
      Calificación: f.rating,
      Personal: f.staffName ?? '',
      Estado: statusLabel(f.status, isRecognition(f)),
      Clasificación: SEVERITY_LABEL[
        classified.get(f.id)?.severity ?? 'praise'
      ],
      Comentario: f.feedback ?? '',
    }));
    downloadCSV(rows, 'feedback-export.csv');
  }

  const counts = useMemo(() => {
    const c = { all: sectionItems.length, new: 0, reviewed: 0, resolved: 0 };
    for (const item of sectionItems) c[item.status]++;
    return c;
  }, [sectionItems]);

  const renderFeedbackItem = (fb: FeedbackItem, pinned = false) => {
    const positive = isRecognition(fb);
    const showAcknowledgement = pinned && !positive && fb.status === 'new';
    const severityColor = positive ? 'var(--green)' : statusBorderColors[fb.status] ?? 'var(--border-dark)';

    return (
      <div
        key={fb.id}
        style={{
          padding: '1rem',
          borderRadius: 0,
          background: 'var(--bg-base)',
          border: '1px solid var(--panel-border)',
          borderLeftWidth: 3,
          borderLeftColor: severityColor,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>
              {fb.customerName || t.inbox.anonymous}
            </span>
            <span style={statusBadge(fb.status, positive)}>
              {statusLabel(fb.status, positive)}
            </span>
            {fb.status === 'resolved' && fb.resolution && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {RESOLUTION_LABEL[fb.resolution]}
              </span>
            )}
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

        {showAcknowledgement ? (
          <button
            type="button"
            onClick={() => updateStatus(fb.id, 'reviewed')}
            style={{
              ...actionButton('var(--blue)', 'rgba(37,99,235,0.08)', 'var(--blue)'),
              width: '100%',
              minHeight: '2.75rem',
              fontSize: '0.75rem',
            }}
          >
            {t.inbox.acknowledge}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {positive && fb.status === 'new' && (
              <button
                type="button"
                onClick={() => updateStatus(fb.id, 'reviewed')}
                style={actionButton('var(--green)', 'var(--green-light)', 'var(--green)')}
              >
                {t.inbox.markAsRead}
              </button>
            )}
            {!positive && fb.status === 'new' && (
              <button
                type="button"
                onClick={() => updateStatus(fb.id, 'reviewed')}
                style={actionButton('var(--blue)', 'rgba(37,99,235,0.08)', 'var(--blue)')}
              >
                {t.inbox.markReviewed}
              </button>
            )}
            {!positive && fb.status !== 'resolved' && (
              <button
                type="button"
                onClick={() => setResolvingReviewId(fb.id)}
                style={actionButton('var(--green)', 'var(--green-light)', 'var(--green)')}
              >
                {t.inbox.resolve}
              </button>
            )}
            {fb.customerEmail && (
              <a
                href={`mailto:${encodeURIComponent(fb.customerEmail)}?subject=${encodeURIComponent(t.inbox.reYourFeedback)}`}
                style={actionButton('var(--text-main)', 'transparent', 'var(--border-dark)')}
                onClick={() => track('feedback_email_reply_click', { review_id: fb.id })}
              >
                {t.inbox.replyViaEmail}
              </a>
            )}
          </div>
        )}

        {!positive && resolvingReviewId === fb.id && (
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--panel-border)' }}>
            <p style={{ margin: '0 0 0.65rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {t.inbox.whatHappened}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {RESOLUTIONS.map((resolution) => (
                <button
                  key={resolution}
                  type="button"
                  onClick={() => updateStatus(fb.id, 'resolved', resolution)}
                  style={{
                    ...actionButton('var(--text-main)', 'var(--panel-bg)', 'var(--border-dark)'),
                    width: '100%',
                    minHeight: '2.5rem',
                    textAlign: 'left',
                    textTransform: 'none',
                    letterSpacing: 0,
                    fontSize: '0.8rem',
                  }}
                >
                  {RESOLUTION_LABEL[resolution]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setResolvingReviewId(null)}
              style={{
                border: 0,
                background: 'transparent',
                color: 'var(--text-muted)',
                padding: '0.6rem 0 0',
                cursor: 'pointer',
                fontSize: '0.75rem',
                textDecoration: 'underline',
              }}
            >
              {t.inbox.cancel}
            </button>
          </div>
        )}
      </div>
    );
  };

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
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            BANDEJA DE ENTRADA
          </p>
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, fontFamily: 'var(--font-serif)', color: 'var(--text-main)' }}>
            Aún no hay comentarios de clientes
          </h2>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.5 }}>
            Aparecerán aquí cuando alguien deje feedback.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {pinnedItem && (
        <section
          className="flat-panel"
          style={{
            padding: '1rem',
            border: `1px solid ${isRecognition(pinnedItem) ? 'var(--green)' : statusBorderColors[pinnedItem.status] ?? 'var(--border-dark)'}`,
            borderLeftWidth: 3,
            borderLeftColor: isRecognition(pinnedItem) ? 'var(--green)' : statusBorderColors[pinnedItem.status] ?? 'var(--border-dark)',
          }}
        >
          <p style={{ ...sectionLabel, marginBottom: '0.65rem' }}>{t.inbox.fromNotification}</p>
          {renderFeedbackItem(pinnedItem, true)}
        </section>
      )}

      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
        <button type="button" style={sectionTabStyle(activeSection === 'complaints', false)} onClick={() => { setActiveSection('complaints'); setStatusFilter('all'); setRatingFilter(0); }}>
          {t.inbox.porAtender} ({sectionCounts.complaints})
        </button>
        <button type="button" style={sectionTabStyle(activeSection === 'recognitions', true)} onClick={() => { setActiveSection('recognitions'); setStatusFilter('all'); setRatingFilter(0); }}>
          {t.inbox.reconocimientos} ({sectionCounts.recognitions})
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {positiveSection
            ? ([
                { status: 'all', label: t.inbox.all, count: counts.all },
                { status: 'new', label: t.inbox.unread, count: counts.new },
                { status: 'read', label: t.inbox.read, count: counts.reviewed + counts.resolved },
              ] as const).map(({ status, label, count }) => (
                <button key={status} type="button" style={tabStyle(statusFilter === status)} onClick={() => setStatusFilter(status)}>
                  {label} ({count})
                </button>
              ))
            : (['all', 'new', 'reviewed', 'resolved'] as const).map((status) => (
                <button key={status} type="button" style={tabStyle(statusFilter === status)} onClick={() => setStatusFilter(status)}>
                  {status === 'all' ? t.inbox.all : status === 'new' ? t.inbox.new : status === 'reviewed' ? t.inbox.reviewed : t.inbox.resolved} ({counts[status]})
                </button>
              ))}
        </div>

        <select value={ratingFilter} onChange={(e) => setRatingFilter(Number(e.target.value))} style={{ ...inputStyle, padding: '0.4rem 0.6rem' }}>
          <option value={0}>{t.inbox.allRatings}</option>
          {(positiveSection ? [5, 4] : [3, 2, 1]).map((r) => <option key={r} value={r}>{r} ★</option>)}
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'highest' | 'lowest')} style={{ ...inputStyle, padding: '0.4rem 0.6rem' }}>
          <option value="newest">{t.inbox.sortNewest}</option>
          <option value="oldest">{t.inbox.sortOldest}</option>
          <option value="highest">{t.inbox.sortHighest}</option>
          <option value="lowest">{t.inbox.sortLowest}</option>
        </select>

        <input type="text" placeholder={t.inbox.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />

        <button type="button" onClick={handleExport} style={actionButton('var(--text-main)', 'var(--panel-bg)', 'var(--border-dark)')}>
          {t.inbox.exportCsv}
        </button>
      </div>

      <section className="flat-panel" style={{ padding: '1.5rem', ...(positiveSection ? { borderTop: '3px solid var(--green)' } : {}) }}>
        <h2 style={sectionLabel}>
          {positiveSection ? t.inbox.reconocimientos : t.inbox.porAtender} ({filtered.length})
        </h2>

        {filtered.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 }}>
            {t.inbox.noFeedbackMatches}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtered.map((fb) => renderFeedbackItem(fb))}
          </div>
        )}
      </section>
    </div>
  );
}
