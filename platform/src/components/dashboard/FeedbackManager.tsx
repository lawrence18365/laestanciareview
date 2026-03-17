'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

type Status = 'new' | 'reviewed' | 'resolved';

interface FeedbackItem {
  id: number;
  rating: number;
  customerName: string | null;
  customerEmail: string | null;
  staffName: string | null;
  staffCode: string | null;
  feedback: string | null;
  status: Status;
  createdAt: string;
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

const statusColors: Record<Status, { bg: string; color: string; label: string }> = {
  new: { bg: '#fef2f2', color: '#dc2626', label: 'New' },
  reviewed: { bg: '#fefce8', color: '#ca8a04', label: 'Reviewed' },
  resolved: { bg: 'var(--success-light)', color: 'var(--success)', label: 'Resolved' },
};

const tabs: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' },
];

export default function FeedbackManager({ feedback: initialFeedback }: { feedback: FeedbackItem[] }) {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [filter, setFilter] = useState('all');
  const [updating, setUpdating] = useState<number | null>(null);

  const filtered = filter === 'all' ? feedback : feedback.filter((f) => f.status === filter);

  const counts = {
    all: feedback.length,
    new: feedback.filter((f) => f.status === 'new').length,
    reviewed: feedback.filter((f) => f.status === 'reviewed').length,
    resolved: feedback.filter((f) => f.status === 'resolved').length,
  };

  async function updateStatus(reviewId: number, status: Status) {
    setUpdating(reviewId);
    try {
      const res = await fetch('/api/auth/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, status }),
      });
      if (res.ok) {
        setFeedback((prev) =>
          prev.map((f) => (f.id === reviewId ? { ...f, status } : f)),
        );
      }
    } catch {
      // Revert optimistic update on error
      setFeedback((prev) =>
        prev.map((f) => (f.id === reviewId ? { ...f, status: f.status } : f)),
      );
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header + Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ ...sectionTitle, marginBottom: 0, fontSize: '1.5rem' }}>{t.feedbackManager.feedback}</h1>
        <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--warm-white)', borderRadius: 8, padding: 3, boxShadow: 'var(--shadow-sm)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              style={{
                padding: '0.35rem 0.8rem',
                borderRadius: 6,
                border: 'none',
                fontSize: '0.8rem',
                fontWeight: 500,
                cursor: 'pointer',
                background: filter === tab.value ? 'var(--espresso)' : 'transparent',
                color: filter === tab.value ? 'var(--warm-white)' : 'var(--stone-500)',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 4,
                  fontSize: '0.7rem',
                  opacity: 0.7,
                }}
              >
                {counts[tab.value as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Feedback List */}
      {filtered.length === 0 ? (
        <div style={card}>
          <p style={{ color: 'var(--stone-400)', fontStyle: 'italic', margin: 0 }}>
            {t.feedbackManager.noFeedbackInCategory}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((item) => {
            const sc = statusColors[item.status];
            return (
              <div key={item.id} style={card}>
                {/* Top row: customer + rating + date */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                        {item.customerName || t.inbox.anonymous}
                      </span>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.1rem 0.5rem',
                          borderRadius: 999,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          background: sc.bg,
                          color: sc.color,
                        }}
                      >
                        {sc.label}
                      </span>
                    </div>
                    {item.customerEmail && (
                      <a
                        href={`mailto:${item.customerEmail}`}
                        style={{ fontSize: '0.8rem', color: 'var(--amber-600)', textDecoration: 'none' }}
                      >
                        {item.customerEmail}
                      </a>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.9rem' }}>
                      <span style={{ color: item.rating >= 4 ? 'var(--success)' : item.rating >= 3 ? 'var(--amber-500)' : '#dc2626' }}>
                        {'★'.repeat(item.rating)}
                      </span>
                      <span style={{ color: 'var(--stone-300)' }}>
                        {'★'.repeat(5 - item.rating)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--stone-400)', marginTop: 2 }}>
                      {item.createdAt.slice(0, 10)}
                    </div>
                  </div>
                </div>

                {/* Feedback text */}
                <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--stone-700)' }}>
                  {item.feedback}
                </p>

                {/* Footer: staff + actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '0.75rem',
                    paddingTop: '0.6rem',
                    borderTop: '1px solid var(--stone-200)',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: 'var(--stone-400)' }}>
                    {item.staffName ? `${t.feedbackManager.staff}: ${item.staffName}` : ''}
                    {item.staffCode ? ` (${item.staffCode})` : ''}
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {item.status !== 'reviewed' && (
                      <StatusBtn
                        label="Mark Reviewed"
                        loading={updating === item.id}
                        onClick={() => updateStatus(item.id, 'reviewed')}
                        bg="var(--amber-500)"
                      />
                    )}
                    {item.status !== 'resolved' && (
                      <StatusBtn
                        label="Resolve"
                        loading={updating === item.id}
                        onClick={() => updateStatus(item.id, 'resolved')}
                        bg="var(--success)"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBtn({
  label,
  loading,
  onClick,
  bg,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  bg: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: '0.3rem 0.7rem',
        borderRadius: 6,
        border: 'none',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
        background: bg,
        color: 'white',
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {label}
    </button>
  );
}
