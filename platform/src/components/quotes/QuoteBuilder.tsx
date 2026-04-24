'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CATEGORY_LABELS,
  MENU_OPTIONS,
  PACKAGE_TEMPLATES,
  DEFAULT_TERMS,
  EVENT_TYPES,
  emptyItemsMap,
  itemsMapFromTemplate,
  type MenuCategory,
  type QuoteItemsMap,
} from '@/lib/quote-defaults';

const FOOD_CATEGORIES: MenuCategory[] = ['entrada', 'ensalada', 'corte', 'guarnicion', 'postre'];
const DRINK_CATEGORIES: MenuCategory[] = ['bebida', 'vino'];

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function calcTotals(pp: string, sc: string, iva: string, guests: number) {
  const pricePerPerson = parseFloat(pp) || 0;
  const scPct = parseFloat(sc) || 0;
  const ivaPct = parseFloat(iva) || 0;
  const subtotal = pricePerPerson * guests;
  const serviceCharge = subtotal * (scPct / 100);
  const subtotalWithSC = subtotal + serviceCharge;
  const ivaAmt = subtotalWithSC * (ivaPct / 100);
  const total = subtotalWithSC + ivaAmt;
  return { subtotal, serviceCharge, subtotalWithSC, ivaAmt, total };
}

type FormState = {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientCompany: string;
  eventDate: string;
  eventType: string;
  guestCount: string;
  eventNotes: string;
  packageName: string;
  pricePerPerson: string;
  serviceChargePercent: string;
  ivaPercent: string;
  terms: string;
  items: QuoteItemsMap;
};

const BLANK: FormState = {
  clientName: '',
  clientPhone: '',
  clientEmail: '',
  clientCompany: '',
  eventDate: '',
  eventType: '',
  guestCount: '50',
  eventNotes: '',
  packageName: '',
  pricePerPerson: '',
  serviceChargePercent: '10',
  ivaPercent: '16',
  terms: DEFAULT_TERMS,
  items: emptyItemsMap(),
};

