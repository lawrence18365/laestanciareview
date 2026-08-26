'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  MENU,
  CATEGORIAS,
  PAQUETES_BEBIDAS,
  TEMPLATES,
  computePricing,
  computeTierPricing,
  dishById,
  eligibleIncludedSides,
  emptyConfig,
  extraSectionsPP,
  fmtMXN,
  isParrilla,
  newExtraSectionId,
  type ExtraSection,
  type QuoteCategoria,
  type QuoteConfig,
  type QuoteTemplate,
} from '@/lib/quote-data';

// Default included side seeded when a Parrilla cut lands in the quote via
// template apply (or as a safety net for the per-cut Carta picker) —
// Papas a la Francesa, the most commonly-paired side. Hostess can swap
// it from the row picker. Only used by Carta mode; Asado al Centro
// bundles sides at the template level (see QuoteTemplate.sharedSides).
const DEFAULT_INCLUDED_SIDE_ID = 'g1';

function seedParrillaSides(cantidades: Record<string, number>): Record<string, string> {
  const sides: Record<string, string> = {};
  for (const id of Object.keys(cantidades)) {
    if (isParrilla(id)) sides[id] = DEFAULT_INCLUDED_SIDE_ID;
  }
  return sides;
}
import QuotePreview from './QuotePreview';

type Tab = 'plantillas' | 'constructor' | 'carta' | 'preview';

type Props = {
  initialConfig?: QuoteConfig;
  quoteId?: number;
  // Set when creating a quote from an event lead — forwarded to POST /api/quotes
  // so the server links the quote and advances the lead to "quoted".
  leadId?: number;
  quoteNumber?: string;
  restaurantName?: string;
  logoSrc?: string;
  // Admin sees margen/costo/markup/ganancia for validating quotes before
  // sending. Hostess sees only Personas / Precio / Total. Defaults to false
  // — server pages must explicitly opt-in via isAdminEmail(managerEmail).
  // Becomes a real role check when the multi-user CRM ships.
  isAdmin?: boolean;
};

