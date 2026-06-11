'use client';

import { useState, useMemo } from 'react';
import { t } from '@/lib/i18n';
import MeseroQrModal from './MeseroQrModal';

interface StaffMember {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

interface Props {
  initialStaff: StaffMember[];
  slug: string;
}

const card: React.CSSProperties = {
  background: 'var(--panel-bg)',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  padding: '1.5rem',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1.1rem',
  fontWeight: 600,
  color: 'var(--text-main)',
  margin: 0,
  marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  fontSize: '0.9rem',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
  fontFamily: 'var(--font-sans)',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  border: 'none',
  background: 'var(--text-main)',
  color: 'var(--panel-bg)',
  fontWeight: 700,
  fontSize: '0.7rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  border: '1px solid var(--border-dark)',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 0,
};

export default function StaffManager({ initialStaff, slug }: Props) {
  const [staffList, setStaffList] = useState<StaffMember[]>(initialStaff);
  const [qrFor, setQrFor] = useState<StaffMember | null>(null);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStaff = useMemo(() => {
    if (!searchQuery) return staffList;
    const q = searchQuery.toLowerCase();
    return staffList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [staffList, searchQuery]);

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
            borderRadius: 0,
            fontSize: '0.85rem',
            fontWeight: 500,
            border: '1px solid var(--green)',
            background: 'var(--green-light)',
            color: 'var(--green)',
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
            <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
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
            <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t.staffManager.staff(staffList.length)}</h2>
          <input
            type="text"
            placeholder={t.staffManager.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              ...inputStyle,
              width: 'auto',
              minWidth: 200,
              flex: '0 1 280px',
              padding: '0.4rem 0.75rem',
              fontSize: '0.8rem',
            }}
          />
        </div>
        {filteredStaff.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', fontStyle: 'italic', margin: 0 }}>
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
                {filteredStaff.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--panel-border)' }}>
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
                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                          {s.name}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                          {s.code}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <button
                            onClick={() => handleToggle(s)}
                            style={{
                              padding: '0.2rem 0.7rem',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase' as const,
                              cursor: 'pointer',
                              borderRadius: 0,
                              background: s.active ? 'var(--green-light)' : 'transparent',
                              color: s.active ? 'var(--green)' : 'var(--text-dim)',
                              border: s.active ? '1px solid var(--green)' : '1px solid var(--text-dim)',
                            }}
                          >
                            {s.active ? t.staffManager.active : t.staffManager.inactive}
                          </button>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button style={btnSecondary} onClick={() => setQrFor(s)}>
                              Tablero
                            </button>
                            <button style={btnSecondary} onClick={() => startEdit(s)}>
                              {t.staffManager.edit}
                            </button>
                            <button
                              style={{ ...btnSecondary, color: 'var(--red)', borderColor: 'var(--red)' }}
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

      {qrFor && (
        <MeseroQrModal slug={slug} member={qrFor} onClose={() => setQrFor(null)} />
      )}
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.6rem 0.75rem',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border-dark)',
        ...style,
      }}
    >
      {children}
    </th>
  );
}
