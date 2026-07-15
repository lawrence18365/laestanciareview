'use client';

import { useMemo, useState } from 'react';
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
  messageText: string;
  pricePerPerson: string;
  capacity: number;
  minimumSeats: number;
  baselineSeats: number;
  attributionDays: number;
  feePercent: string;
  audienceSeededAt: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Contact = {
  id: number;
  guestId: number;
  segment: string;
  priority: number;
  status: string;
  openedAt: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  optedOutAt: string | null;
  notes: string | null;
  name: string;
  whatsapp: string;
  birthdayMmdd: string | null;
  preferences: string[] | null;
  marketingConsent: boolean;
  guestStatus: string;
  redemptionType: string | null;
  visitCount: number;
};

type Booking = {
  id: number;
  contactId: number | null;
  guestId: number | null;
  clientName: string;
  clientPhone: string | null;
  partySize: number;
  status: string;
  attributionSource: string;
  attributionEvidence: string | null;
  bookedAmount: string;
  depositAmount: string;
  collectedAmount: string;
  refundedAmount: string;
  ivaAmount: string;
  serviceChargeAmount: string;
  gratuityAmount: string;
  eligibleRevenue: string;
  feeAmount: string;
  depositReceivedAt: string | null;
  bookedAt: string | null;
  attendedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tab = 'pending' | 'sent' | 'interest' | 'booked' | 'closed';

const EMPTY_BOOKING = {
  contactId: null as number | null,
  clientName: '',
  clientPhone: '',
  partySize: '2',
  status: 'deposit_pending',
  attributionSource: 'direct',
  attributionEvidence: 'Contacto incluido en la audiencia congelada de la campaña.',
  bookedAmount: '0',
  depositAmount: '0',
  collectedAmount: '0',
  refundedAmount: '0',
  ivaAmount: '0',
  serviceChargeAmount: '0',
  gratuityAmount: '0',
};

export default function CampaignWorkspace({
  restaurantName,
  campaign: initialCampaign,
  initialContacts,
  initialBookings,
}: {
  restaurantName: string;
  campaign: Campaign;
  initialContacts: Contact[];
  initialBookings: Booking[];
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [contacts, setContacts] = useState(initialContacts);
  const [bookings, setBookings] = useState(initialBookings);
  const [tab, setTab] = useState<Tab>('pending');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<number | null>(null);
  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING);
  const [bookingError, setBookingError] = useState('');
  const [contactError, setContactError] = useState('');

  const metrics = useMemo(() => {
    const sent = contacts.filter((contact) => contact.sentAt).length;
    const replies = contacts.filter((contact) => contact.repliedAt).length;
    const booked = bookings.filter((booking) => ['booked', 'attended'].includes(booking.status));
    return {
      audience: contacts.length,
      sent,
      replies,
      bookedSeats: booked.reduce((sum, booking) => sum + booking.partySize, 0),
      bookedRevenue: bookings
        .filter((booking) => !['cancelled', 'refunded'].includes(booking.status))
        .reduce((sum, booking) => sum + Number(booking.bookedAmount), 0),
      deposits: bookings.reduce((sum, booking) => sum + Number(booking.depositAmount), 0),
      collected: bookings.reduce((sum, booking) => sum + Number(booking.eligibleRevenue), 0),
      fee: bookings.reduce((sum, booking) => sum + Number(booking.feeAmount), 0),
    };
  }, [contacts, bookings]);

  const visibleContacts = useMemo(() => {
    const statusForTab: Record<Tab, string[]> = {
      pending: ['queued', 'opened'],
      sent: ['sent'],
      interest: ['replied', 'interested', 'deposit_pending'],
      booked: ['booked'],
      closed: ['declined', 'opted_out'],
    };
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (!statusForTab[tab].includes(contact.status)) return false;
      return !needle || `${contact.name} ${contact.whatsapp} ${contact.segment}`.toLowerCase().includes(needle);
    });
  }, [contacts, tab, query]);

  const statusCounts = useMemo(
    () => ({
      pending: contacts.filter((contact) => ['queued', 'opened'].includes(contact.status)).length,
      sent: contacts.filter((contact) => contact.status === 'sent').length,
      interest: contacts.filter((contact) => ['replied', 'interested', 'deposit_pending'].includes(contact.status)).length,
      booked: contacts.filter((contact) => contact.status === 'booked').length,
      closed: contacts.filter((contact) => ['declined', 'opted_out'].includes(contact.status)).length,
    }),
    [contacts],
  );

  async function patchCampaign(status: string) {
    setBusyId(-1);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (response.ok) setCampaign((current) => ({ ...current, ...serializeCampaign(data.campaign) }));
    } finally {
      setBusyId(null);
    }
  }

  async function patchContact(contactId: number, status: string, notes?: string | null) {
    setBusyId(contactId);
    setContactError('');
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      const data = await response.json();
      if (response.ok) {
        setContacts((current) => current.map((contact) => contact.id === contactId ? { ...contact, ...serializeContact(data.contact) } : contact));
      } else {
        setContactError(data.error ?? 'No se pudo actualizar el contacto. Recarga la página e inténtalo de nuevo.');
      }
      return response.ok;
    } catch {
      setContactError('Error de red. No se abrió WhatsApp ni se registró el cambio.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function openWhatsApp(contact: Contact) {
    const url = `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(renderMessage(campaign, contact))}`;
    const pendingWindow = window.open('about:blank', '_blank');
    const contactable = await patchContact(contact.id, 'opened', contact.notes);
    if (!contactable) {
      pendingWindow?.close();
      return;
    }
    if (pendingWindow) {
      pendingWindow.opener = null;
      pendingWindow.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function newBooking(contact?: Contact) {
    const partySize = 2;
    setEditingBookingId(null);
    setBookingForm({
      ...EMPTY_BOOKING,
      contactId: contact?.id ?? null,
      clientName: contact?.name ?? '',
      clientPhone: contact?.whatsapp ?? '',
      partySize: String(partySize),
      bookedAmount: String(Number(campaign.pricePerPerson) * partySize),
    });
    setBookingError('');
    setBookingOpen(true);
  }

  function editBooking(booking: Booking) {
    setEditingBookingId(booking.id);
    setBookingForm({
      contactId: booking.contactId,
      clientName: booking.clientName,
      clientPhone: booking.clientPhone ?? '',
      partySize: String(booking.partySize),
      status: booking.status,
      attributionSource: booking.attributionSource,
      attributionEvidence: booking.attributionEvidence ?? '',
      bookedAmount: booking.bookedAmount,
      depositAmount: booking.depositAmount,
      collectedAmount: booking.collectedAmount,
      refundedAmount: booking.refundedAmount,
      ivaAmount: booking.ivaAmount,
      serviceChargeAmount: booking.serviceChargeAmount,
      gratuityAmount: booking.gratuityAmount,
    });
    setBookingError('');
    setBookingOpen(true);
  }

  async function saveBooking(event: React.FormEvent) {
    event.preventDefault();
    setBusyId(-2);
    setBookingError('');
    try {
      const endpoint = editingBookingId
        ? `/api/campaigns/${campaign.id}/bookings/${editingBookingId}`
        : `/api/campaigns/${campaign.id}/bookings`;
      const response = await fetch(endpoint, {
        method: editingBookingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingForm),
      });
      const data = await response.json();
      if (!response.ok) {
        setBookingError(data.error ?? 'No se pudo guardar la reservación.');
        return;
      }
      const saved = serializeBooking(data.booking);
      setBookings((current) => editingBookingId ? current.map((booking) => booking.id === saved.id ? saved : booking) : [saved, ...current]);
      if (bookingForm.contactId) {
        const status = ['booked', 'attended'].includes(bookingForm.status)
          ? 'booked'
          : bookingForm.status === 'deposit_pending' ? 'deposit_pending' : 'interested';
        setContacts((current) => current.map((contact) => contact.id === bookingForm.contactId ? { ...contact, status } : contact));
      }
      setBookingOpen(false);
    } finally {
      setBusyId(null);
    }
  }

  const fill = Math.min(100, Math.round((metrics.bookedSeats / campaign.capacity) * 100));
  const contactsPerSeat = campaign.capacity > 0 ? metrics.audience / campaign.capacity : 0;

  return (
    <div className="workspace">
      <style>{CSS}</style>
      <style>{'.contact-error{margin:0;padding:.75rem 1rem;border-bottom:1px solid var(--red);background:#fff0ee;color:var(--red);font-size:.75rem;font-weight:700}'}</style>
      <Link className="back" href="/campaigns">← Todas las campañas</Link>
      <header className="workspace-head">
        <div>
          <div className="workspace-labels"><span className={`state state-${campaign.status}`}>{campaignStatus(campaign.status)}</span><span>{restaurantName}</span></div>
          <h1>{campaign.name}</h1>
          <p>{formatDate(campaign.eventDate)}{campaign.eventTime ? ` · ${campaign.eventTime}` : ''} · {campaign.offerName}</p>
        </div>
        <CampaignActions campaign={campaign} busy={busyId === -1} onStatus={patchCampaign} />
      </header>

      {campaign.status === 'draft' && (
        <div className="readiness-banner"><strong>Borrador:</strong> confirma capacidad, precio, anticipo y responsable de respuestas antes de marcar la campaña como lista.</div>
      )}
      <div className="consent-banner"><strong>Audiencia segura:</strong> esta lista contiene únicamente invitados validados con consentimiento activo al momento de congelarla. El envío vuelve a comprobar ese estado.</div>

      <section className="money-strip">
        <TopMetric label="Audiencia elegible" value={String(metrics.audience)} note={`${contactsPerSeat.toFixed(1)} contactos por asiento objetivo`} />
        <TopMetric label="Mensajes enviados" value={`${metrics.sent}/${metrics.audience}`} note={`${metrics.audience ? Math.round((metrics.sent / metrics.audience) * 100) : 0}% de la audiencia`} />
        <TopMetric label="Asientos confirmados" value={`${metrics.bookedSeats}/${campaign.capacity}`} note={`${fill}% de capacidad`} />
        <TopMetric label="Ingresos reservados" value={mxn(metrics.bookedRevenue)} note={`Anticipos ${mxn(metrics.deposits)}`} money />
        <TopMetric label="Cobrado elegible" value={mxn(metrics.collected)} note={`Fee ${Number(campaign.feePercent)}% · ${mxn(metrics.fee)}`} money />
      </section>
      <div className="capacity-bar"><span style={{ width: `${fill}%` }} /><i style={{ left: `${Math.min(100, (campaign.minimumSeats / campaign.capacity) * 100)}%` }} /></div>

      <div className="workspace-grid">
        <section className="contacts-panel">
          <div className="panel-head">
            <div><p className="eyebrow">Operación WhatsApp</p><h2>Cola de invitados</h2></div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre o teléfono" />
          </div>
          <nav className="tabs">
            {(['pending', 'sent', 'interest', 'booked', 'closed'] as Tab[]).map((item) => (
              <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabel(item)} <span>{statusCounts[item]}</span></button>
            ))}
          </nav>
          {contactError && <p className="contact-error" role="alert">{contactError}</p>}
          <div className="contact-list">
            {visibleContacts.length === 0 ? <div className="empty-row">No hay invitados en esta vista.</div> : visibleContacts.map((contact) => (
              <article className="contact-row" key={contact.id}>
                <div className="contact-person">
                  <div className="avatar">{initials(contact.name)}</div>
                  <div><h3>{contact.name}</h3><p>{formatPhone(contact.whatsapp)} · {segmentLabel(contact.segment)}{contact.visitCount ? ` · ${contact.visitCount} visitas` : ''}</p></div>
                </div>
                <div className="contact-state"><span>{contactStatus(contact.status)}</span>{contact.sentAt && <small>{shortDate(contact.sentAt)}</small>}</div>
                <div className="contact-actions">
                  {['queued', 'opened'].includes(contact.status) && (
                    <>
                      <button disabled={busyId === contact.id || !['ready', 'active'].includes(campaign.status)} className="wa" onClick={() => openWhatsApp(contact)}>Abrir WhatsApp</button>
                      {contact.status === 'opened' && <button disabled={busyId === contact.id} onClick={() => patchContact(contact.id, 'sent', contact.notes)}>Confirmar enviado</button>}
                    </>
                  )}
                  {contact.status === 'sent' && <button disabled={busyId === contact.id} onClick={() => patchContact(contact.id, 'replied', contact.notes)}>Respondió</button>}
                  {['sent', 'replied'].includes(contact.status) && <button disabled={busyId === contact.id} onClick={() => patchContact(contact.id, 'interested', contact.notes)}>Interesado</button>}
                  {['replied', 'interested', 'deposit_pending'].includes(contact.status) && <button className="gold" onClick={() => newBooking(contact)}>Registrar reserva</button>}
                  {!['booked', 'declined', 'opted_out'].includes(contact.status) && <button className="quiet" disabled={busyId === contact.id} onClick={() => patchContact(contact.id, 'declined', contact.notes)}>No interesado</button>}
                  {!['booked', 'opted_out'].includes(contact.status) && <button className="quiet" disabled={busyId === contact.id} onClick={() => patchContact(contact.id, 'opted_out', 'Solicitó no recibir más campañas.')}>Baja</button>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="ledger-panel">
          <div className="panel-head ledger-head"><div><p className="eyebrow">Fuente de cobro</p><h2>Reservas</h2></div><button className="add-booking" onClick={() => newBooking()}>+ Manual</button></div>
          <div className="ledger-summary"><span>Reservado <strong>{mxn(metrics.bookedRevenue)}</strong></span><span>Fee <strong>{mxn(metrics.fee)}</strong></span></div>
          <div className="booking-list">
            {bookings.length === 0 ? <div className="empty-row">Aún no hay reservas. No se atribuye ingreso hasta registrarlo aquí.</div> : bookings.map((booking) => (
              <button className="booking-row" onClick={() => editBooking(booking)} key={booking.id}>
                <span className="booking-main"><strong>{booking.clientName}</strong><small>{booking.partySize} personas · {bookingStatus(booking.status)}</small></span>
                <span className="booking-money"><strong>{mxn(Number(booking.bookedAmount))}</strong><small>Cobrado elegible {mxn(Number(booking.eligibleRevenue))}</small></span>
              </button>
            ))}
          </div>
          <div className="attribution-note"><strong>Regla:</strong> se vende sobre ingreso reservado, pero el fee se calcula únicamente sobre ingreso atribuible cobrado, después de reembolsos, IVA, servicio y propina.</div>
        </aside>
      </div>

      {bookingOpen && (
        <div className="modal-backdrop" onMouseDown={() => setBookingOpen(false)}>
          <form className="booking-modal" onSubmit={saveBooking} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">Conciliación</p><h2>{editingBookingId ? 'Actualizar reserva' : 'Registrar reserva'}</h2></div><button type="button" onClick={() => setBookingOpen(false)}>×</button></header>
            <div className="booking-grid">
              <Field label="Cliente" wide><input required value={bookingForm.clientName} onChange={(event) => setBookingForm({ ...bookingForm, clientName: event.target.value })} /></Field>
              <Field label="WhatsApp"><input value={bookingForm.clientPhone} onChange={(event) => setBookingForm({ ...bookingForm, clientPhone: event.target.value })} /></Field>
              <Field label="Personas"><input required min="1" type="number" value={bookingForm.partySize} onChange={(event) => setBookingForm({ ...bookingForm, partySize: event.target.value })} /></Field>
              <Field label="Estado"><select value={bookingForm.status} onChange={(event) => setBookingForm({ ...bookingForm, status: event.target.value })}><option value="inquiry">Consulta</option><option value="quoted">Cotizado</option><option value="deposit_pending">Anticipo pendiente</option><option value="booked">Reservado</option><option value="attended">Asistió</option><option value="cancelled">Cancelado</option><option value="refunded">Reembolsado</option></select></Field>
              <Field label="Atribución"><select value={bookingForm.attributionSource} onChange={(event) => setBookingForm({ ...bookingForm, attributionSource: event.target.value })}><option value="direct">Directa</option><option value="matched">Teléfono coincidente</option><option value="assisted">Asistida</option><option value="organic">Orgánica · sin fee</option></select></Field>
              <MoneyField label="Ingreso reservado" value={bookingForm.bookedAmount} onChange={(value) => setBookingForm({ ...bookingForm, bookedAmount: value })} />
              <MoneyField label="Anticipo recibido" value={bookingForm.depositAmount} onChange={(value) => setBookingForm({ ...bookingForm, depositAmount: value })} />
              <MoneyField label="Total cobrado" value={bookingForm.collectedAmount} onChange={(value) => setBookingForm({ ...bookingForm, collectedAmount: value })} />
              <MoneyField label="Reembolsos" value={bookingForm.refundedAmount} onChange={(value) => setBookingForm({ ...bookingForm, refundedAmount: value })} />
              <MoneyField label="IVA incluido" value={bookingForm.ivaAmount} onChange={(value) => setBookingForm({ ...bookingForm, ivaAmount: value })} />
              <MoneyField label="Servicio incluido" value={bookingForm.serviceChargeAmount} onChange={(value) => setBookingForm({ ...bookingForm, serviceChargeAmount: value })} />
              <MoneyField label="Propina incluida" value={bookingForm.gratuityAmount} onChange={(value) => setBookingForm({ ...bookingForm, gratuityAmount: value })} />
              <Field label="Evidencia de atribución" wide><textarea rows={3} value={bookingForm.attributionEvidence} onChange={(event) => setBookingForm({ ...bookingForm, attributionEvidence: event.target.value })} /></Field>
            </div>
            {bookingError && <p className="error">{bookingError}</p>}
            <button className="save-booking" disabled={busyId === -2}>{busyId === -2 ? 'Guardando…' : 'Guardar y recalcular fee'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function CampaignActions({ campaign, busy, onStatus }: { campaign: Campaign; busy: boolean; onStatus: (status: string) => void }) {
  const actions: Record<string, { status: string; label: string }[]> = {
    draft: [{ status: 'ready', label: 'Marcar lista' }], ready: [{ status: 'active', label: 'Activar campaña' }], active: [{ status: 'paused', label: 'Pausar' }, { status: 'completed', label: 'Cerrar campaña' }], paused: [{ status: 'active', label: 'Reanudar' }, { status: 'completed', label: 'Cerrar campaña' }],
  };
  return <div className="campaign-actions">{(actions[campaign.status] ?? []).map((action) => <button disabled={busy} key={action.status} onClick={() => onStatus(action.status)}>{action.label}</button>)}</div>;
}

function TopMetric({ label, value, note, money }: { label: string; value: string; note: string; money?: boolean }) { return <div><span>{label}</span><strong className={money ? 'metric-money' : ''}>{value}</strong><small>{note}</small></div>; }
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={wide ? 'booking-field wide' : 'booking-field'}><span>{label}</span>{children}</label>; }
function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <Field label={label}><div className="money-input"><span>$</span><input min="0" step="0.01" type="number" value={value} onChange={(event) => onChange(event.target.value)} /></div></Field>; }

function renderMessage(campaign: Campaign, contact: Contact) { return campaign.messageText.replaceAll('{nombre}', contact.name).replaceAll('{evento}', campaign.name).replaceAll('{fecha}', formatDate(campaign.eventDate)).replaceAll('{precio}', mxn(Number(campaign.pricePerPerson))); }
function serializeCampaign(value: Campaign) { return { ...value, audienceSeededAt: value.audienceSeededAt ? new Date(value.audienceSeededAt).toISOString() : null, launchedAt: value.launchedAt ? new Date(value.launchedAt).toISOString() : null, completedAt: value.completedAt ? new Date(value.completedAt).toISOString() : null, createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString() }; }
function serializeContact(value: Contact) { return { ...value, openedAt: value.openedAt ? new Date(value.openedAt).toISOString() : null, sentAt: value.sentAt ? new Date(value.sentAt).toISOString() : null, repliedAt: value.repliedAt ? new Date(value.repliedAt).toISOString() : null, optedOutAt: value.optedOutAt ? new Date(value.optedOutAt).toISOString() : null }; }
function serializeBooking(value: Booking) { return { ...value, depositReceivedAt: value.depositReceivedAt ? new Date(value.depositReceivedAt).toISOString() : null, bookedAt: value.bookedAt ? new Date(value.bookedAt).toISOString() : null, attendedAt: value.attendedAt ? new Date(value.attendedAt).toISOString() : null, cancelledAt: value.cancelledAt ? new Date(value.cancelledAt).toISOString() : null, createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString() }; }
function mxn(value: number) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value); }
function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function shortDate(value: string) { return new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); }
function formatPhone(value: string) { const digits = value.replace(/\D/g, ''); return digits.startsWith('52') && digits.length === 12 ? `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` : `+${digits}`; }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function campaignStatus(value: string) { return ({ draft: 'Borrador', ready: 'Lista', active: 'Activa', paused: 'Pausada', completed: 'Cerrada', cancelled: 'Cancelada' } as Record<string, string>)[value] ?? value; }
function contactStatus(value: string) { return ({ queued: 'Pendiente', opened: 'WhatsApp abierto', sent: 'Enviado confirmado', replied: 'Respondió', interested: 'Interesado', deposit_pending: 'Anticipo pendiente', booked: 'Reservado', declined: 'No interesado', opted_out: 'Baja' } as Record<string, string>)[value] ?? value; }
function bookingStatus(value: string) { return ({ inquiry: 'Consulta', quoted: 'Cotizado', deposit_pending: 'Anticipo pendiente', booked: 'Reservado', attended: 'Asistió', cancelled: 'Cancelado', refunded: 'Reembolsado' } as Record<string, string>)[value] ?? value; }
function segmentLabel(value: string) { return ({ wine_redeemer: 'Copa de vino', wine_preference: 'Prefiere vino', vip: 'VIP', general: 'Club VIP' } as Record<string, string>)[value] ?? value; }
function tabLabel(value: Tab) { return ({ pending: 'Pendientes', sent: 'Enviados', interest: 'Interés', booked: 'Reservados', closed: 'Cerrados' } as Record<Tab, string>)[value]; }

const CSS = `
.workspace{max-width:1440px;margin:0 auto;padding:1.5rem 2rem 5rem}.back{display:inline-block;margin-bottom:1rem;color:var(--text-muted);font-size:.72rem;font-weight:700;text-decoration:none;text-transform:uppercase;letter-spacing:.08em}.workspace-head{display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border-dark)}.workspace-head h1{font-size:clamp(2.5rem,5vw,4.8rem);line-height:.95;margin:.5rem 0}.workspace-head p{margin:0;color:var(--text-muted)}.workspace-labels{display:flex;gap:.7rem;align-items:center;color:var(--text-muted);font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.state{padding:.2rem .5rem;border:1px solid currentColor}.state-ready,.state-active{color:var(--green)}.state-paused{color:var(--gold)}.state-completed{color:var(--blue)}.campaign-actions{display:flex;gap:.5rem}.campaign-actions button,.add-booking,.save-booking{border:1px solid var(--text-main);background:var(--text-main);color:white;padding:.75rem 1rem;font-size:.67rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}.readiness-banner,.consent-banner{padding:.8rem 1rem;border:1px solid var(--gold);border-top:0;background:var(--gold-light);color:#775c17;font-size:.8rem}.consent-banner{border-color:var(--green);background:var(--green-light);color:var(--green)}.money-strip{display:grid;grid-template-columns:1fr 1fr 1fr 1.25fr 1.25fr;border:1px solid var(--border-dark);border-top:0}.money-strip>div{padding:1rem;border-right:1px solid var(--panel-border)}.money-strip>div:last-child{border-right:0}.money-strip span{display:block;color:var(--text-muted);font-size:.58rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.money-strip strong{display:block;margin:.35rem 0;font:600 1.6rem var(--font-serif)}.money-strip .metric-money{font:600 1.05rem var(--font-mono)}.money-strip small{color:var(--text-dim);font-size:.65rem}.capacity-bar{position:relative;height:8px;background:#e6e1d8;border:1px solid var(--border-dark);border-top:0}.capacity-bar span{display:block;height:100%;background:var(--gold)}.capacity-bar i{position:absolute;top:-4px;width:2px;height:14px;background:var(--red)}.workspace-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(330px,.85fr);gap:1.25rem;margin-top:1.5rem}.contacts-panel,.ledger-panel{background:var(--panel-bg);border:1px solid var(--border-dark)}.panel-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;padding:1.25rem;border-bottom:1px solid var(--panel-border)}.panel-head h2{margin:0;font-size:1.75rem}.eyebrow{margin:0 0 .3rem;color:var(--gold);font-size:.6rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.panel-head input{width:240px;padding:.6rem;border:1px solid var(--panel-border);background:var(--bg-base)}.tabs{display:flex;overflow:auto;border-bottom:1px solid var(--panel-border)}.tabs button{border:0;border-right:1px solid var(--panel-border);background:transparent;padding:.65rem .8rem;color:var(--text-muted);font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;white-space:nowrap}.tabs button.active{background:var(--text-main);color:white}.tabs span{font-family:var(--font-mono);margin-left:.3rem}.contact-list{max-height:690px;overflow:auto}.contact-row{display:grid;grid-template-columns:minmax(220px,1fr) 130px minmax(260px,1fr);align-items:center;gap:1rem;padding:.9rem 1rem;border-bottom:1px solid var(--panel-border)}.contact-person{display:flex;gap:.75rem;align-items:center}.avatar{width:38px;height:38px;display:grid;place-items:center;flex:none;background:var(--text-main);color:white;font:700 .72rem var(--font-mono)}.contact-row h3{margin:0;font-size:1rem;font-family:var(--font-sans)}.contact-row p{margin:.2rem 0 0;color:var(--text-muted);font-size:.72rem}.contact-state span{display:block;font-size:.64rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.contact-state small{color:var(--text-dim)}.contact-actions{display:flex;justify-content:flex-end;gap:.35rem;flex-wrap:wrap}.contact-actions button{border:1px solid var(--panel-border);background:white;padding:.45rem .55rem;font-size:.6rem;font-weight:800;text-transform:uppercase;cursor:pointer}.contact-actions .wa{background:#178b51;border-color:#178b51;color:white}.contact-actions .gold{background:var(--gold);border-color:var(--gold);color:white}.contact-actions .quiet{color:var(--text-dim);background:transparent}.contact-actions button:disabled{opacity:.35;cursor:not-allowed}.empty-row{padding:2rem;color:var(--text-muted);font-size:.8rem;text-align:center}.ledger-head{align-items:center}.ledger-summary{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--panel-border)}.ledger-summary span{padding:.8rem;color:var(--text-muted);font-size:.62rem;text-transform:uppercase}.ledger-summary span+span{border-left:1px solid var(--panel-border)}.ledger-summary strong{display:block;color:var(--text-main);font:700 .85rem var(--font-mono);margin-top:.25rem}.booking-list{max-height:520px;overflow:auto}.booking-row{width:100%;display:flex;justify-content:space-between;gap:1rem;text-align:left;padding:.85rem 1rem;border:0;border-bottom:1px solid var(--panel-border);background:transparent;cursor:pointer}.booking-row:hover{background:var(--bg-base)}.booking-main,.booking-money{display:grid;gap:.2rem}.booking-money{text-align:right}.booking-row strong{font-size:.8rem}.booking-row small{color:var(--text-muted);font-size:.65rem}.booking-money strong{font-family:var(--font-mono)}.attribution-note{margin:1rem;padding:.8rem;border-left:3px solid var(--gold);background:var(--gold-light);font-size:.72rem;color:#6d5416}.modal-backdrop{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:1rem;background:rgba(20,20,20,.74);backdrop-filter:blur(4px)}.booking-modal{width:min(720px,100%);max-height:94vh;overflow:auto;padding:1.4rem;background:var(--panel-bg);border:2px solid var(--text-main);box-shadow:12px 12px 0 rgba(0,0,0,.3)}.booking-modal header{display:flex;justify-content:space-between;margin-bottom:1rem}.booking-modal h2{margin:0;font-size:2rem}.booking-modal header button{border:0;background:none;font-size:2rem;cursor:pointer}.booking-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.booking-field{display:grid;gap:.35rem}.booking-field.wide{grid-column:1/-1}.booking-field>span{font-size:.6rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}.booking-field input,.booking-field select,.booking-field textarea{width:100%;border:1px solid var(--panel-border);background:var(--bg-base);padding:.65rem}.money-input{display:flex;border:1px solid var(--panel-border);background:var(--bg-base)}.money-input>span{padding:.65rem;color:var(--text-muted)}.money-input input{border:0;padding-left:0}.save-booking{width:100%;margin-top:1rem}.error{color:var(--red);font-weight:700}@media(max-width:1100px){.workspace-grid{grid-template-columns:1fr}.contact-list{max-height:none}.money-strip{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.workspace{padding:1rem}.workspace-head{align-items:flex-start;flex-direction:column}.workspace-head h1{font-size:3rem}.money-strip{grid-template-columns:1fr 1fr}.contact-row{grid-template-columns:1fr}.contact-state{padding-left:50px}.contact-actions{justify-content:flex-start;padding-left:50px}.panel-head{align-items:flex-start;flex-direction:column}.panel-head input{width:100%}.booking-grid{grid-template-columns:1fr}.booking-field.wide{grid-column:auto}}
`;