export default function QuoteBuilderV2({
  initialConfig,
  quoteId,
  leadId,
  quoteNumber,
  restaurantName = 'La Estancia',
  logoSrc,
  isAdmin = false,
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<QuoteConfig>(() => initialConfig ?? emptyConfig());
  const [tab, setTab] = useState<Tab>(quoteId ? 'constructor' : 'plantillas');
  const [categoriaActiva, setCategoriaActiva] = useState<QuoteCategoria>('Parrilla');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [sidePicker, setSidePicker] = useState<{
    parrillaId: string;
  } | null>(null);
  const waTextRef = useRef<string>('');

  const folio = useMemo(() => {
    if (quoteNumber) return quoteNumber;
    if (quoteId) return `Q-${String(quoteId).padStart(4, '0')}`;
    return `Q-${new Date().toISOString().slice(0, 10).replaceAll('-', '').slice(2)}`;
  }, [quoteId, quoteNumber]);

  const pricing = useMemo(() => computePricing(config), [config]);

  const modoLabel = useMemo(() => {
    switch (config.modo) {
      case 'individual': return 'Menú individual';
      case 'opciones': return 'Menú 3 opciones';
      case 'asado': return 'Asado al centro';
      case 'carta': return 'A la carta';
    }
  }, [config.modo]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const patchEvento = useCallback((patch: Partial<QuoteConfig['evento']>) => {
    setConfig((c) => ({ ...c, evento: { ...c.evento, ...patch } }));
    setSaved(false);
  }, []);

  const patchIndiv = useCallback((patch: Partial<QuoteConfig['indiv']>) => {
    setConfig((c) => ({ ...c, indiv: { ...c.indiv, ...patch } }));
    setSaved(false);
  }, []);

  const patchOpciones = useCallback((patch: Partial<QuoteConfig['opciones']>) => {
    setConfig((c) => ({ ...c, opciones: { ...c.opciones, ...patch } }));
    setSaved(false);
  }, []);

  const patchAsado = useCallback((patch: Partial<QuoteConfig['asado']>) => {
    setConfig((c) => ({ ...c, asado: { ...c.asado, ...patch } }));
    setSaved(false);
  }, []);

  const patchCarta = useCallback((patch: Partial<QuoteConfig['carta']>) => {
    setConfig((c) => ({ ...c, carta: { ...c.carta, ...patch } }));
    setSaved(false);
  }, []);

  const addExtraSection = useCallback(() => {
    setConfig((c) => ({
      ...c,
      extraSections: [
        ...(c.extraSections ?? []),
        { id: newExtraSectionId(), nombre: '', descripcion: '', precioPP: 0, costoPP: 0 },
      ],
    }));
    setSaved(false);
  }, []);

  const updateExtraSection = useCallback((id: string, patch: Partial<ExtraSection>) => {
    setConfig((c) => ({
      ...c,
      extraSections: (c.extraSections ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
    setSaved(false);
  }, []);

  const removeExtraSection = useCallback((id: string) => {
    setConfig((c) => ({
      ...c,
      extraSections: (c.extraSections ?? []).filter((s) => s.id !== id),
    }));
    setSaved(false);
  }, []);

  function menuPorCategoria(cat: QuoteCategoria) {
    return MENU.filter((d) => d.categoria === cat);
  }

  function toggleArrayItem(arr: string[], id: string): string[] {
    return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  }

  function cargarPlantilla(templateId: string) {
    if (templateId === 'carta-libre') {
      setConfig((c) => ({ ...c, modo: 'carta', templateId: 'carta-libre' }));
      setTab('constructor');
      return;
    }
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    applyTemplate(t);
    setTab('constructor');
  }

  function applyTemplate(t: QuoteTemplate) {
    setConfig((c) => {
      const next: QuoteConfig = { ...c, modo: t.modo, templateId: t.id };
      if (t.modo === 'individual') {
        next.indiv = {
          ...c.indiv,
          sopas: t.config.sopas ?? [],
          platos: t.config.platos ?? [],
          postres: t.config.postres ?? [],
          bebidas: t.config.bebidas ?? c.indiv.bebidas,
          precioPP: t.config.precioPP ?? c.indiv.precioPP,
          costoPP: t.config.costoPP ?? c.indiv.costoPP,
          incluyeIVA: t.config.incluyeIVA ?? c.indiv.incluyeIVA,
          incluyeServicio: t.config.incluyeServicio ?? c.indiv.incluyeServicio,
        };
      } else if (t.modo === 'opciones') {
        next.opciones = {
          ...c.opciones,
          sopas: t.config.sopas ?? [],
          tiers: t.config.tiers ?? c.opciones.tiers,
          postres: t.config.postres ?? [],
          bebidas: t.config.bebidas ?? c.opciones.bebidas,
          incluyeIVA: t.config.incluyeIVA ?? c.opciones.incluyeIVA,
          incluyeServicio: t.config.incluyeServicio ?? c.opciones.incluyeServicio,
        };
      } else if (t.modo === 'asado') {
        next.asado = {
          ...c.asado,
          cantidades: t.config.cantidades ?? {},
          bebidas: t.config.bebidas ?? c.asado.bebidas,
          markup: t.config.markup ?? c.asado.markup,
          incluyeIVA: t.config.incluyeIVA ?? c.asado.incluyeIVA,
          incluyeServicio: t.config.incluyeServicio ?? c.asado.incluyeServicio,
        };
      } else {
        const cantidades = t.config.cantidades ?? {};
        next.carta = {
          ...c.carta,
          cantidades,
          parrillaSides: seedParrillaSides(cantidades),
          bebidas: t.config.bebidas ?? c.carta.bebidas,
          markup: t.config.markup ?? c.carta.markup,
          incluyeIVA: t.config.incluyeIVA ?? c.carta.incluyeIVA,
          incluyeServicio: t.config.incluyeServicio ?? c.carta.incluyeServicio,
        };
      }
      return next;
    });
    setSaved(false);
  }

  function setAsadoCantidad(id: string, qty: number) {
    const safe = Math.max(0, qty);
    setConfig((c) => {
      const next = { ...c.asado.cantidades };
      const nextVariants = { ...c.asado.dishVariants };
      if (safe === 0) {
        delete next[id];
        delete nextVariants[id]; // variants travel with the dish
      } else {
        next[id] = safe;
      }
      return { ...c, asado: { ...c.asado, cantidades: next, dishVariants: nextVariants } };
    });
    setSaved(false);
  }

  // Carta is per-cut: each Parrilla cut comes with one free included side.
  // First time a cut goes from 0→1, force the side picker open so the
  // choice is intentional. Subsequent qty bumps don't re-prompt; included
  // count tracks cut qty implicitly (no separate field).
  function setCartaCantidad(id: string, qty: number) {
    const safe = Math.max(0, qty);
    const wasZero = (config.carta.cantidades[id] || 0) === 0;
    setConfig((c) => {
      const nextCantidades = { ...c.carta.cantidades };
      const nextSides = { ...c.carta.parrillaSides };
      const nextVariants = { ...c.carta.dishVariants };
      if (safe === 0) {
        delete nextCantidades[id];
        delete nextSides[id]; // included side travels with the cut
        delete nextVariants[id]; // variants travel with the dish
      } else {
        nextCantidades[id] = safe;
        if (isParrilla(id) && !nextSides[id]) {
          nextSides[id] = DEFAULT_INCLUDED_SIDE_ID;
        }
      }
      return {
        ...c,
        carta: {
          ...c.carta,
          cantidades: nextCantidades,
          parrillaSides: nextSides,
          dishVariants: nextVariants,
        },
      };
    });
    setSaved(false);
    if (wasZero && safe > 0 && isParrilla(id)) {
      setSidePicker({ parrillaId: id });
    }
  }

  function pickParrillaSide(sideId: string) {
    if (!sidePicker) return;
    const { parrillaId } = sidePicker;
    setConfig((c) => ({
      ...c,
      carta: {
        ...c.carta,
        parrillaSides: { ...c.carta.parrillaSides, [parrillaId]: sideId },
      },
    }));
    setSaved(false);
    setSidePicker(null);
  }

  function openSidePicker(parrillaId: string) {
    setSidePicker({ parrillaId });
  }

  // Toggle a variant chip on/off for a dish. Same shape across asado and
  // carta modes, so a single function with a `mode` param keeps the call
  // sites compact. Empty array after removal stays in the map (cheap) and
  // is treated as "no selection" downstream.
  function toggleDishVariant(mode: 'asado' | 'carta', dishId: string, variant: string) {
    setConfig((c) => {
      const state = mode === 'asado' ? c.asado : c.carta;
      const current = state.dishVariants[dishId] ?? [];
      const next = current.includes(variant)
        ? current.filter((v) => v !== variant)
        : [...current, variant];
      const nextVariants = { ...state.dishVariants, [dishId]: next };
      if (mode === 'asado') {
        return { ...c, asado: { ...c.asado, dishVariants: nextVariants } };
      }
      return { ...c, carta: { ...c.carta, dishVariants: nextVariants } };
    });
    setSaved(false);
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async function save() {
    if (!config.evento.cliente.trim()) {
      setError('El nombre del cliente es obligatorio.');
      setTab('plantillas');
      return;
    }
    if (!config.evento.personas || config.evento.personas < 1) {
      setError('Indica el número de personas (mínimo 1).');
      setTab('plantillas');
      return;
    }
    setError('');
    setSaving(true);
    try {
      // Config-derived pricing already includes servicio + IVA. Keep sc/iva at
      // zero so consumers of these legacy percentage fields do not apply the
      // charges a second time.
      const payload = {
        clientName: config.evento.cliente,
        clientPhone: config.evento.telefono,
        eventDate: config.evento.fecha || null,
        eventType: config.evento.tipo,
        guestCount: config.evento.personas,
        eventNotes: '',
        packageName: config.templateId ?? modoLabel,
        serviceChargePercent: '0',
        ivaPercent: '0',
        terms: config.terms ?? '',
        configJson: config,
        // Only meaningful on create; the server links it and advances the lead.
        leadId,
      };

      if (quoteId) {
        const res = await fetch(`/api/quotes/${quoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Error al guardar');
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

  // ── WhatsApp + copy ─────────────────────────────────────────────────────

  // Long-form summary, kept for the "Copiar texto" fallback button. Not sent
  // automatically anymore — Leslie's clients want the actual PDF, not a wall
  // of text. The PDF goes via the print page on click; WhatsApp gets a short
  // intro line so the hostess can attach the just-saved PDF herself.
  const whatsappText = useMemo(() => {
    const { evento } = config;
    const lines: string[] = [];
    lines.push(`Hola ${evento.cliente || ''} 👋`);
    lines.push('');
    lines.push(`Te comparto la cotización para tu ${evento.tipo.toLowerCase()}:`);
    if (evento.fecha) lines.push(`📅 Fecha: ${evento.fecha}${evento.hora ? ' · ' + evento.hora : ''}`);
    lines.push(`👥 Personas: ${evento.personas}`);
    const namedSections = (config.extraSections ?? []).filter((s) => s.nombre.trim());
    if (namedSections.length > 0) {
      lines.push('');
      lines.push('Incluye:');
      for (const s of namedSections) lines.push(`• ${s.nombre.trim()}`);
    }
    lines.push('');
    const taxNote = pricing.ivaIncluido
      ? (pricing.servicioActivo ? 'Incluye IVA 16% y 15% de servicio' : 'Incluye IVA 16%')
      : (pricing.servicioActivo ? 'Más 15% servicio + IVA 16%' : 'Más IVA 16%');
    // Opciones mode: list all tiers with their per-pp + total. Customer
    // hasn't picked yet, so a single averaged price is wrong (mismatches
    // PDF and Vista Cliente, both of which now show three prices).
    if (config.modo === 'opciones') {
      const tiers = computeTierPricing(config);
      if (tiers.length > 0) {
        lines.push('💰 *Inversión por persona*');
        for (const t of tiers) lines.push(`Opción ${t.letra} · ${fmtMXN(t.pricePP)}`);
        lines.push('');
        lines.push(`*Total estimado · ${evento.personas} personas*`);
        for (const t of tiers) lines.push(`Opción ${t.letra} · ${fmtMXN(t.total)}`);
      } else {
        lines.push('💰 *Inversión por persona*');
        lines.push('Define el precio de cada opción para verlo aquí');
      }
    } else {
      lines.push(`💰 *${fmtMXN(pricing.precioFinalPP)} por persona*`);
      lines.push(`Total: ${fmtMXN(pricing.precioTotalFinal)}`);
    }
    lines.push(taxNote);
    lines.push('');
    lines.push(`Cotización ${folio}`);
    lines.push(`La Estancia Argentina · León`);
    return lines.join('\n');
  }, [config, pricing, folio]);

  waTextRef.current = whatsappText;

  // wa.me has no file-attach hook by spec — so the "send PDF" flow is:
  // click → open print page in new tab (autoprint=1 fires Save-as-PDF) →
  // open WhatsApp Web with a short intro → hostess attaches the saved PDF.
  const whatsappPhone = useMemo(() => {
    const raw = (config.evento.telefono || '').replace(/\D/g, '');
    if (raw.length === 10) return '52' + raw;                                    // local 10-digit MX
    if (raw.length === 11 && raw.startsWith('1')) return '52' + raw.slice(1);    // old "1 + 10" habit
    return raw; // already prefixed (52…) or empty
  }, [config.evento.telefono]);

  const whatsappShortText = useMemo(() => {
    const nombre = config.evento.cliente?.trim();
    const saludo = nombre ? `Hola ${nombre} 👋` : 'Hola 👋';
    return `${saludo}\n\nTe comparto la cotización para tu ${config.evento.tipo.toLowerCase()} en La Estancia Argentina. Te adjunto el PDF aquí mismo 📎\n\nCotización ${folio}`;
  }, [config.evento.cliente, config.evento.tipo, folio]);

  const whatsappShortLink = useMemo(() => {
    const encoded = encodeURIComponent(whatsappShortText);
    return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  }, [whatsappPhone, whatsappShortText]);

  function enviarPorWhatsApp() {
    if (!quoteId) {
      alert('Guarda la cotización primero para generar el PDF.');
      return;
    }
    // Open the print page first so it inherits the user gesture (some browsers
    // block window.open on followup async work). The print page reads
    // autoprint=1 and auto-fires Save-as-PDF once fonts are ready.
    const printWin = window.open(`/quotes/${quoteId}/print?autoprint=1`, '_blank', 'noopener,noreferrer');
    // Then open WhatsApp Web/app with the short intro message. If popups got
    // blocked, fall back to navigating the current tab so the hostess still
    // ends up in WhatsApp.
    const waWin = window.open(whatsappShortLink, '_blank', 'noopener,noreferrer');
    if (!printWin && !waWin) window.location.href = whatsappShortLink;
  }

  async function copiarTextoWA() {
    try {
      await navigator.clipboard.writeText(waTextRef.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="cotizador-root">
      <style>{CSS}</style>

      {/* Breadcrumb / title row */}
      <header className="cb-header">
        <div className="cb-header-inner">
          <div className="cb-row" style={{ paddingTop: 20, paddingBottom: 20 }}>
            <p className="mini" style={{ marginBottom: 4 }}>
              {quoteId ? 'Editar cotización' : 'Nueva cotización'} · {restaurantName}
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h1 className="h-display">
                {config.evento.cliente || 'Cotización sin cliente'}
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <p className="text-2 num" style={{ fontSize: 14 }}>{folio}</p>
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ padding: '8px 16px' }}
                >
                  {saving ? 'Guardando…' : saved ? '✓ Guardado' : quoteId ? 'Guardar cambios' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
          <div className="cb-tabs">
            {(['plantillas', 'constructor', 'carta', 'preview'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`tab ${tab === t ? 'active' : ''}`}
              >
                {t === 'plantillas' ? 'Plantillas' : t === 'constructor' ? 'Constructor' : t === 'carta' ? 'Carta' : 'Vista cliente'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div style={{ maxWidth: 1120, margin: '16px auto 0', padding: '0 20px' }}>
          <div style={{ background: '#FEE2E2', border: '1px solid #DC2626', color: '#991B1B', padding: 12, borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        </div>
      )}

      {/* TAB: Plantillas */}
      {tab === 'plantillas' && (
        <main className="cb-main" style={{ maxWidth: 1120 }}>
          {/* Datos del evento */}
          <div style={{ marginBottom: 40 }}>
            <p className="mini" style={{ marginBottom: 6 }}>Paso 01 · Cliente y logística</p>
            <h2 className="h-1" style={{ marginBottom: 20 }}>¿Para quién es la cotización?</h2>
            <div className="card" style={{ padding: 24 }}>
              <div className="grid-4">
                <Field label="Cliente">
                  <input type="text" value={config.evento.cliente} onChange={(e) => patchEvento({ cliente: e.target.value })} placeholder="Nombre" />
                </Field>
                <Field label="Teléfono">
                  <input type="tel" value={config.evento.telefono} onChange={(e) => patchEvento({ telefono: e.target.value })} placeholder="33 1234 5678" />
                </Field>
                <Field label="Fecha">
                  <input type="date" value={config.evento.fecha} onChange={(e) => patchEvento({ fecha: e.target.value })} />
                </Field>
                <Field label="Hora">
                  <input type="text" value={config.evento.hora} onChange={(e) => patchEvento({ hora: e.target.value })} placeholder="14:00 hrs" />
                </Field>
                <Field label="Tipo">
                  <select value={config.evento.tipo} onChange={(e) => patchEvento({ tipo: e.target.value })}>
                    {['Boda', 'Empresarial', 'Cumpleaños', 'Reunión amigos', 'Cena privada', 'Brindis', 'Otro'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Personas">
                  {/* type=text + inputMode=numeric forces the iOS numpad without
                      the up/down spinner that traps the cursor when min is set.
                      Empty input is stored as 0 (treated as "unset") so the
                      hostess can clear and retype; pricing math already guards
                      with Math.max(1, personas) downstream. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={config.evento.personas === 0 ? '' : String(config.evento.personas)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, '');
                      patchEvento({ personas: digits === '' ? 0 : parseInt(digits, 10) });
                    }}
                    placeholder="Ej. 80"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Presupuesto/pp">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={config.evento.presupuesto === 0 ? '' : String(config.evento.presupuesto)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, '');
                      patchEvento({ presupuesto: digits === '' ? 0 : parseInt(digits, 10) });
                    }}
                    placeholder="$"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Prioridad">
                  <select value={config.evento.prioridad} onChange={(e) => patchEvento({ prioridad: e.target.value })}>
                    <option>Calidad</option>
                    <option>Servicio</option>
                    <option>Precio</option>
                  </select>
                </Field>
              </div>
            </div>
          </div>

          {/* Plantillas */}
          <div style={{ marginBottom: 24 }}>
            <p className="mini" style={{ marginBottom: 6 }}>Paso 02 · Plantilla</p>
            <h2 className="h-1" style={{ marginBottom: 12 }}>Elige un formato de cotización</h2>
            <p className="body text-2" style={{ maxWidth: 560 }}>Basadas en los menús que ya tienes armados. Después puedes ajustar todo.</p>
          </div>

          <div className="grid-2">
            {TEMPLATES.map((t, idx) => (
              <div key={t.id} className="template-card" onClick={() => cargarPlantilla(t.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                  <span className="num text-2" style={{ fontSize: 12, fontWeight: 600 }}>{String(idx + 1).padStart(2, '0')}</span>
                  <p className="mini">{t.precioLabel}</p>
                </div>
                <h3 className="h-2" style={{ marginBottom: 8 }}>{t.nombre}</h3>
                <p className="small text-2" style={{ marginBottom: 16 }}>{t.subtitulo}</p>
                <p className="small text-2" style={{ marginBottom: 20, flex: 1, lineHeight: 1.6 }}>{t.descripcion}</p>
                <div style={{ paddingTop: 16, borderTop: '1px solid var(--cb-border)' }}>
                  <p className="mini" style={{ marginBottom: 4 }}>Ideal para</p>
                  <p className="small">{t.idealPara}</p>
                </div>
                <button className="btn btn-primary" style={{ marginTop: 20, width: '100%' }}>Usar esta plantilla</button>
              </div>
            ))}

            {/* A la carta card */}
            <div className="template-card" onClick={() => cargarPlantilla('carta-libre')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <span className="num text-2" style={{ fontSize: 12, fontWeight: 600 }}>05</span>
                <p className="mini">A calcular</p>
              </div>
              <h3 className="h-2" style={{ marginBottom: 8 }}>Construir desde cero</h3>
              <p className="small text-2" style={{ marginBottom: 16 }}>A la carta</p>
              <p className="small text-2" style={{ marginBottom: 20, flex: 1, lineHeight: 1.6 }}>Arma el menú platillo por platillo desde toda la carta. Ideal cuando el cliente sabe exactamente qué quiere o tiene restricciones específicas.</p>
              <div style={{ paddingTop: 16, borderTop: '1px solid var(--cb-border)' }}>
                <p className="mini" style={{ marginBottom: 4 }}>Ideal para</p>
                <p className="small">Cenas a medida, dietas especiales, pedidos muy específicos</p>
              </div>
              <button className="btn btn-secondary" style={{ marginTop: 20, width: '100%' }}>Construir</button>
            </div>
          </div>
        </main>
      )}

      {/* TAB: Constructor */}
      {tab === 'constructor' && (
        <main className="cb-main" style={{ maxWidth: 1280 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--cb-border)' }}>
            <div>
              <p className="mini" style={{ marginBottom: 4 }}>{modoLabel}</p>
              <p className="h-3">
                {config.evento.cliente || 'Sin cliente'} · <span className="num">{config.evento.personas}</span> pax
              </p>
            </div>
            <button onClick={() => setTab('plantillas')} className="btn btn-secondary">← Cambiar plantilla</button>
          </div>

          <div className="grid-12">
            <div className="col-builder" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {config.modo === 'individual' && (
                <IndividualMode
                  config={config}
                  patchIndiv={patchIndiv}
                  menuPorCategoria={menuPorCategoria}
                  toggleArrayItem={toggleArrayItem}
                  extraSections={config.extraSections ?? []}
                  onAddSection={addExtraSection}
                  onUpdateSection={updateExtraSection}
                  onRemoveSection={removeExtraSection}
                  isAdmin={isAdmin}
                />
              )}
              {config.modo === 'opciones' && (
                <OpcionesMode
                  config={config}
                  patchOpciones={patchOpciones}
                  menuPorCategoria={menuPorCategoria}
                  toggleArrayItem={toggleArrayItem}
                  extraSections={config.extraSections ?? []}
                  onAddSection={addExtraSection}
                  onUpdateSection={updateExtraSection}
                  onRemoveSection={removeExtraSection}
                  isAdmin={isAdmin}
                />
              )}
              {config.modo === 'asado' && (
                <AsadoMode
                  config={config}
                  patchAsado={patchAsado}
                  menuPorCategoria={menuPorCategoria}
                  setAsadoCantidad={setAsadoCantidad}
                  toggleVariant={(dishId, variant) => toggleDishVariant('asado', dishId, variant)}
                  extraSections={config.extraSections ?? []}
                  onAddSection={addExtraSection}
                  onUpdateSection={updateExtraSection}
                  onRemoveSection={removeExtraSection}
                  isAdmin={isAdmin}
                />
              )}
              {config.modo === 'carta' && (
                <CartaMode
                  config={config}
                  patchCarta={patchCarta}
                  menuPorCategoria={menuPorCategoria}
                  categoriaActiva={categoriaActiva}
                  setCategoriaActiva={setCategoriaActiva}
                  setCartaCantidad={setCartaCantidad}
                  openSidePicker={openSidePicker}
                  toggleVariant={(dishId, variant) => toggleDishVariant('carta', dishId, variant)}
                  extraSections={config.extraSections ?? []}
                  onAddSection={addExtraSection}
                  onUpdateSection={updateExtraSection}
                  onRemoveSection={removeExtraSection}
                  isAdmin={isAdmin}
                />
              )}
            </div>

            {/* Summary */}
            <div className="col-summary">
              <div className="cb-summary-sticky">
                <div className="card" style={{ padding: 20 }}>
                  <p className="mini" style={{ marginBottom: 12 }}>{isAdmin ? 'Resumen interno' : 'Resumen'}</p>
                  <div>
                    <SummaryRow label="Personas" value={String(config.evento.personas)} />
                    {isAdmin && <SummaryRow label="Costo total estimado" value={fmtMXN(pricing.costoTotal)} />}
                    {isAdmin && <SummaryRow label="Subtotal venta" value={fmtMXN(pricing.subtotalVenta)} />}
                    {isAdmin && pricing.servicioActivo && <SummaryRow label="+ Servicio 15%" value={fmtMXN(pricing.servicioAmt)} />}
                    {isAdmin && !pricing.ivaIncluido && <SummaryRow label="+ IVA 16%" value={fmtMXN(pricing.ivaAmt)} />}
                  </div>
                  <div style={{ paddingTop: 16, marginTop: 12, borderTop: '1px solid var(--cb-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="mini">Precio/pp</span>
                      <span className="h-1 num">{fmtMXN(pricing.precioFinalPP)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="mini">Total</span>
                      <span className="h-1 num">{fmtMXN(pricing.precioTotalFinal)}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div style={{ marginTop: 16, padding: 16, borderRadius: 6, background: 'var(--cb-surface-2)' }}>
                      <p className="mini" style={{ marginBottom: 8 }}>Ganancia interna</p>
                      <SummaryRow label="Margen bruto" value={fmtMXN(pricing.gananciaBruta)} strong />
                      <SummaryRow label="% Margen" value={`${pricing.margenPct}%`} strong />
                    </div>
                  )}
                  <button onClick={() => setTab('preview')} className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}>
                    Ver cotización
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* TAB: Carta completa */}
      {tab === 'carta' && (
        <main className="cb-main" style={{ maxWidth: 960 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p className="mini" style={{ marginBottom: 6 }}>Referencia</p>
            <h1 className="h-display">La Carta</h1>
          </div>
          {CATEGORIAS.map((cat) => (
            <div key={cat} style={{ marginBottom: 40 }}>
              <h2 className="h-2" style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--cb-border)' }}>{cat}</h2>
              <div className="grid-2-menu">
                {menuPorCategoria(cat).map((dish) => (
                  <div key={dish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--cb-border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="small" style={{ fontWeight: 500 }}>{dish.nombre}</span>
                        {dish.peso && <span className="text-3" style={{ fontSize: 12 }}>{dish.peso}</span>}
                      </div>
                      {dish.desc && <p className="text-3" style={{ fontSize: 12, marginTop: 2 }}>{dish.desc}</p>}
                    </div>
                    <span className="small num" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>${dish.precio.toLocaleString('es-MX')}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </main>
      )}

      {/* TAB: Vista cliente */}
      {tab === 'preview' && (
        <main className="cb-main" style={{ maxWidth: 780 }}>
          <div className="no-print" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setTab('constructor')} className="btn btn-secondary">← Editar</button>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  if (quoteId) {
                    window.open(`/quotes/${quoteId}/print`, '_blank');
                  } else {
                    // Not saved yet — tell user to save first for a clean PDF.
                    alert('Guarda la cotización primero para exportar un PDF limpio.');
                  }
                }}
                className="btn btn-secondary"
              >
                Imprimir / PDF
              </button>
              <button onClick={copiarTextoWA} className="btn btn-secondary">{copied ? '✓ Copiado' : 'Copiar texto'}</button>
              <button onClick={enviarPorWhatsApp} className="btn btn-wa" type="button">
                <svg width={16} height={16} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
                </svg>
                Enviar por WhatsApp
              </button>
            </div>
          </div>

          <QuotePreview
            config={config}
            folio={folio}
            restaurantName={restaurantName}
            logoSrc={logoSrc}
          />
        </main>
      )}

      {sidePicker && (
        <SidePickerModal
          parrillaName={dishById(sidePicker.parrillaId)?.nombre ?? ''}
          currentSideId={config.carta.parrillaSides[sidePicker.parrillaId]}
          onPick={pickParrillaSide}
          onClose={() => setSidePicker(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mini" style={{ display: 'block', marginBottom: 8 }}>{label}</label>
      {children}
    </div>
  );
}

// Shared label + helper for the internal-cost field across every mode.
// Hostess feedback (Leslie): "Costo estimado/pp" wasn't readable as
// production cost. The new wording spells out what counts (insumos +
// labor) and reassures her the number doesn't leak to the client.
const COSTO_INTERNO_HELPER =
  '¿Cuánto te cuesta producir un plato? (insumos + labor). No se muestra al cliente, solo sirve para calcular tu margen.';

function CostoInternoLabel() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      Costo interno/pp
      <span
        title={COSTO_INTERNO_HELPER}
        aria-label={COSTO_INTERNO_HELPER}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '1px solid var(--cb-border-strong)',
          color: 'var(--cb-text-2)',
          fontSize: 9,
          fontWeight: 700,
          fontFamily: 'serif',
          fontStyle: 'italic',
          cursor: 'help',
          textTransform: 'none',
          letterSpacing: 0,
        }}
      >
        i
      </span>
    </span>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
      <span className="text-2">{label}</span>
      <span className="num" style={{ fontWeight: strong ? 500 : 400 }}>{value}</span>
    </div>
  );
}

function BebidasPicker({
  value, onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PAQUETES_BEBIDAS.map((pkg) => (
        <label key={pkg.id} className={`item-row ${value === pkg.id ? 'selected' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <input type="radio" checked={value === pkg.id} onChange={() => onChange(pkg.id)} style={{ marginTop: 2 }} />
            <div>
              <p className="small" style={{ fontWeight: 600, margin: 0 }}>{pkg.nombre}</p>
              <p className="small text-2" style={{ margin: '2px 0 0', lineHeight: 1.6 }}>{pkg.desc}</p>
            </div>
          </div>
          <span className="small num" style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
            {pkg.precio > 0 ? `+${fmtMXN(pkg.precio)}/pp` : '—'}
          </span>
        </label>
      ))}
    </div>
  );
}

function IvaServicioToggles({
  incluyeIVA, incluyeServicio, onToggleIVA, onToggleServicio, ivaLabel = 'Precio incluye IVA',
}: {
  incluyeIVA: boolean;
  incluyeServicio: boolean;
  onToggleIVA: (v: boolean) => void;
  onToggleServicio: (v: boolean) => void;
  ivaLabel?: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
      <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={incluyeIVA} onChange={(e) => onToggleIVA(e.target.checked)} />
        {ivaLabel}
      </label>
      <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={incluyeServicio} onChange={(e) => onToggleServicio(e.target.checked)} />
        Sumar 15% servicio
      </label>
    </div>
  );
}

function IndividualMode({
  config, patchIndiv, menuPorCategoria, toggleArrayItem,
  extraSections, onAddSection, onUpdateSection, onRemoveSection, isAdmin,
}: {
  config: QuoteConfig;
  patchIndiv: (p: Partial<QuoteConfig['indiv']>) => void;
  menuPorCategoria: (cat: QuoteCategoria) => typeof MENU;
  toggleArrayItem: (arr: string[], id: string) => string[];
  extraSections: ExtraSection[];
  onAddSection: () => void;
  onUpdateSection: (id: string, patch: Partial<ExtraSection>) => void;
  onRemoveSection: (id: string) => void;
  isAdmin: boolean;
}) {
  const { indiv } = config;
  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-2" style={{ margin: 0 }}>Menú a precio único por persona</h3>
      <p className="small text-2" style={{ margin: '4px 0 24px' }}>Define las opciones que el cliente podrá elegir el día del evento.</p>

      <Section title="1° Tiempo · Sopa o Crema" hint="A elegir 1">
        <div className="grid-2-sm">
          {menuPorCategoria('Sopas').map((dish) => (
            <label key={dish.id} className="item-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={indiv.sopas.includes(dish.id)} onChange={() => patchIndiv({ sopas: toggleArrayItem(indiv.sopas, dish.id) })} />
              <span className="small">{dish.nombre}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="2° Tiempo · Plato Fuerte" hint="A elegir 1+">
        <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }} className="scroll-thin">
          {[...menuPorCategoria('Parrilla'), ...menuPorCategoria('Del Mar'), ...menuPorCategoria('Pastas')].map((dish) => (
            <label key={dish.id} className="item-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <input type="checkbox" checked={indiv.platos.includes(dish.id)} onChange={() => patchIndiv({ platos: toggleArrayItem(indiv.platos, dish.id) })} />
                <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dish.nombre}</span>
                {dish.peso && <span className="mini" style={{ textTransform: 'none' }}>{dish.peso}</span>}
              </div>
              <span className="small text-3 num" style={{ whiteSpace: 'nowrap' }}>${dish.precio}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="3° Tiempo · Postre" hint="A elegir 1+">
        <div className="grid-2-sm">
          {menuPorCategoria('Postres').map((dish) => (
            <label key={dish.id} className="item-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={indiv.postres.includes(dish.id)} onChange={() => patchIndiv({ postres: toggleArrayItem(indiv.postres, dish.id) })} />
              <span className="small">{dish.nombre}</span>
            </label>
          ))}
        </div>
      </Section>

      <ExtraSeccionesEditor
        sections={extraSections}
        onAdd={onAddSection}
        onUpdate={onUpdateSection}
        onRemove={onRemoveSection}
        isAdmin={isAdmin}
      />

      <Section title="Bebidas">
        <BebidasPicker value={indiv.bebidas} onChange={(id) => patchIndiv({ bebidas: id })} />
      </Section>

      <div style={{ paddingTop: 24, borderTop: '1px solid var(--cb-border)' }}>
        <h3 className="h-3" style={{ marginBottom: 16 }}>{isAdmin ? 'Precio y costos' : 'Precio'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 16 }}>
          <Field label="Precio por persona">
            <input type="number" value={indiv.precioPP || ''} onChange={(e) => patchIndiv({ precioPP: parseFloat(e.target.value) || 0 })} placeholder="1000" />
            <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>El que cobras al cliente</p>
          </Field>
          {isAdmin && (
            <Field label={<CostoInternoLabel />}>
              <input type="number" value={indiv.costoPP || ''} onChange={(e) => patchIndiv({ costoPP: parseFloat(e.target.value) || 0 })} placeholder="450" />
              <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>{COSTO_INTERNO_HELPER}</p>
            </Field>
          )}
        </div>
        <IvaServicioToggles
          incluyeIVA={indiv.incluyeIVA}
          incluyeServicio={indiv.incluyeServicio}
          onToggleIVA={(v) => patchIndiv({ incluyeIVA: v })}
          onToggleServicio={(v) => patchIndiv({ incluyeServicio: v })}
        />
      </div>
    </div>
  );
}

function OpcionesMode({
  config, patchOpciones, menuPorCategoria, toggleArrayItem,
  extraSections, onAddSection, onUpdateSection, onRemoveSection, isAdmin,
}: {
  config: QuoteConfig;
  patchOpciones: (p: Partial<QuoteConfig['opciones']>) => void;
  menuPorCategoria: (cat: QuoteCategoria) => typeof MENU;
  toggleArrayItem: (arr: string[], id: string) => string[];
  extraSections: ExtraSection[];
  onAddSection: () => void;
  onUpdateSection: (id: string, patch: Partial<ExtraSection>) => void;
  onRemoveSection: (id: string) => void;
  isAdmin: boolean;
}) {
  const { opciones } = config;
  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-2" style={{ margin: 0 }}>Menú con 3 opciones de plato fuerte</h3>
      <p className="small text-2" style={{ margin: '4px 0 24px' }}>El cliente elige A, B o C. Cada opción tiene su propio precio.</p>

      <Section title="1° Tiempo · Sopa o Crema" hint="A elegir 1">
        <div className="grid-2-sm">
          {menuPorCategoria('Sopas').map((dish) => (
            <label key={dish.id} className="item-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={opciones.sopas.includes(dish.id)} onChange={() => patchOpciones({ sopas: toggleArrayItem(opciones.sopas, dish.id) })} />
              <span className="small">{dish.nombre}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="2° Tiempo · 3 Opciones de Plato Fuerte">
        {opciones.tiers.map((tier, i) => {
          const precio = tier.precio || 0;
          const costo = tier.costoPP ?? 0;
          // Per-tier margen lets hostess sanity-check each option in
          // isolation — A might be a loss-leader while C is the cushion.
          // Heuristic fallback (precio × 0.42) only when costo is unset,
          // so old quotes don't suddenly read 100% margin.
          const effectiveCosto = costo > 0 ? costo : precio * 0.42;
          const margen = precio > 0 ? Math.round(((precio - effectiveCosto) / precio) * 100) : 0;
          return (
            <div key={tier.letra} className="tier-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="tier-letter">{tier.letra}</span>
                  <span className="h-3">Opción {tier.letra}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className="mini">Precio/pp</label>
                    <input
                      type="number"
                      value={tier.precio || ''}
                      onChange={(e) => {
                        const next = [...opciones.tiers];
                        next[i] = { ...next[i], precio: parseFloat(e.target.value) || 0 };
                        patchOpciones({ tiers: next });
                      }}
                      style={{ width: 88 }}
                      placeholder="1100"
                    />
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label className="mini" title={COSTO_INTERNO_HELPER} style={{ cursor: 'help' }}>Costo/pp</label>
                      <input
                        type="number"
                        value={tier.costoPP || ''}
                        onChange={(e) => {
                          const next = [...opciones.tiers];
                          next[i] = { ...next[i], costoPP: parseFloat(e.target.value) || 0 };
                          patchOpciones({ tiers: next });
                        }}
                        style={{ width: 88 }}
                        placeholder="450"
                      />
                    </div>
                  )}
                  {isAdmin && precio > 0 && (
                    <span className="mini" style={{ minWidth: 56, textAlign: 'right' }}>
                      Margen <span className="num" style={{ color: 'var(--cb-text)' }}>{margen}%</span>
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={tier.platos}
                onChange={(e) => {
                  const next = [...opciones.tiers];
                  next[i] = { ...next[i], platos: e.target.value };
                  patchOpciones({ tiers: next });
                }}
                rows={3}
                placeholder="Una opción por línea, ej:&#10;Arrachera 250g / Puré de Papa&#10;Pechuga 300g / Papas Estilo Norteño"
                className="small"
              />
            </div>
          );
        })}
      </Section>

      <Section title="3° Tiempo · Postre" hint="A elegir 1+">
        <div className="grid-2-sm">
          {menuPorCategoria('Postres').map((dish) => (
            <label key={dish.id} className="item-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={opciones.postres.includes(dish.id)} onChange={() => patchOpciones({ postres: toggleArrayItem(opciones.postres, dish.id) })} />
              <span className="small">{dish.nombre}</span>
            </label>
          ))}
        </div>
      </Section>

      <ExtraSeccionesEditor
        sections={extraSections}
        onAdd={onAddSection}
        onUpdate={onUpdateSection}
        onRemove={onRemoveSection}
        isAdmin={isAdmin}
      />

      <Section title="Bebidas (incluidas en todas las opciones)">
        <BebidasPicker value={opciones.bebidas} onChange={(id) => patchOpciones({ bebidas: id })} />
      </Section>

      <div style={{ paddingTop: 24, borderTop: '1px solid var(--cb-border)' }}>
        <IvaServicioToggles
          incluyeIVA={opciones.incluyeIVA}
          incluyeServicio={opciones.incluyeServicio}
          onToggleIVA={(v) => patchOpciones({ incluyeIVA: v })}
          onToggleServicio={(v) => patchOpciones({ incluyeServicio: v })}
          ivaLabel="Precios incluyen IVA"
        />
      </div>
    </div>
  );
}

function AsadoMode({
  config, patchAsado, menuPorCategoria, setAsadoCantidad, toggleVariant,
  extraSections, onAddSection, onUpdateSection, onRemoveSection, isAdmin,
}: {
  config: QuoteConfig;
  patchAsado: (p: Partial<QuoteConfig['asado']>) => void;
  menuPorCategoria: (cat: QuoteCategoria) => typeof MENU;
  setAsadoCantidad: (id: string, qty: number) => void;
  toggleVariant: (dishId: string, variant: string) => void;
  extraSections: ExtraSection[];
  onAddSection: () => void;
  onUpdateSection: (id: string, patch: Partial<ExtraSection>) => void;
  onRemoveSection: (id: string) => void;
  isAdmin: boolean;
}) {
  const { asado } = config;
  const personas = Math.max(1, config.evento.personas || 1);
  // Auto-derived numbers shown as placeholders so hostess can see what
  // the markup-based math would produce before deciding to override.
  const autoCostoPP = Object.entries(asado.cantidades).reduce((sum, [id, qty]) => {
    const d = dishById(id);
    if (!d || qty <= 0) return sum;
    const mult = d.perPerson ? personas : 1;
    return sum + (d.precio * qty * mult);
  }, 0) / personas;
  const autoVentaPP = autoCostoPP * (1 + (asado.markup || 0) / 100);
  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-2" style={{ margin: 0 }}>Asado argentino al centro</h3>
      <p className="small text-2" style={{ margin: '4px 0 24px' }}>Define cantidades específicas de cada platillo. Ideal para grupos donde todo se comparte.</p>

      {(['Entradas', 'Parrilla', 'Guarniciones'] as QuoteCategoria[]).map((cat) => (
        <Section key={cat} title={cat}>
          <div style={{ maxHeight: 288, overflowY: 'auto', paddingRight: 4 }} className="scroll-thin">
            {menuPorCategoria(cat).map((dish) => {
              const qty = asado.cantidades[dish.id] || 0;
              const selectedVariants = asado.dishVariants[dish.id] ?? [];
              const showVariantPicker = qty > 0 && dish.variants && dish.variants.length > 0;
              return (
                <div key={dish.id} className={`item-row ${qty > 0 ? 'selected' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="small" style={{ margin: 0 }}>{dish.nombre}</p>
                      <p className="text-3" style={{ fontSize: 12, marginTop: 2 }}>{(dish.peso ? dish.peso + ' · ' : '')}${dish.precio}</p>
                    </div>
                    <QtyControl qty={qty} onChange={(q) => setAsadoCantidad(dish.id, q)} />
                  </div>
                  {showVariantPicker && (
                    <VariantChips
                      options={dish.variants!}
                      selected={selectedVariants}
                      onToggle={(v) => toggleVariant(dish.id, v)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <ExtraSeccionesEditor
        sections={extraSections}
        onAdd={onAddSection}
        onUpdate={onUpdateSection}
        onRemove={onRemoveSection}
        isAdmin={isAdmin}
      />

      <Section title="Bebidas">
        <BebidasPicker value={asado.bebidas} onChange={(id) => patchAsado({ bebidas: id })} />
      </Section>

      <div style={{ paddingTop: 24, borderTop: '1px solid var(--cb-border)' }}>
        {isAdmin && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <label className="mini">Markup (% ganancia)</label>
              <span className="h-3 num">{asado.markup}%</span>
            </div>
            <input type="range" min={0} max={200} step={5} value={asado.markup} onChange={(e) => patchAsado({ markup: parseInt(e.target.value) })} style={{ width: '100%' }} />
          </>
        )}
        <ManualPrecioCostoOverride
          autoCostoPP={autoCostoPP}
          autoVentaPP={autoVentaPP}
          precioPPManual={asado.precioPPManual ?? 0}
          costoPPManual={asado.costoPPManual ?? 0}
          onChange={(patch) => patchAsado(patch)}
          isAdmin={isAdmin}
        />
        <IvaServicioToggles
          incluyeIVA={asado.incluyeIVA}
          incluyeServicio={asado.incluyeServicio}
          onToggleIVA={(v) => patchAsado({ incluyeIVA: v })}
          onToggleServicio={(v) => patchAsado({ incluyeServicio: v })}
        />
      </div>
    </div>
  );
}

function CartaMode({
  config, patchCarta, menuPorCategoria, categoriaActiva, setCategoriaActiva, setCartaCantidad, openSidePicker, toggleVariant,
  extraSections, onAddSection, onUpdateSection, onRemoveSection, isAdmin,
}: {
  config: QuoteConfig;
  patchCarta: (p: Partial<QuoteConfig['carta']>) => void;
  menuPorCategoria: (cat: QuoteCategoria) => typeof MENU;
  categoriaActiva: QuoteCategoria;
  setCategoriaActiva: (cat: QuoteCategoria) => void;
  setCartaCantidad: (id: string, qty: number) => void;
  openSidePicker: (parrillaId: string) => void;
  toggleVariant: (dishId: string, variant: string) => void;
  extraSections: ExtraSection[];
  onAddSection: () => void;
  onUpdateSection: (id: string, patch: Partial<ExtraSection>) => void;
  onRemoveSection: (id: string) => void;
  isAdmin: boolean;
}) {
  const { carta } = config;
  const personas = Math.max(1, config.evento.personas || 1);
  const autoCostoPP = Object.entries(carta.cantidades).reduce((sum, [id, qty]) => {
    const d = dishById(id);
    if (!d || qty <= 0) return sum;
    const mult = d.perPerson ? personas : 1;
    return sum + (d.precio * qty * mult);
  }, 0) / personas;
  const autoVentaPP = autoCostoPP * (1 + (carta.markup || 0) / 100);
  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-2" style={{ margin: 0 }}>Constructor a la carta</h3>
      <p className="small text-2" style={{ margin: '4px 0 24px' }}>Selecciona platillos. Ajusta cantidad por separado de cada uno.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--cb-border)' }}>
        {CATEGORIAS.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoriaActiva(cat)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              border: '1px solid var(--cb-border)',
              cursor: 'pointer',
              background: categoriaActiva === cat ? 'var(--cb-text)' : '#fff',
              color: categoriaActiva === cat ? '#fff' : 'var(--cb-text)',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 500, overflowY: 'auto', paddingRight: 4 }} className="scroll-thin">
        {menuPorCategoria(categoriaActiva).map((dish) => {
          const qty = carta.cantidades[dish.id] || 0;
          const isParr = dish.categoria === 'Parrilla';
          const sideId = isParr ? carta.parrillaSides[dish.id] : undefined;
          const sideName = sideId ? dishById(sideId)?.nombre : undefined;
          const selectedVariants = carta.dishVariants[dish.id] ?? [];
          const showVariantPicker = qty > 0 && dish.variants && dish.variants.length > 0;
          return (
            <div key={dish.id} className={`item-row ${qty > 0 ? 'selected' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span className="small" style={{ fontWeight: 500 }}>{dish.nombre}</span>
                    {dish.peso && <span className="text-3" style={{ fontSize: 12 }}>{dish.peso}</span>}
                    {dish.tag && <span className="text-3" style={{ fontSize: 12 }}>· {dish.tag}</span>}
                  </div>
                  {dish.desc && <p className="text-3" style={{ fontSize: 12, marginTop: 2 }}>{dish.desc}</p>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="small text-3 num" style={{ whiteSpace: 'nowrap' }}>${dish.precio}</span>
                  <QtyControl qty={qty} onChange={(q) => setCartaCantidad(dish.id, q)} />
                </div>
              </div>
              {qty > 0 && isParr && (
                <button
                  type="button"
                  onClick={() => openSidePicker(dish.id)}
                  className="parrilla-side-link"
                >
                  <span className="parrilla-side-arrow">→</span>
                  <span className="parrilla-side-text">Guarnición incluida: <strong>{sideName ?? 'Elegir'}</strong></span>
                  <span className="parrilla-side-change">Cambiar</span>
                </button>
              )}
              {showVariantPicker && (
                <VariantChips
                  options={dish.variants!}
                  selected={selectedVariants}
                  onToggle={(v) => toggleVariant(dish.id, v)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ paddingTop: 24, borderTop: '1px solid var(--cb-border)', marginTop: 24 }}>
        <ExtraSeccionesEditor
          sections={extraSections}
          onAdd={onAddSection}
          onUpdate={onUpdateSection}
          onRemove={onRemoveSection}
          isAdmin={isAdmin}
        />
        <Section title="Bebidas">
          <BebidasPicker value={carta.bebidas} onChange={(id) => patchCarta({ bebidas: id })} />
        </Section>
        {isAdmin && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <label className="mini">Markup (% ganancia)</label>
              <span className="h-3 num">{carta.markup}%</span>
            </div>
            <input type="range" min={0} max={200} step={5} value={carta.markup} onChange={(e) => patchCarta({ markup: parseInt(e.target.value) })} style={{ width: '100%' }} />
          </>
        )}
        <ManualPrecioCostoOverride
          autoCostoPP={autoCostoPP}
          autoVentaPP={autoVentaPP}
          precioPPManual={carta.precioPPManual ?? 0}
          costoPPManual={carta.costoPPManual ?? 0}
          onChange={(patch) => patchCarta(patch)}
          isAdmin={isAdmin}
        />
        <IvaServicioToggles
          incluyeIVA={carta.incluyeIVA}
          incluyeServicio={carta.incluyeServicio}
          onToggleIVA={(v) => patchCarta({ incluyeIVA: v })}
          onToggleServicio={(v) => patchCarta({ incluyeServicio: v })}
        />
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <label className="h-3">{title}</label>
        {hint && <span className="mini">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// Multi-select chip picker for dishes that have variants/fillings
// (e.g. empanada flavors, pasta sauces). Empty selection is valid —
// Vista Cliente skips the sub-line until the hostess locks in choices.
function VariantChips({
  options, selected, onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (variant: string) => void;
}) {
  return (
    <div className="variant-chip-row">
      <span className="variant-chip-label">Sabores:</span>
      <div className="variant-chip-list">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={`variant-chip ${isSelected ? 'selected' : ''}`}
              aria-pressed={isSelected}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button type="button" onClick={() => onChange(qty - 1)} className="qty-btn">−</button>
      <input
        type="number"
        min={0}
        value={qty}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="qty-input num"
      />
      <button type="button" onClick={() => onChange(qty + 1)} className="qty-btn">+</button>
    </div>
  );
}

function SidePickerModal({
  parrillaName, currentSideId, onPick, onClose,
}: {
  parrillaName: string;
  currentSideId: string | undefined;
  onPick: (sideId: string) => void;
  onClose: () => void;
}) {
  const sides = eligibleIncludedSides();
  return (
    <div className="side-picker-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="side-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="side-picker-header">
          <div>
            <p className="mini" style={{ marginBottom: 4 }}>Incluida sin costo</p>
            <h3 className="h-2" style={{ margin: 0 }}>Elige la guarnición</h3>
            {parrillaName && <p className="small text-2" style={{ margin: '4px 0 0' }}>Para {parrillaName}</p>}
          </div>
          <button type="button" onClick={onClose} className="side-picker-close" aria-label="Cerrar">×</button>
        </div>
        <div className="side-picker-list scroll-thin">
          {sides.map((side) => {
            const selected = side.id === currentSideId;
            return (
              <button
                key={side.id}
                type="button"
                onClick={() => onPick(side.id)}
                className={`side-picker-option ${selected ? 'selected' : ''}`}
              >
                <span className="small" style={{ fontWeight: 500 }}>{side.nombre}</span>
                {selected && <span className="mini" style={{ color: 'var(--cb-text)' }}>✓ Elegida</span>}
              </button>
            );
          })}
        </div>
        <p className="text-3" style={{ fontSize: 12, padding: '12px 20px 0', margin: 0, borderTop: '1px solid var(--cb-border)' }}>
          Espárragos y Tuétano siempre se cobran aparte. Agrégalos en la sección Guarniciones si el cliente los quiere.
        </p>
      </div>
    </div>
  );
}

// Extra sections editor — visible in every mode above Bebidas. Lets the
// hostess add cocktail hours, dessert stations, cheese tables, etc. Each
// section is fully editable in place (no modal) and renders as its own
// header + body block on Vista Cliente. Multiple allowed; precio rolls
// into per-pp total via computePricing.
function ExtraSeccionesEditor({
  sections, onAdd, onUpdate, onRemove, isAdmin,
}: {
  sections: ExtraSection[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ExtraSection>) => void;
  onRemove: (id: string) => void;
  isAdmin: boolean;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <label className="h-3">Secciones extra</label>
        <span className="mini">Brindis, mesa de quesos…</span>
      </div>
      {sections.length === 0 && (
        <p className="small text-3" style={{ margin: '0 0 12px', fontStyle: 'italic' }}>
          Agrega secciones libres como brindis de recepción, mesa de quesos, estación de postres. Aparecen en la cotización del cliente con el nombre y descripción que tú escribas.
        </p>
      )}
      {sections.map((sec, idx) => (
        <div key={sec.id} className="extra-sec-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
            <span className="mini">Sección {String(idx + 1).padStart(2, '0')}</span>
            <button
              type="button"
              onClick={() => onRemove(sec.id)}
              className="extra-sec-remove"
              aria-label="Eliminar sección"
            >
              Eliminar
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Nombre de la sección">
              <input
                type="text"
                value={sec.nombre}
                onChange={(e) => onUpdate(sec.id, { nombre: e.target.value })}
                placeholder="Ej. Brindis de Recepción"
              />
            </Field>
            <Field label="Descripción">
              <textarea
                value={sec.descripcion}
                onChange={(e) => onUpdate(sec.id, { descripcion: e.target.value })}
                rows={5}
                placeholder={'Lo que quieras describir, ej:\n6 canapés a elegir:\n- Tapa de jamón serrano\n- Volován de mole\n+ 2 bebidas (cerveza nacional o vino casa)'}
                className="small"
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 12 }}>
              <Field label="Precio/pp">
                <input
                  type="number"
                  value={sec.precioPP || ''}
                  onChange={(e) => onUpdate(sec.id, { precioPP: parseFloat(e.target.value) || 0 })}
                  placeholder="700"
                />
                <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>Suma al precio por persona del cliente</p>
              </Field>
              {isAdmin && (
                <Field label={<CostoInternoLabel />}>
                  <input
                    type="number"
                    value={sec.costoPP || ''}
                    onChange={(e) => onUpdate(sec.id, { costoPP: parseFloat(e.target.value) || 0 })}
                    placeholder="280"
                  />
                  <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>Opcional. {COSTO_INTERNO_HELPER}</p>
                </Field>
              )}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="btn btn-secondary"
        style={{ width: '100%', justifyContent: 'center', marginTop: sections.length > 0 ? 4 : 0 }}
      >
        + Agregar sección
      </button>
    </div>
  );
}

// Manual override pair for asado/carta modes. Auto = derived from
// dish-cantidades × markup; the hostess sees those numbers as
// placeholders and can override either one independently. 0/empty
// means "stick with auto." Used after the markup slider.
function ManualPrecioCostoOverride({
  autoCostoPP, autoVentaPP, precioPPManual, costoPPManual, onChange, isAdmin,
}: {
  autoCostoPP: number;
  autoVentaPP: number;
  precioPPManual: number;
  costoPPManual: number;
  onChange: (patch: { precioPPManual?: number; costoPPManual?: number }) => void;
  isAdmin: boolean;
}) {
  // Hostess view: only the price-override field, with no "Auto: $..." hint
  // (that hint exposes the auto-derived venta which leaks markup math).
  // She uses this to lock in the agreed price; cost stays admin-only.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 12, marginTop: 16 }}>
      <Field label="Precio por persona">
        <input
          type="number"
          value={precioPPManual || ''}
          onChange={(e) => onChange({ precioPPManual: parseFloat(e.target.value) || 0 })}
          placeholder={isAdmin && autoVentaPP > 0 ? `Auto: ${fmtMXN(autoVentaPP)}` : '0'}
        />
        <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>
          {isAdmin
            ? 'Vacío = usa el cálculo automático con markup'
            : 'El precio que cobras al cliente'}
        </p>
      </Field>
      {isAdmin && (
        <Field label={<CostoInternoLabel />}>
          <input
            type="number"
            value={costoPPManual || ''}
            onChange={(e) => onChange({ costoPPManual: parseFloat(e.target.value) || 0 })}
            placeholder={autoCostoPP > 0 ? `Auto: ${fmtMXN(autoCostoPP)}` : '0'}
          />
          <p className="text-3" style={{ fontSize: 12, marginTop: 6 }}>Vacío = suma de los precios de la carta</p>
        </Field>
      )}
    </div>
  );
}

// ── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
.cotizador-root {
  --cb-bg: #F5F2EC;
  --cb-surface: #FFFFFF;
  --cb-surface-2: #FAF8F3;
  --cb-border: #E8E3D8;
  --cb-border-strong: #D4CFC2;
  --cb-text: #0A0A0A;
  --cb-text-2: #525252;
  --cb-text-3: #A3A3A3;
  background: var(--cb-bg);
  color: var(--cb-text);
  font-family: 'Manrope', system-ui, sans-serif;
  letter-spacing: -0.011em;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 56px);
}
.cotizador-root .serif { font-family: 'Playfair Display', Georgia, serif; }
.cotizador-root .num { font-feature-settings: 'tnum'; font-variant-numeric: tabular-nums; }
.cotizador-root .h-display { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; margin: 0; }
.cotizador-root .h-1 { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.2; margin: 0; }
.cotizador-root .h-2 { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 600; line-height: 1.3; margin: 0; }
.cotizador-root .h-3 { font-size: 14px; font-weight: 600; letter-spacing: -0.005em; margin: 0; }
.cotizador-root .body { font-size: 14px; font-weight: 400; margin: 0; }
.cotizador-root .small { font-size: 13px; font-weight: 400; }
.cotizador-root .mini {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cb-text-3);
  margin: 0;
}
.cotizador-root .text-2 { color: var(--cb-text-2); }
.cotizador-root .text-3 { color: var(--cb-text-3); }

.cotizador-root input[type="text"],
.cotizador-root input[type="number"],
.cotizador-root input[type="date"],
.cotizador-root input[type="email"],
.cotizador-root input[type="tel"],
.cotizador-root select,
.cotizador-root textarea {
  background: #fff;
  border: 1px solid var(--cb-border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  width: 100%;
  color: var(--cb-text);
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}
.cotizador-root input:focus,
.cotizador-root select:focus,
.cotizador-root textarea:focus {
  outline: none;
  border-color: var(--cb-text);
}
.cotizador-root input[type="checkbox"],
.cotizador-root input[type="radio"] { accent-color: var(--cb-text); width: 16px; height: 16px; }
.cotizador-root input[type="range"] { accent-color: var(--cb-text); }

.cotizador-root .btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 18px;
  border-radius: 6px;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  line-height: 1;
  border: 1px solid transparent;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  white-space: nowrap;
}
.cotizador-root .btn:disabled { opacity: 0.6; cursor: wait; }
.cotizador-root .btn-primary { background: var(--cb-text); color: #fff; border-color: var(--cb-text); }
.cotizador-root .btn-primary:hover { background: #1f1f1f; }
.cotizador-root .btn-secondary { background: #fff; color: var(--cb-text); border-color: var(--cb-border-strong); }
.cotizador-root .btn-secondary:hover { border-color: var(--cb-text); }
.cotizador-root .btn-wa { background: #25D366; color: #fff; border-color: #1ebe5a; text-transform: none; }
.cotizador-root .btn-wa:hover { background: #20bf5b; }

.cotizador-root .card { background: #fff; border: 1px solid var(--cb-border); border-radius: 8px; }

.cotizador-root .cb-header {
  background: #fff;
  border-bottom: 1px solid var(--cb-border);
  position: sticky;
  top: 56px;
  z-index: 20;
}
.cotizador-root .cb-header-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 20px;
}
.cotizador-root .cb-row { padding: 20px 0; }
.cotizador-root .cb-tabs {
  display: flex;
  overflow-x: auto;
  border-top: 1px solid var(--cb-border);
}
.cotizador-root .tab {
  padding: 16px 0;
  margin-right: 28px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cb-text-3);
  border-bottom: 2px solid transparent;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.cotizador-root .tab.active { color: var(--cb-text); border-bottom-color: var(--cb-text); }
.cotizador-root .tab:hover { color: var(--cb-text-2); }

.cotizador-root .cb-main {
  margin: 0 auto;
  padding: 40px 20px;
}

.cotizador-root .grid-4 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (min-width: 640px) {
  .cotizador-root .grid-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .cotizador-root .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.cotizador-root .grid-2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 768px) {
  .cotizador-root .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.cotizador-root .grid-2-sm {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}
@media (min-width: 640px) {
  .cotizador-root .grid-2-sm { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.cotizador-root .grid-2-menu {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0 40px;
}
@media (min-width: 768px) {
  .cotizador-root .grid-2-menu { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.cotizador-root .grid-12 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
@media (min-width: 1024px) {
  .cotizador-root .grid-12 { grid-template-columns: 2fr 1fr; }
}

.cotizador-root .col-summary { min-width: 0; }
.cotizador-root .col-builder { min-width: 0; }
.cotizador-root .cb-summary-sticky { position: sticky; top: 200px; display: flex; flex-direction: column; gap: 12px; }

.cotizador-root .item-row {
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
  cursor: pointer;
  display: flex;
  margin: 0;
}
.cotizador-root .item-row:hover { background: var(--cb-surface-2); }
.cotizador-root .item-row.selected { background: var(--cb-surface-2); border-color: var(--cb-border); }

.cotizador-root .tier-card {
  background: var(--cb-surface-2);
  border: 1px solid var(--cb-border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
}
.cotizador-root .tier-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  background: var(--cb-text);
  color: #fff;
  border-radius: 50%;
  font-family: 'Playfair Display', serif;
  font-size: 14px;
  font-weight: 700;
}

.cotizador-root .extra-sec-card {
  background: var(--cb-surface-2);
  border: 1px solid var(--cb-border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
}
.cotizador-root .extra-sec-remove {
  background: transparent;
  border: 1px solid var(--cb-border);
  color: var(--cb-text-2);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cotizador-root .extra-sec-remove:hover {
  border-color: #DC2626;
  color: #DC2626;
}

.cotizador-root .template-card {
  background: #fff;
  border: 1px solid var(--cb-border);
  border-radius: 8px;
  padding: 28px;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.cotizador-root .template-card:hover {
  border-color: var(--cb-text);
  transform: translateY(-1px);
}

.cotizador-root .qty-btn {
  width: 30px; height: 30px;
  border-radius: 5px;
  background: #fff;
  border: 1px solid var(--cb-border);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
  color: var(--cb-text);
  font-size: 14px;
  user-select: none;
}
.cotizador-root .qty-btn:hover { border-color: var(--cb-text); }
.cotizador-root .qty-input {
  width: 44px !important;
  text-align: center;
  padding: 4px !important;
  font-size: 13px !important;
  font-weight: 500;
}

.cotizador-root .scroll-thin::-webkit-scrollbar { width: 5px; height: 5px; }
.cotizador-root .scroll-thin::-webkit-scrollbar-track { background: transparent; }
.cotizador-root .scroll-thin::-webkit-scrollbar-thumb { background: var(--cb-border-strong); border-radius: 2px; }

/* Included-side affordance under each Parrilla row */
.cotizador-root .parrilla-side-link {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: 1px dashed var(--cb-border-strong);
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  color: var(--cb-text-2);
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.cotizador-root .parrilla-side-link:hover { border-color: var(--cb-text); background: var(--cb-surface-2); }
.cotizador-root .parrilla-side-arrow { color: var(--cb-text-3); }
.cotizador-root .parrilla-side-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cotizador-root .parrilla-side-text strong { color: var(--cb-text); font-weight: 600; }
.cotizador-root .parrilla-side-change {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cb-text);
  white-space: nowrap;
}

/* Variant chip multi-selector under dishes with fillings/sauces */
.cotizador-root .variant-chip-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border: 1px dashed var(--cb-border-strong);
  border-radius: 5px;
  background: #fff;
  flex-wrap: wrap;
}
.cotizador-root .variant-chip-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cb-text-3);
  padding: 4px 0;
  flex-shrink: 0;
}
.cotizador-root .variant-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.cotizador-root .variant-chip {
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 999px;
  border: 1px solid var(--cb-border-strong);
  background: #fff;
  color: var(--cb-text-2);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.cotizador-root .variant-chip:hover { border-color: var(--cb-text); color: var(--cb-text); }
.cotizador-root .variant-chip.selected {
  background: var(--cb-text);
  color: #fff;
  border-color: var(--cb-text);
}

/* Side-picker modal — bottom sheet on phone, centered card otherwise */
.cotizador-root .side-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 10, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.cotizador-root .side-picker-sheet {
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--cb-border);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 440px;
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cotizador-root .side-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--cb-border);
}
.cotizador-root .side-picker-close {
  width: 32px; height: 32px;
  border-radius: 6px;
  border: 1px solid var(--cb-border);
  background: #fff;
  color: var(--cb-text-2);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.cotizador-root .side-picker-close:hover { border-color: var(--cb-text); color: var(--cb-text); }
.cotizador-root .side-picker-list {
  display: flex;
  flex-direction: column;
  padding: 8px;
  overflow-y: auto;
  gap: 4px;
}
.cotizador-root .side-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--cb-text);
  transition: background 0.12s, border-color 0.12s;
}
.cotizador-root .side-picker-option:hover { background: var(--cb-surface-2); }
.cotizador-root .side-picker-option.selected { background: var(--cb-surface-2); border-color: var(--cb-border-strong); }

@media (max-width: 640px) {
  .cotizador-root .side-picker-backdrop { align-items: flex-end; padding: 0; }
  .cotizador-root .side-picker-sheet {
    border-radius: 16px 16px 0 0;
    max-width: 100%;
    max-height: 85vh;
  }
}

@media print {
  .cotizador-root .cb-header,
  .cotizador-root .no-print { display: none !important; }
  .cotizador-root { background: #fff !important; }
  .cotizador-root .cb-main { padding: 0 !important; max-width: 100% !important; }
}

/* iPad / tablet */
@media (max-width: 1024px) {
  .cotizador-root .cb-header-inner { padding: 0 16px; }
  .cotizador-root .cb-main { padding: 28px 16px; }
  .cotizador-root .h-display { font-size: 26px; }
  .cotizador-root .h-1 { font-size: 22px; }
  .cotizador-root .cb-summary-sticky { position: static; top: auto; }
  .cotizador-root .template-card { padding: 22px; }
}

/* Phone */
@media (max-width: 640px) {
  .cotizador-root { min-height: calc(100vh - 56px); }
  .cotizador-root .cb-header { top: 56px; }
  .cotizador-root .cb-header-inner { padding: 0 14px; }
  .cotizador-root .cb-row { padding: 14px 0 !important; }
  /* Playfair ascenders/descenders extend past the line-box; pin a roomier
     line-height + bottom padding on phones so the next paragraph (subtitle,
     card subtitle) doesn't visually crash into the heading glyphs. */
  .cotizador-root .h-display { font-size: 22px; line-height: 1.25; padding-bottom: 2px; }
  .cotizador-root .h-1 { font-size: 19px; line-height: 1.3; padding-bottom: 2px; }
  .cotizador-root .h-2 { font-size: 16px; line-height: 1.4; padding-bottom: 2px; }
  .cotizador-root .cb-main { padding: 20px 14px; }

  /* Prevent iOS auto-zoom on focus */
  .cotizador-root input[type="text"],
  .cotizador-root input[type="number"],
  .cotizador-root input[type="date"],
  .cotizador-root input[type="email"],
  .cotizador-root input[type="tel"],
  .cotizador-root select,
  .cotizador-root textarea { font-size: 16px; padding: 11px 12px; }

  .cotizador-root .tab { font-size: 11px; margin-right: 18px; padding: 14px 0; }
  .cotizador-root .btn { padding: 11px 16px; font-size: 13px; }
  .cotizador-root .btn-primary,
  .cotizador-root .btn-secondary { width: auto; }

  .cotizador-root .card { border-radius: 6px; }
  .cotizador-root .template-card { padding: 18px; }
  .cotizador-root .item-row { padding: 12px 12px; }
  .cotizador-root .qty-btn { width: 34px; height: 34px; font-size: 15px; }
  .cotizador-root .qty-input { width: 40px !important; font-size: 14px !important; }

  /* Title + folio/save row stacks cleaner */
  .cotizador-root .cb-row > div[style*="space-between"] { gap: 10px !important; }
}
`;
