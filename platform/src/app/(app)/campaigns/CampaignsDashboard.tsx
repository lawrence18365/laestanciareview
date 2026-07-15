'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Campaign = {
  id: number;
  name: string;
  slug: string;
  status: string;
  campaignType: string;
  audienceRule: string;
  eventDate: string;
  eventTime: string | null;
  offerName: string;
  pricePerPerson: string;
  capacity: number;
  minimumSeats: number;
  feePercent: string;
  audience: number;
  contacted: number;
  bookedSeats: number;
  bookedRevenue: string;
  eligibleRevenue: string;
  feeAmount: string;
};

const DEFAULT_MESSAGE = `Hola 👋 Tenemos una experiencia especial en el restaurante.

{evento}
🗓 {fecha}
💵 {precio} por persona
📍 Cupo limitado

Reserva con anticipo para apartar tu lugar. Escríbenos por aquí y con gusto te atendemos.`;

export default function CampaignsDashboard({
  restaurantName,
  campaigns,
}: {
  restaurantName: string;
  campaigns: Campaign[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    campaignType: 'house_event',
    audienceRule: 'all_consented',
    eventDate: '',
    eventTime: '20:00',
    offerName: '',
    messageText: DEFAULT_MESSAGE,
    pricePerPerson: '1599',
    capacity: '40',
    minimumSeats: '20',
    baselineSeats: '0',
    attributionDays: '30',
    feePercent: '12',
  });

  const totals = useMemo(
    () => ({
      active: campaigns.filter((campaign) => ['ready', 'active', 'paused'].includes(campaign.status)).length,
      audience: campaigns.reduce((sum, campaign) => sum + campaign.audience, 0),
      booked: campaigns.reduce((sum, campaign) => sum + Number(campaign.bookedRevenue), 0),
      eligible: campaigns.reduce((sum, campaign) => sum + Number(campaign.eligibleRevenue), 0),
    }),
    [campaigns],
  );

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'No se pudo crear la campaña.');
        return;
      }
      router.push(`/campaigns/${data.campaign.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="campaigns-index">
      <style>{CSS}</style>
      <section className="campaigns-hero">
        <div>
          <p className="campaigns-kicker">Motor de noches flojas</p>
          <h1>Campañas que terminan en pesos.</h1>
          <p className="campaigns-intro">
            {restaurantName} · audiencias con consentimiento, anticipos y ventas conciliadas.
          </p>
        </div>
        <button className="campaigns-new" onClick={() => setCreating(true)}>+ Nueva campaña</button>
      </section>

      <section className="campaigns-totals" aria-label="Resumen de campañas">
        <Metric label="Campañas en curso" value={String(totals.active)} />
        <Metric label="Audiencia congelada" value={String(totals.audience)} />
        <Metric label="Ingresos reservados" value={mxn(totals.booked)} money />
        <Metric label="Ingreso elegible cobrado" value={mxn(totals.eligible)} money />
      </section>

      {campaigns.length === 0 ? (
        <section className="campaigns-empty">
          <p className="campaigns-kicker">Todavía no hay campañas</p>
          <h2>Empieza con una fecha, una oferta y una audiencia medible.</h2>
          <p>Solo se importan invitados validados que aceptaron comunicación de marketing.</p>
          <button className="campaigns-new" onClick={() => setCreating(true)}>Crear la primera</button>
        </section>
      ) : (
        <section className="campaigns-list">
          {campaigns.map((campaign) => {
            const fill = Math.min(100, Math.round((campaign.bookedSeats / campaign.capacity) * 100));
            return (
              <Link className="campaign-card" href={`/campaigns/${campaign.id}`} key={campaign.id}>
                <div className="campaign-card-top">
                  <div>
                    <span className={`campaign-status status-${campaign.status}`}>{statusLabel(campaign.status)}</span>
                    <h2>{campaign.name}</h2>
                    <p>{formatDate(campaign.eventDate)}{campaign.eventTime ? ` · ${campaign.eventTime}` : ''} · {mxn(Number(campaign.pricePerPerson))} por persona</p>
                  </div>
                  <span className="campaign-arrow">↗</span>
                </div>
                <div className="campaign-progress"><span style={{ width: `${fill}%` }} /></div>
                <div className="campaign-card-grid">
                  <SmallMetric label="Audiencia" value={campaign.audience} />
                  <SmallMetric label="Enviados" value={campaign.contacted} />
                  <SmallMetric label="Asientos" value={`${campaign.bookedSeats}/${campaign.capacity}`} />
                  <SmallMetric label="Reservado" value={mxn(Number(campaign.bookedRevenue))} />
                  <SmallMetric label="Cobrado elegible" value={mxn(Number(campaign.eligibleRevenue))} />
                  <SmallMetric label={`Fee ${Number(campaign.feePercent)}%`} value={mxn(Number(campaign.feeAmount))} />
                </div>
              </Link>
            );
          })}
        </section>
      )}

      {creating && (
        <div className="campaign-modal-backdrop" onMouseDown={() => setCreating(false)}>
          <form className="campaign-modal" onSubmit={createCampaign} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="campaigns-kicker">Nueva campaña</p>
                <h2>Define el evento antes de tocar la lista.</h2>
              </div>
              <button type="button" className="campaign-close" onClick={() => setCreating(false)}>×</button>
            </header>
            <div className="campaign-form-grid">
              <Field label="Nombre de campaña" wide><input required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Cena Maridaje Santo Tomás" /></Field>
              <Field label="Fecha"><input required type="date" value={form.eventDate} onChange={(e) => update('eventDate', e.target.value)} /></Field>
              <Field label="Hora"><input type="time" value={form.eventTime} onChange={(e) => update('eventTime', e.target.value)} /></Field>
              <Field label="Oferta" wide><input required value={form.offerName} onChange={(e) => update('offerName', e.target.value)} placeholder="4 tiempos · 4 vinos · cata dirigida" /></Field>
              <Field label="Precio por persona"><input required min="0" type="number" value={form.pricePerPerson} onChange={(e) => update('pricePerPerson', e.target.value)} /></Field>
              <Field label="Capacidad"><input required min="1" type="number" value={form.capacity} onChange={(e) => update('capacity', e.target.value)} /></Field>
              <Field label="Mínimo viable"><input required min="0" type="number" value={form.minimumSeats} onChange={(e) => update('minimumSeats', e.target.value)} /></Field>
              <Field label="Fee performance %"><input required min="0" max="100" step="0.01" type="number" value={form.feePercent} onChange={(e) => update('feePercent', e.target.value)} /></Field>
              <Field label="Audiencia">
                <select value={form.audienceRule} onChange={(e) => update('audienceRule', e.target.value)}>
                  <option value="all_consented">Todos con consentimiento</option>
                  <option value="wine">Interés en vino</option>
                  <option value="vip">VIP · 5+ visitas</option>
                </select>
              </Field>
              <Field label="Tipo">
                <select value={form.campaignType} onChange={(e) => update('campaignType', e.target.value)}>
                  <option value="house_event">Llenar evento de la casa</option>
                  <option value="private_pipeline">Eventos privados</option>
                </select>
              </Field>
              <Field label="Mensaje WhatsApp" wide><textarea required rows={8} value={form.messageText} onChange={(e) => update('messageText', e.target.value)} /></Field>
            </div>
            <div className="campaign-consent-note">Solo se congelarán invitados validados con consentimiento de marketing activo.</div>
            {error && <p className="campaign-error">{error}</p>}
            <button className="campaign-save" disabled={saving}>{saving ? 'Creando…' : 'Crear y congelar audiencia'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

function Metric({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return <div className="campaign-metric"><span>{label}</span><strong className={money ? 'money' : ''}>{value}</strong></div>;
}

function SmallMetric({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function mxn(value: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value);
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function statusLabel(status: string) {
  return ({ draft: 'Borrador', ready: 'Lista', active: 'Activa', paused: 'Pausada', completed: 'Cerrada', cancelled: 'Cancelada' } as Record<string, string>)[status] ?? status;
}

const CSS = `
.campaigns-index { max-width: 1240px; margin: 0 auto; padding: 2.5rem 2rem 5rem; }
.campaigns-hero { display:flex; justify-content:space-between; gap:2rem; align-items:flex-end; border-bottom:2px solid var(--border-dark); padding-bottom:2rem; }
.campaigns-kicker { margin:0 0 .55rem; color:var(--gold); font-size:.68rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
.campaigns-hero h1 { margin:0; max-width:760px; font-size:clamp(2.5rem,6vw,5.5rem); line-height:.92; }
.campaigns-intro { margin:.9rem 0 0; color:var(--text-muted); }
.campaigns-new,.campaign-save { border:1px solid var(--text-main); background:var(--text-main); color:white; padding:.85rem 1.15rem; font:700 .72rem var(--font-sans); letter-spacing:.08em; text-transform:uppercase; cursor:pointer; white-space:nowrap; }
.campaigns-totals { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--border-dark); border-top:0; }
.campaign-metric { padding:1.2rem 1.35rem; border-right:1px solid var(--panel-border); }
.campaign-metric:last-child { border-right:0; }
.campaign-metric span,.campaign-card-grid span { display:block; color:var(--text-muted); font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
.campaign-metric strong { display:block; margin-top:.35rem; font:600 1.8rem var(--font-serif); }
.campaign-metric strong.money { font-family:var(--font-mono); font-size:1.3rem; }
.campaigns-list { display:grid; gap:1rem; margin-top:2rem; }
.campaign-card { display:block; padding:1.5rem; color:inherit; text-decoration:none; background:var(--panel-bg); border:1px solid var(--border-dark); transition:transform .15s, box-shadow .15s; }
.campaign-card:hover { transform:translate(-2px,-2px); box-shadow:6px 6px 0 var(--text-main); }
.campaign-card-top { display:flex; justify-content:space-between; gap:1rem; }
.campaign-card h2 { margin:.5rem 0 .25rem; font-size:1.75rem; }
.campaign-card p { margin:0; color:var(--text-muted); }
.campaign-arrow { font-size:1.8rem; }
.campaign-status { display:inline-flex; padding:.2rem .45rem; border:1px solid currentColor; font-size:.58rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
.status-active,.status-ready { color:var(--green); } .status-paused { color:var(--gold); } .status-cancelled { color:var(--red); } .status-completed { color:var(--blue); }
.campaign-progress { height:7px; margin:1.25rem 0; background:var(--bg-base); border:1px solid var(--panel-border); }
.campaign-progress span { display:block; height:100%; background:var(--gold); }
.campaign-card-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:1rem; }
.campaign-card-grid strong { display:block; margin-top:.3rem; font-family:var(--font-mono); }
.campaigns-empty { margin-top:2rem; padding:4rem; text-align:center; border:1px dashed var(--text-dim); background:var(--panel-bg); }
.campaigns-empty h2 { max-width:620px; margin:.5rem auto 1rem; font-size:2.2rem; } .campaigns-empty p { color:var(--text-muted); margin-bottom:1.5rem; }
.campaign-modal-backdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:1rem; background:rgba(24,24,27,.72); backdrop-filter:blur(5px); }
.campaign-modal { width:min(760px,100%); max-height:92vh; overflow:auto; padding:1.5rem; background:var(--panel-bg); border:2px solid var(--text-main); box-shadow:12px 12px 0 rgba(0,0,0,.25); }
.campaign-modal header { display:flex; justify-content:space-between; gap:1rem; margin-bottom:1.25rem; } .campaign-modal h2 { margin:0; font-size:2rem; }
.campaign-close { border:0; background:none; font-size:2rem; cursor:pointer; }
.campaign-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.field { display:grid; gap:.4rem; } .field.wide { grid-column:1/-1; } .field span { font-size:.65rem; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--text-muted); }
.field input,.field select,.field textarea { width:100%; border:1px solid var(--panel-border); background:var(--bg-base); color:var(--text-main); padding:.75rem; outline:none; }
.field input:focus,.field select:focus,.field textarea:focus { border-color:var(--gold); box-shadow:0 0 0 2px rgba(180,139,41,.12); }
.campaign-consent-note { margin:1rem 0; padding:.75rem; border-left:3px solid var(--green); background:var(--green-light); color:var(--green); font-size:.8rem; font-weight:600; }
.campaign-error { color:var(--red); font-weight:700; }
.campaign-save { width:100%; }
@media(max-width:900px){.campaigns-totals{grid-template-columns:1fr 1fr}.campaign-metric:nth-child(2){border-right:0}.campaign-metric:nth-child(-n+2){border-bottom:1px solid var(--panel-border)}.campaign-card-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:620px){.campaigns-index{padding:1.25rem 1rem 4rem}.campaigns-hero{align-items:flex-start;flex-direction:column}.campaigns-hero h1{font-size:3rem}.campaigns-totals{grid-template-columns:1fr}.campaign-metric{border-right:0!important;border-bottom:1px solid var(--panel-border)}.campaign-card-grid{grid-template-columns:1fr 1fr}.campaign-form-grid{grid-template-columns:1fr}.field.wide{grid-column:auto}.campaigns-empty{padding:2rem 1rem}}
`;