export default function QuoteBuilder({
  initialData,
  quoteId,
}: {
  initialData?: Partial<FormState> & { items?: QuoteItemsMap };
  quoteId?: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ ...BLANK, ...initialData });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [customInputs, setCustomInputs] = useState<Partial<Record<MenuCategory, string>>>({});

  const set = useCallback((field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }, []);

  function applyPackage(pkgName: string) {
    const tpl = PACKAGE_TEMPLATES.find((p) => p.name === pkgName);
    if (!tpl) {
      setForm((f) => ({ ...f, packageName: 'Personalizado', items: emptyItemsMap(), pricePerPerson: '' }));
      return;
    }
    setForm((f) => ({
      ...f,
      packageName: tpl.name,
      pricePerPerson: tpl.pricePerPerson,
      items: itemsMapFromTemplate(tpl),
    }));
    setSaved(false);
  }

  function toggleItem(cat: MenuCategory, name: string) {
    setForm((f) => {
      const current = f.items[cat];
      const next = current.includes(name)
        ? current.filter((n) => n !== name)
        : [...current, name];
      return { ...f, items: { ...f.items, [cat]: next } };
    });
    setSaved(false);
  }

  function addCustomItem(cat: MenuCategory) {
    const val = (customInputs[cat] ?? '').trim();
    if (!val) return;
    setForm((f) => ({
      ...f,
      items: { ...f.items, [cat]: [...f.items[cat], val] },
    }));
    setCustomInputs((prev) => ({ ...prev, [cat]: '' }));
    setSaved(false);
  }

  function removeItem(cat: MenuCategory, name: string) {
    setForm((f) => ({
      ...f,
      items: { ...f.items, [cat]: f.items[cat].filter((n) => n !== name) },
    }));
    setSaved(false);
  }

  async function save() {
    if (!form.clientName.trim()) {
      setError('El nombre del cliente es obligatorio.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        guestCount: parseInt(form.guestCount, 10) || 1,
      };

      if (quoteId) {
        await fetch(`/api/quotes/${quoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setSaved(true);
      } else {
        const res = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Error al guardar');
        const data = await res.json();
        router.replace(`/quotes/${data.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const guests = parseInt(form.guestCount, 10) || 0;
  const totals = calcTotals(form.pricePerPerson, form.serviceChargePercent, form.ivaPercent, guests);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.82rem',
    background: 'var(--bg)',
    border: '1px solid var(--border-dark)',
    color: 'var(--text-main)',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-dim)',
    marginBottom: '0.3rem',
  };

  const sectionStyle: React.CSSProperties = {
    background: 'var(--panel-bg)',
    border: '1px solid var(--border-dark)',
    padding: '1.25rem',
    marginBottom: '1rem',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    margin: '0 0 1rem',
    paddingBottom: '0.5rem',
    borderBottom: '1px solid var(--border-dark)',
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {quoteId ? 'Editar Cotización' : 'Nueva Cotización'}
          </h1>
          {quoteId && (
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              Q-{String(quoteId).padStart(4, '0')}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/quotes')}
            style={{ padding: '0.45rem 1rem', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-dark)', cursor: 'pointer' }}
          >
            ← Volver
          </button>
          {quoteId && (
            <button
              onClick={() => window.open(`/quotes/${quoteId}/print`, '_blank')}
              style={{ padding: '0.45rem 1rem', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-dark)', cursor: 'pointer' }}
            >
              Vista previa / PDF
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '0.45rem 1.25rem',
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: saved ? 'var(--green, #43a047)' : 'var(--text-main)',
              color: 'var(--panel-bg)',
              border: 'none',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
              transition: 'background 0.2s',
            }}
          >
            {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#ffeaea', border: '1px solid var(--red)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {/* Section 1: Client */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Información del Cliente</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Nombre *</label>
            <input style={inputStyle} value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Ej. María López" />
          </div>
          <div>
            <label style={labelStyle}>Teléfono</label>
            <input style={inputStyle} value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="+52 81 1234 5678" />
          </div>
          <div>
            <label style={labelStyle}>Correo</label>
            <input style={inputStyle} type="email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} placeholder="correo@empresa.com" />
          </div>
          <div>
            <label style={labelStyle}>Empresa</label>
            <input style={inputStyle} value={form.clientCompany} onChange={(e) => set('clientCompany', e.target.value)} placeholder="Empresa S.A." />
          </div>
        </div>
      </div>

      {/* Section 2: Event */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Información del Evento</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Fecha del Evento</label>
            <input style={inputStyle} type="date" value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Tipo de Evento</label>
            <select style={inputStyle} value={form.eventType} onChange={(e) => set('eventType', e.target.value)}>
              <option value="">Seleccionar...</option>
              {EVENT_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Número de Personas</label>
            <input style={inputStyle} type="number" min="1" value={form.guestCount} onChange={(e) => set('guestCount', e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label style={labelStyle}>Notas del Evento</label>
          <textarea
            style={{ ...inputStyle, height: 70, resize: 'vertical' }}
            value={form.eventNotes}
            onChange={(e) => set('eventNotes', e.target.value)}
            placeholder="Requerimientos especiales, horarios, etc."
          />
        </div>
      </div>

      {/* Section 3: Package */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Paquete Base</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          {PACKAGE_TEMPLATES.map((pkg) => {
            const active = form.packageName === pkg.name;
            return (
              <button
                key={pkg.name}
                onClick={() => applyPackage(pkg.name)}
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  background: active ? 'var(--text-main)' : 'var(--bg)',
                  color: active ? 'var(--panel-bg)' : 'var(--text-main)',
                  border: active ? '2px solid var(--text-main)' : '1px solid var(--border-dark)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {pkg.name}
                </p>
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem', fontWeight: 600, color: active ? 'var(--panel-bg)' : 'var(--gold, #b8963e)' }}>
                  {formatMXN(parseFloat(pkg.pricePerPerson))} / persona
                </p>
              </button>
            );
          })}
          <button
            onClick={() => applyPackage('Personalizado')}
            style={{
              padding: '1rem',
              textAlign: 'left',
              background: form.packageName === 'Personalizado' || (!form.packageName && PACKAGE_TEMPLATES.every(p => p.name !== form.packageName)) ? 'var(--text-main)' : 'var(--bg)',
              color: form.packageName === 'Personalizado' || (!form.packageName && PACKAGE_TEMPLATES.every(p => p.name !== form.packageName)) ? 'var(--panel-bg)' : 'var(--text-main)',
              border: '1px dashed var(--border-dark)',
              cursor: 'pointer',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Personalizado
            </p>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'inherit', opacity: 0.7 }}>
              Desde cero
            </p>
          </button>
        </div>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
          Seleccionar un paquete pre-carga los ítems. Puedes modificarlos a continuación.
        </p>
      </div>

      {/* Section 4: Food items */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Personalizar Menú</h2>
        {FOOD_CATEGORIES.map((cat) => (
          <CategoryEditor
            key={cat}
            cat={cat}
            items={form.items[cat]}
            customValue={customInputs[cat] ?? ''}
            onCustomChange={(v) => setCustomInputs((p) => ({ ...p, [cat]: v }))}
            onToggle={(name) => toggleItem(cat, name)}
            onAddCustom={() => addCustomItem(cat)}
            onRemove={(name) => removeItem(cat, name)}
          />
        ))}
      </div>

      {/* Section 5: Drinks */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Bebidas y Vinos</h2>
        {DRINK_CATEGORIES.map((cat) => (
          <CategoryEditor
            key={cat}
            cat={cat}
            items={form.items[cat]}
            customValue={customInputs[cat] ?? ''}
            onCustomChange={(v) => setCustomInputs((p) => ({ ...p, [cat]: v }))}
            onToggle={(name) => toggleItem(cat, name)}
            onAddCustom={() => addCustomItem(cat)}
            onRemove={(name) => removeItem(cat, name)}
          />
        ))}
      </div>

      {/* Section 6: Extras */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Extras</h2>
        <CategoryEditor
          cat="extra"
          items={form.items.extra}
          customValue={customInputs.extra ?? ''}
          onCustomChange={(v) => setCustomInputs((p) => ({ ...p, extra: v }))}
          onToggle={(name) => toggleItem('extra', name)}
          onAddCustom={() => addCustomItem('extra')}
          onRemove={(name) => removeItem('extra', name)}
        />
      </div>

      {/* Section 7: Pricing */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Precios</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Precio por Persona (MXN)</label>
            <input style={inputStyle} type="number" min="0" step="50" value={form.pricePerPerson} onChange={(e) => set('pricePerPerson', e.target.value)} placeholder="650" />
          </div>
          <div>
            <label style={labelStyle}>Cargo por Servicio (%)</label>
            <input style={inputStyle} type="number" min="0" max="100" step="1" value={form.serviceChargePercent} onChange={(e) => set('serviceChargePercent', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>IVA (%)</label>
            <input style={inputStyle} type="number" min="0" max="100" step="1" value={form.ivaPercent} onChange={(e) => set('ivaPercent', e.target.value)} />
          </div>
        </div>

        {guests > 0 && parseFloat(form.pricePerPerson) > 0 && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg)', border: '1px solid var(--border-dark)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.35rem 1rem' }}>
              <PriceLine label={`${guests} personas × ${formatMXN(parseFloat(form.pricePerPerson))}`} value={formatMXN(totals.subtotal)} />
              <PriceLine label={`Cargo por servicio (${form.serviceChargePercent}%)`} value={formatMXN(totals.serviceCharge)} />
              <PriceLine label={`IVA (${form.ivaPercent}%)`} value={formatMXN(totals.ivaAmt)} bold={false} />
              <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border-dark)', margin: '0.25rem 0' }} />
              <PriceLine label="Total" value={formatMXN(totals.total)} bold={true} large={true} />
            </div>
          </div>
        )}
      </div>

      {/* Section 8: Terms */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Términos y Condiciones</h2>
        <textarea
          style={{ ...inputStyle, height: 120, resize: 'vertical', lineHeight: 1.6 }}
          value={form.terms}
          onChange={(e) => set('terms', e.target.value)}
        />
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
        {quoteId && (
          <button
            onClick={() => window.open(`/quotes/${quoteId}/print`, '_blank')}
            style={{ padding: '0.55rem 1.25rem', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-dark)', cursor: 'pointer' }}
          >
            Vista previa / PDF
          </button>
        )}
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '0.55rem 1.75rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: saved ? 'var(--green, #43a047)' : 'var(--text-main)',
            color: 'var(--panel-bg)',
            border: 'none',
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar Cotización'}
        </button>
      </div>
    </div>
  );
}

function PriceLine({ label, value, bold = false, large = false }: { label: string; value: string; bold?: boolean; large?: boolean }) {
  return (
    <>
      <span style={{ fontSize: large ? '0.85rem' : '0.75rem', fontWeight: bold ? 700 : 400, color: bold ? 'var(--text-main)' : 'var(--text-dim)' }}>
        {label}
      </span>
      <span style={{ fontSize: large ? '0.9rem' : '0.8rem', fontWeight: bold ? 700 : 400, textAlign: 'right', color: large ? 'var(--text-main)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </span>
    </>
  );
}

function CategoryEditor({
  cat,
  items,
  customValue,
  onCustomChange,
  onToggle,
  onAddCustom,
  onRemove,
}: {
  cat: MenuCategory;
  items: string[];
  customValue: string;
  onCustomChange: (v: string) => void;
  onToggle: (name: string) => void;
  onAddCustom: () => void;
  onRemove: (name: string) => void;
}) {
  const defaults = MENU_OPTIONS[cat];
  const customItems = items.filter((i) => !defaults.includes(i));

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
        {CATEGORY_LABELS[cat]}
      </p>

      {/* Default options as chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {defaults.map((name) => {
          const selected = items.includes(name);
          return (
            <button
              key={name}
              onClick={() => onToggle(name)}
              style={{
                padding: '0.3rem 0.7rem',
                fontSize: '0.72rem',
                fontWeight: selected ? 700 : 400,
                background: selected ? 'var(--text-main)' : 'transparent',
                color: selected ? 'var(--panel-bg)' : 'var(--text-main)',
                border: selected ? '1px solid var(--text-main)' : '1px solid var(--border-dark)',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Custom items added by user */}
      {customItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
          {customItems.map((name) => (
            <span
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.3rem 0.6rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                background: 'var(--gold, #b8963e)',
                color: '#fff',
                border: '1px solid transparent',
              }}
            >
              {name}
              <button
                onClick={() => onRemove(name)}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '0.75rem', lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add custom input */}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddCustom()}
          placeholder="Agregar personalizado..."
          style={{
            flex: 1,
            padding: '0.35rem 0.6rem',
            fontSize: '0.75rem',
            background: 'var(--bg)',
            border: '1px solid var(--border-dark)',
            color: 'var(--text-main)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={onAddCustom}
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.7rem',
            fontWeight: 600,
            background: 'transparent',
            color: 'var(--text-main)',
            border: '1px solid var(--border-dark)',
            cursor: 'pointer',
          }}
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}
