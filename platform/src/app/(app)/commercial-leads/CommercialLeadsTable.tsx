'use client';

import { useMemo, useState } from 'react';
import { COMMERCIAL_LEAD_STATUSES, CommercialLeadStatus } from '@/lib/commercial-statuses';

export type CommercialLeadRow = {
  id: number;
  name: string | null;
  businessName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  source: string;
  offer: string;
  status: CommercialLeadStatus;
  nextAction: string | null;
  nextActionAt: string | null;
  contactedAt: string | null;
  notes: string | null;
  lostReason: string | null;
  landingPath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
  updatedAt: string;
  lastEventName: string | null;
  lastEventAt: string | null;
};

type PatchPayload = {
  status?: CommercialLeadStatus;
  nextAction?: string | null;
  nextActionAt?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  contactedAt?: string | null;
};

const statusLabels: Record<CommercialLeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  demo_booked: 'Demo booked',
  proposal_sent: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
  bad_fit: 'Bad fit',
  duplicate: 'Duplicate',
  nurture: 'Nurture',
  no_response: 'No response',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizeLeadFromApi(lead: Partial<CommercialLeadRow>): Partial<CommercialLeadRow> {
  return {
    ...lead,
    createdAt: lead.createdAt ? new Date(lead.createdAt).toISOString() : undefined,
    updatedAt: lead.updatedAt ? new Date(lead.updatedAt).toISOString() : undefined,
    contactedAt: lead.contactedAt ? new Date(lead.contactedAt).toISOString() : null,
    nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt).toISOString() : null,
  };
}

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export default function CommercialLeadsTable({ initialLeads }: { initialLeads: CommercialLeadRow[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const lead of leads) result[lead.status] = (result[lead.status] ?? 0) + 1;
    return result;
  }, [leads]);

  const openPipeline = useMemo(() => {
    return leads.filter((lead) => !['won', 'lost', 'bad_fit', 'duplicate'].includes(lead.status)).length;
  }, [leads]);

  const dueNow = useMemo(() => {
    const now = Date.now();
    return leads.filter((lead) => {
      if (['won', 'lost', 'bad_fit', 'duplicate'].includes(lead.status)) return false;
      return lead.nextActionAt && new Date(lead.nextActionAt).getTime() <= now;
    }).length;
  }, [leads]);

  function updateLocal(id: number, patch: Partial<CommercialLeadRow>) {
    setLeads((current) => current.map((lead) => (lead.id === id ? { ...lead, ...patch } : lead)));
  }

  async function patchLead(id: number, payload: PatchPayload) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/commercial-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.ok) {
        throw new Error(result?.error || 'Could not update lead');
      }
      updateLocal(id, normalizeLeadFromApi(result.lead));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update lead');
    } finally {
      setSavingId(null);
    }
  }

  async function saveRow(lead: CommercialLeadRow) {
    await patchLead(lead.id, {
      status: lead.status,
      nextAction: lead.nextAction || null,
      nextActionAt: lead.nextActionAt || null,
      notes: lead.notes || null,
      lostReason: lead.lostReason || null,
    });
  }

  return (
    <section style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <Metric label="Open pipeline" value={openPipeline} />
        <Metric label="Due now" value={dueNow} />
        <Metric label="New" value={counts.new ?? 0} />
        <Metric label="Contacted" value={counts.contacted ?? 0} />
        <Metric label="Demo booked" value={counts.demo_booked ?? 0} />
        <Metric label="Won" value={counts.won ?? 0} />
        <Metric label="Lost" value={(counts.lost ?? 0) + (counts.bad_fit ?? 0)} />
      </div>

      {error && (
        <div style={{ padding: '0.75rem 1rem', border: '1px solid #ef4444', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'white' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1260 }}>
          <thead>
            <tr style={{ background: 'var(--bg-muted)' }}>
              {['Lead', 'Contact', 'Source / offer', 'Status', 'Last event', 'Next action', 'Contacted', 'Notes / actions'].map((label) => (
                <th key={label} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                <td style={{ padding: '0.75rem', maxWidth: 240 }}>
                  <strong>{lead.businessName}</strong>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{lead.city || 'Sin ciudad'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>#{lead.id} · {formatDate(lead.createdAt)}</div>
                </td>
                <td style={{ padding: '0.75rem', maxWidth: 220 }}>
                  <div>{lead.name || 'Sin nombre'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', overflowWrap: 'anywhere' }}>{lead.email || 'Sin email'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{lead.phone || 'Sin teléfono'}</div>
                </td>
                <td style={{ padding: '0.75rem', maxWidth: 220 }}>
                  <strong style={{ display: 'block' }}>{lead.source}</strong>
                  <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{lead.offer}</span>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem', overflowWrap: 'anywhere' }}>{lead.landingPath || '—'}</span>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {[lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(' / ') || 'No UTM'}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', width: 150 }}>
                  <select
                    value={lead.status}
                    onChange={(event) => updateLocal(lead.id, { status: event.target.value as CommercialLeadStatus })}
                    style={{ width: '100%', padding: '0.45rem', border: '1px solid var(--border)', borderRadius: 6 }}
                  >
                    {COMMERCIAL_LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                  {lead.lostReason && (
                    <div style={{ marginTop: '0.4rem', color: '#991b1b', fontSize: '0.8rem' }}>{lead.lostReason}</div>
                  )}
                </td>
                <td style={{ padding: '0.75rem', width: 170 }}>
                  <strong>{lead.lastEventName || '—'}</strong>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{formatDate(lead.lastEventAt)}</div>
                </td>
                <td style={{ padding: '0.75rem', width: 220 }}>
                  <textarea
                    value={lead.nextAction || ''}
                    onChange={(event) => updateLocal(lead.id, { nextAction: event.target.value })}
                    placeholder="Next action"
                    rows={3}
                    style={{ width: '100%', resize: 'vertical', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                  <label style={{ display: 'block', marginTop: '0.45rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>
                    Due
                    <input
                      type="datetime-local"
                      value={toDateTimeLocal(lead.nextActionAt)}
                      onChange={(event) => updateLocal(lead.id, { nextActionAt: fromDateTimeLocal(event.target.value) })}
                      style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.45rem', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                  </label>
                </td>
                <td style={{ padding: '0.75rem', width: 140 }}>
                  <div>{formatDate(lead.contactedAt)}</div>
                  <button
                    type="button"
                    onClick={() => patchLead(lead.id, { status: 'contacted' })}
                    disabled={savingId === lead.id}
                    style={smallButtonStyle}
                  >
                    Contacted now
                  </button>
                </td>
                <td style={{ padding: '0.75rem', width: 300 }}>
                  <textarea
                    value={lead.notes || ''}
                    onChange={(event) => updateLocal(lead.id, { notes: event.target.value })}
                    placeholder="Sales notes"
                    rows={3}
                    style={{ width: '100%', resize: 'vertical', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button type="button" onClick={() => saveRow(lead)} disabled={savingId === lead.id} style={primaryButtonStyle}>
                      {savingId === lead.id ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={() => patchLead(lead.id, { status: 'demo_booked' })} disabled={savingId === lead.id} style={smallButtonStyle}>
                      Demo
                    </button>
                    <button type="button" onClick={() => patchLead(lead.id, { status: 'proposal_sent' })} disabled={savingId === lead.id} style={smallButtonStyle}>
                      Proposal
                    </button>
                    <button type="button" onClick={() => patchLead(lead.id, { status: 'won' })} disabled={savingId === lead.id} style={smallButtonStyle}>
                      Won
                    </button>
                    <button type="button" onClick={() => patchLead(lead.id, { status: 'lost', lostReason: lead.lostReason || 'manual_loss' })} disabled={savingId === lead.id} style={dangerButtonStyle}>
                      Lost
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '1rem', color: 'var(--text-muted)' }}>
                  No commercial leads recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', background: 'white', minWidth: 130 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800 }}>{value}</div>
    </div>
  );
}

const smallButtonStyle = {
  padding: '0.35rem 0.55rem',
  border: '1px solid var(--border)',
  background: 'white',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.78rem',
} as const;

const primaryButtonStyle = {
  ...smallButtonStyle,
  background: 'var(--text-main)',
  color: 'white',
  borderColor: 'var(--text-main)',
} as const;

const dangerButtonStyle = {
  ...smallButtonStyle,
  color: '#991b1b',
  borderColor: '#fecaca',
  background: '#fef2f2',
} as const;
