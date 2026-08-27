'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Action = 'contacted' | 'replied' | 'demo' | 'won' | 'lost';

const ACTIONS: { action: Action; label: string; color: string; bg: string }[] = [
  { action: 'contacted', label: 'Contactado', color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
  { action: 'replied', label: 'Respondió', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  { action: 'demo', label: 'Demo', color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
  { action: 'won', label: 'Ganado', color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
  { action: 'lost', label: 'Perdido', color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
];

// Maps a prospect_queue status to the board action that produced it.
const STATUS_TO_ACTION: Record<string, Action> = {
  sent: 'contacted',
  replied: 'replied',
  booked: 'demo',
  won: 'won',
  lost: 'lost',
};

export function ProspectActions({
  placeId,
  currentStatus,
}: {
  placeId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState(false);
  const currentAction = STATUS_TO_ACTION[currentStatus];

  async function advance(action: Action) {
    setPending(action);
    setError(false);
    try {
      const res = await fetch('/api/prospects/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, action }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div
        role="group"
        aria-label="Actualizar estado del prospecto"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}
      >
        {ACTIONS.map(({ action, label, color, bg }) => {
          const isCurrent = currentAction === action;
          return (
            <button
              key={action}
              type="button"
              disabled={pending !== null || isCurrent}
              onClick={() => advance(action)}
              aria-pressed={isCurrent}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid ${isCurrent ? color : 'rgba(255,255,255,0.1)'}`,
                background: isCurrent ? bg : 'rgba(255,255,255,0.04)',
                color: isCurrent ? color : '#94A3B8',
                fontSize: '12px',
                fontWeight: 700,
                cursor: pending !== null || isCurrent ? 'default' : 'pointer',
                opacity: pending !== null && pending !== action ? 0.5 : 1,
              }}
            >
              {pending === action ? '…' : label}
            </button>
          );
        })}
      </div>
      {error && (
        <div style={{ color: '#F87171', fontSize: '12px', marginTop: '6px' }}>
          Error al actualizar — intenta de nuevo.
        </div>
      )}
    </div>
  );
}
