'use client';

import { useState } from 'react';

/**
 * Manual event-lead entry. GM adds a walk-in / phone inquiry the bot didn't
 * capture. Only phone is required; everything else mirrors the bot's fields.
 */
export default function NewLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tipoEvento, setTipoEvento] = useState('');
  const [pax, setPax] = useState('');
  const [fechaTentativa, setFechaTentativa] = useState('');
  const [presupuestoPp, setPresupuestoPp] = useState('');
  const [prioridad, setPrioridad] = useState('');
  const [notasExtra, setNotasExtra] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) {
      setError('El teléfono es obligatorio.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/leads/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          phone: phone.trim(),
          tipoEvento: tipoEvento.trim() || null,
          pax: pax.trim() ? Number(pax) : null,
          fechaTentativa: fechaTentativa.trim() || null,
          presupuestoPp: presupuestoPp.trim() || null,
          prioridad: prioridad || null,
          notasExtra: notasExtra.trim() || null,
          urgente,
        }),
      });
      if (!res.ok) {
        let msg = 'No se pudo guardar el lead.';
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON body — keep default */
        }
        setError(msg);
        return;
      }
      onCreated();
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="nl-backdrop" onClick={onClose}>
      <style>{NL_CSS}</style>
      <div className="nl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nl-head">
          <h2 className="nl-title">Nuevo lead</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="nl-close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="nl-form">
          <label className="nl-field">
            <span>Teléfono *</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="477 123 4567"
              autoFocus
              required
            />
          </label>
          <label className="nl-field">
            <span>Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
          </label>
          <div className="nl-row">
            <label className="nl-field">
              <span>Tipo de evento</span>
              <input value={tipoEvento} onChange={(e) => setTipoEvento(e.target.value)} placeholder="Boda, cumpleaños…" />
            </label>
            <label className="nl-field nl-field--sm">
              <span>Personas</span>
              <input
                type="number"
                min={1}
                value={pax}
                onChange={(e) => setPax(e.target.value)}
                placeholder="40"
              />
            </label>
          </div>
          <div className="nl-row">
            <label className="nl-field">
              <span>Fecha tentativa</span>
              <input
                value={fechaTentativa}
                onChange={(e) => setFechaTentativa(e.target.value)}
                placeholder="15 ago 2026 / por definir"
              />
            </label>
            <label className="nl-field">
              <span>Presupuesto / pax</span>
              <input value={presupuestoPp} onChange={(e) => setPresupuestoPp(e.target.value)} placeholder="$800" />
            </label>
          </div>
          <div className="nl-row">
            <label className="nl-field">
              <span>Prioridad</span>
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                <option value="">—</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
            <label className="nl-field nl-field--check">
              <span>Urgente</span>
              <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
            </label>
          </div>
          <label className="nl-field">
            <span>Notas</span>
            <textarea
              value={notasExtra}
              onChange={(e) => setNotasExtra(e.target.value)}
              rows={3}
              placeholder="Detalles del evento, requerimientos…"
            />
          </label>

          {error && <p className="nl-error">{error}</p>}

          <div className="nl-actions">
            <button type="button" onClick={onClose} className="nl-btn nl-btn--ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="nl-btn nl-btn--primary">
              {saving ? 'Guardando…' : 'Agregar lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const NL_CSS = `
.nl-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17,17,17,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
  padding: 1rem;
  animation: fadeIn 0.15s ease;
}
.nl-modal {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--text-main);
  padding: 1.5rem 1.5rem 1.75rem;
  box-sizing: border-box;
}
.nl-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--text-main);
  margin-bottom: 1.25rem;
}
.nl-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--text-main);
  letter-spacing: -0.02em;
}
.nl-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
}
.nl-close:hover { color: var(--text-main); }
.nl-form { display: flex; flex-direction: column; gap: 0.85rem; }
.nl-row { display: flex; gap: 0.85rem; }
.nl-row .nl-field { flex: 1 1 0; min-width: 0; }
.nl-field { display: flex; flex-direction: column; gap: 0.3rem; }
.nl-field > span {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.nl-field input,
.nl-field select,
.nl-field textarea {
  border: 1px solid var(--text-main);
  background: var(--panel-bg);
  padding: 0.6rem 0.7rem;
  font-size: 16px;
  font-family: inherit;
  color: var(--text-main);
  border-radius: 0;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.nl-field input:focus,
.nl-field select:focus,
.nl-field textarea:focus { box-shadow: var(--shadow-md); }
.nl-field textarea { resize: vertical; }
.nl-field--sm { flex: 0 0 92px; }
.nl-field--check {
  flex: 0 0 auto;
  align-items: flex-start;
}
.nl-field--check input { width: 22px; height: 22px; margin-top: 2px; }
.nl-error {
  margin: 0;
  color: var(--red);
  font-size: 0.8rem;
}
.nl-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.nl-btn {
  flex: 1 1 0;
  padding: 0.8rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--text-main);
  border-radius: 0;
}
.nl-btn--ghost { background: var(--panel-bg); color: var(--text-main); }
.nl-btn--primary { background: var(--text-main); color: var(--panel-bg); }
.nl-btn--primary:disabled { background: var(--text-muted); border-color: var(--text-muted); cursor: wait; }

@media (max-width: 640px) {
  .nl-modal { max-width: 100%; padding: 1.25rem 1.1rem 1.5rem; }
  .nl-row { flex-direction: column; gap: 0.85rem; }
  .nl-field--sm { flex: 1 1 0; }
}
`;
