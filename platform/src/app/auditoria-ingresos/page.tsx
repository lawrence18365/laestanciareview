'use client';

import { useState } from 'react';
import Link from 'next/link';

const EMPTY = {
  businessName: '',
  name: '',
  phone: '',
  email: '',
  city: '',
  slowNight: '',
  locations: '1',
  listSize: '',
  eventHistory: 'sometimes',
  depositMethod: 'transfer',
  notes: '',
};

export default function RevenueAuditPage() {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/leads/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          city: form.city,
          source: 'slow_night_revenue_audit',
          landingPath: window.location.pathname + window.location.search,
          offer: 'slow_night_revenue_audit',
          metadata: {
            slow_night: form.slowNight,
            locations: form.locations,
            estimated_owned_list: form.listSize,
            event_history: form.eventHistory,
            deposit_method: form.depositMethod,
            notes: form.notes,
            language: 'es',
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'No pudimos guardar tu solicitud. Inténtalo de nuevo.');
        return;
      }
      setComplete(true);
    } catch {
      setError('Error de red. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="audit-page">
      <style>{CSS}</style>
      <nav className="audit-nav">
        <Link href="https://ratetapmx.com/es/" className="audit-logo">RateTap<span>®</span></Link>
        <span>Auditoría de ingresos</span>
      </nav>
      <section className="audit-shell">
        <div className="audit-copy">
          <p className="audit-kicker">Sin anuncios. Sin compromiso.</p>
          <h1>¿Cuánto vale tu noche más floja?</h1>
          <p className="audit-lede">
            Calculamos si puedes llenar una fecha con los clientes que ya conocen tu restaurante. La auditoría separa oportunidad real de una lista demasiado pequeña, una oferta débil o un proceso de anticipo que todavía no está listo.
          </p>
          <div className="audit-output">
            <h2>Te entregamos</h2>
            <ol>
              <li><span>01</span><div><strong>La fecha objetivo</strong><p>Una noche con capacidad disponible y una línea base honesta.</p></div></li>
              <li><span>02</span><div><strong>La audiencia utilizable</strong><p>Cuántos invitados realmente puedes contactar con consentimiento.</p></div></li>
              <li><span>03</span><div><strong>Una oferta de evento</strong><p>Precio, capacidad y mínimo de reservaciones para que valga la pena.</p></div></li>
              <li><span>04</span><div><strong>El modelo en pesos</strong><p>Ingreso posible, anticipo, punto de equilibrio y cómo medir atribución.</p></div></li>
            </ol>
          </div>
          <div className="audit-truth"><strong>La regla:</strong> si no hay suficiente base, consentimiento, margen o capacidad, te lo decimos antes de venderte una campaña.</div>
        </div>

        <div className="audit-form-wrap">
          {complete ? (
            <div className="audit-success">
              <span>✓</span>
              <p className="audit-kicker">Solicitud recibida</p>
              <h2>Ahora hacemos las cuentas.</h2>
              <p>Revisaremos la información y te contactaremos para completar capacidad, ticket y audiencia antes de darte una cifra.</p>
              <Link href="https://ratetapmx.com/es/">Volver a RateTap</Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <header><p className="audit-kicker">Diagnóstico gratuito</p><h2>Cuéntanos qué noche quieres recuperar.</h2></header>
              <Field label="Restaurante o grupo" wide><input required value={form.businessName} onChange={(e) => update('businessName', e.target.value)} /></Field>
              <div className="audit-grid">
                <Field label="Tu nombre"><input required value={form.name} onChange={(e) => update('name', e.target.value)} /></Field>
                <Field label="WhatsApp"><input required inputMode="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></Field>
                <Field label="Email"><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></Field>
                <Field label="Ciudad"><input required value={form.city} onChange={(e) => update('city', e.target.value)} /></Field>
                <Field label="Noche o servicio más flojo"><input required placeholder="Ej. jueves cena" value={form.slowNight} onChange={(e) => update('slowNight', e.target.value)} /></Field>
                <Field label="Número de sucursales"><input required min="1" type="number" value={form.locations} onChange={(e) => update('locations', e.target.value)} /></Field>
                <Field label="Tamaño aproximado de tu lista"><select required value={form.listSize} onChange={(e) => update('listSize', e.target.value)}><option value="">Selecciona</option><option value="0-250">0–250</option><option value="251-750">251–750</option><option value="751-2000">751–2,000</option><option value="2000+">2,000+</option><option value="unknown">No sé</option></select></Field>
                <Field label="¿Ya haces eventos?"><select value={form.eventHistory} onChange={(e) => update('eventHistory', e.target.value)}><option value="often">Sí, seguido</option><option value="sometimes">A veces</option><option value="never">Todavía no</option></select></Field>
                <Field label="¿Cómo cobras anticipos?" wide><select value={form.depositMethod} onChange={(e) => update('depositMethod', e.target.value)}><option value="transfer">SPEI / transferencia</option><option value="payment_link">Link de pago propio</option><option value="cash">En sucursal</option><option value="none">No cobramos anticipo</option><option value="other">Otro</option></select></Field>
                <Field label="Contexto adicional" wide><textarea rows={4} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Capacidad, ticket por persona, tipo de evento o cualquier restricción." /></Field>
              </div>
              {error && <p className="audit-error">{error}</p>}
              <button disabled={saving}>{saving ? 'Guardando…' : 'Solicitar auditoría gratuita'}</button>
              <small>No procesamos pagos en esta auditoría. Tus datos se usan para evaluar y responder esta solicitud.</small>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'audit-field wide' : 'audit-field'}><span>{label}</span>{children}</label>;
}

const CSS = `
.audit-page{min-height:100vh;background:#f2efe8;color:#1d1d1b;font-family:var(--font-sans)}.audit-nav{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(1rem,5vw,5rem);border-bottom:1px solid #1d1d1b;font-size:.66rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.audit-logo{font:700 1.45rem var(--font-serif);color:#1d1d1b;text-decoration:none;letter-spacing:-.02em;text-transform:none}.audit-logo span{font:500 .5rem var(--font-sans);vertical-align:top}.audit-shell{display:grid;grid-template-columns:minmax(0,.9fr) minmax(520px,1.1fr);max-width:1440px;margin:auto}.audit-copy{padding:clamp(3rem,7vw,7rem) clamp(1.25rem,5vw,5rem);border-right:1px solid #1d1d1b}.audit-kicker{margin:0 0 .65rem;color:#8b6a17;font-size:.66rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.audit-copy h1{margin:0;font-size:clamp(3.7rem,7vw,7.4rem);line-height:.86;letter-spacing:-.045em}.audit-lede{max-width:650px;margin:2rem 0 3rem;font-size:1.05rem;line-height:1.7;color:#57534e}.audit-output{border-top:1px solid #1d1d1b;padding-top:1.5rem}.audit-output h2{font-size:1.8rem}.audit-output ol{list-style:none;padding:0;margin:0}.audit-output li{display:grid;grid-template-columns:44px 1fr;gap:1rem;padding:1rem 0;border-top:1px solid #d0cbc0}.audit-output li>span{font:700 .7rem var(--font-mono);color:#8b6a17}.audit-output strong{font-size:.9rem}.audit-output p{margin:.25rem 0 0;color:#78716c;font-size:.78rem}.audit-truth{margin-top:2rem;padding:1rem;border-left:4px solid #8b6a17;background:#e9e1cd;font-size:.8rem}.audit-form-wrap{padding:clamp(2rem,6vw,6rem);display:grid;align-items:center}.audit-form-wrap form,.audit-success{background:white;border:1px solid #1d1d1b;padding:clamp(1.25rem,3vw,2.4rem);box-shadow:12px 12px 0 #1d1d1b}.audit-form-wrap h2,.audit-success h2{margin:.2rem 0 1.5rem;font-size:2.4rem;line-height:1}.audit-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.audit-field{display:grid;gap:.4rem;margin-bottom:1rem}.audit-field.wide{grid-column:1/-1}.audit-field>span{font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6b6560}.audit-field input,.audit-field select,.audit-field textarea{width:100%;padding:.75rem;border:1px solid #aaa39a;background:#f8f6f1;color:#1d1d1b;outline:none}.audit-field input:focus,.audit-field select:focus,.audit-field textarea:focus{border-color:#8b6a17;box-shadow:0 0 0 3px #eee5ce}.audit-form-wrap button{width:100%;border:1px solid #1d1d1b;background:#1d1d1b;color:white;padding:1rem;font-size:.7rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}.audit-form-wrap button:disabled{opacity:.5}.audit-form-wrap form>small{display:block;margin-top:.8rem;text-align:center;color:#78716c;font-size:.68rem}.audit-error{color:#b42318;font-weight:700}.audit-success{text-align:center;padding:4rem 2rem}.audit-success>span{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 1.5rem;background:#176b46;color:white;font-size:1.5rem}.audit-success p:not(.audit-kicker){color:#6b6560}.audit-success a{display:inline-block;margin-top:1rem;color:#1d1d1b;font-weight:800}@media(max-width:980px){.audit-shell{grid-template-columns:1fr}.audit-copy{border-right:0;border-bottom:1px solid #1d1d1b}.audit-copy h1{font-size:clamp(3.5rem,14vw,6rem)}.audit-form-wrap{padding:2rem 1rem}}@media(max-width:600px){.audit-grid{grid-template-columns:1fr}.audit-field.wide{grid-column:auto}.audit-nav>span{display:none}.audit-form-wrap h2{font-size:2rem}}
`;
