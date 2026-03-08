'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

interface StaffMember {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

interface Props {
  initialStaff: StaffMember[];
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

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--stone-300)',
  fontSize: '0.9rem',
  background: 'var(--warm-white)',
  color: 'var(--espresso)',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.2rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--espresso)',
  color: 'var(--warm-white)',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.35rem 0.8rem',
  borderRadius: 6,
  border: '1px solid var(--stone-300)',
  background: 'transparent',
  color: 'var(--stone-700)',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

export default function StaffManager({ initialStaff }: Props) {
  const [staffList, setStaffList] = useState<StaffMember[]>(initialStaff);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newCode.trim()) return;
    setLoading(true);
    setMessage('');

    const res = await fetch('/api/auth/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, code: newCode }),
    });

    if (res.ok) {
      const data = await res.json();
      setStaffList((prev) => [...prev, data.staff].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewCode('');
      setMessage(t.staffManager.staffAdded);
    } else {
      const data = await res.json();
      setMessage(data.error || t.staffManager.failedToAdd);
    }
    setLoading(false);
  }

  async function handleUpdate(id: number) {
    setLoading(true);
    setMessage('');

    const res = await fetch('/api/auth/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: editName, code: editCode }),
    });

    if (res.ok) {
      const data = await res.json();
      setStaffList((prev) =>
        prev.map((s) => (s.id === id ? data.staff : s)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingId(null);
      setMessage(t.staffManager.staffUpdated);
    } else {
      setMessage(t.staffManager.failedToUpdate);
    }
    setLoading(false);
  }

  async function handleToggle(s: StaffMember) {
    const res = await fetch('/api/auth/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, active: !s.active }),
    });

    if (res.ok) {
      const data = await res.json();
      setStaffList((prev) => prev.map((x) => (x.id === s.id ? data.staff : x)));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t.staffManager.confirmDelete)) return;

    const res = await fetch('/api/auth/staff', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      setStaffList((prev) => prev.filter((s) => s.id !== id));
      setMessage(t.staffManager.staffDeleted);
    }
  }

  function startEdit(s: StaffMember) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditCode(s.code);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {message && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 500,
            background: 'var(--success-light)',
            color: 'var(--success)',
          }}
        >
          {message}
        </div>
      )}

      {/* Add Staff */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.staffManager.addStaffMember}</h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--stone-500)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t.staffManager.name}
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.staffManager.placeholderName}
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--stone-500)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t.staffManager.code}
            </label>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder={t.staffManager.placeholderCode}
              style={inputStyle}
              required
            />
          </div>
          <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
            {t.staffManager.addStaff}
          </button>
        </form>
      </section>

      {/* Staff Table */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.staffManager.staff(staffList.length)}</h2>
        {staffList.length === 0 ? (
          <p style={{ color: 'var(--stone-400)', fontSize: '0.9rem', fontStyle: 'italic', margin: 0 }}>
            {t.staffManager.noStaffYet}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>{t.staffManager.name}</Th>
                  <Th>{t.staffManager.code}</Th>
                  <Th>{t.staffManager.status}</Th>
                  <Th style={{ textAlign: 'right' }}>{t.staffManager.actions}</Th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--stone-200)' }}>
                    {editingId === s.id ? (
                      <>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            style={{ ...inputStyle, width: '100%' }}
                          />
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <input
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                            style={{ ...inputStyle, width: '100%' }}
                          />
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }} />
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button style={btnPrimary} onClick={() => handleUpdate(s.id)} disabled={loading}>
                              {t.staffManager.save}
                            </button>
                            <button style={btnSecondary} onClick={() => setEditingId(null)}>
                              {t.staffManager.cancel}
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500, fontSize: '0.9rem' }}>
                          {s.name}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--stone-500)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {s.code}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <button
                            onClick={() => handleToggle(s)}
                            style={{
                              ...btnSecondary,
                              background: s.active ? 'var(--success-light)' : 'var(--stone-100)',
                              color: s.active ? 'var(--success)' : 'var(--stone-500)',
                              border: 'none',
                              fontWeight: 500,
                              borderRadius: 999,
                              padding: '0.2rem 0.7rem',
                              fontSize: '0.75rem',
                            }}
                          >
                            {s.active ? t.staffManager.active : t.staffManager.inactive}
                          </button>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button style={btnSecondary} onClick={() => startEdit(s)}>
                              {t.staffManager.edit}
                            </button>
                            <button
                              style={{ ...btnSecondary, color: '#dc2626', borderColor: '#fecaca' }}
                              onClick={() => handleDelete(s.id)}
                            >
                              {t.staffManager.delete}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.5rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--stone-500)',
        ...style,
      }}
    >
      {children}
    </th>
  );
}
