import { desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { commercialEvents, commercialLeads } from '@/db/schema';
import { verifySession } from '@/lib/session';
import type { CommercialLeadStatus } from '@/lib/commercial-statuses';
import CommercialLeadsTable from './CommercialLeadsTable';
import type { CommercialLeadRow } from './CommercialLeadsTable';

export const dynamic = 'force-dynamic';

function formatDate(date: Date | string | null) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

function toIso(date: Date | string | null) {
  return date ? new Date(date).toISOString() : null;
}

export default async function CommercialLeadsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'owner') redirect('/overview');

  const leads = await db
    .select()
    .from(commercialLeads)
    .orderBy(desc(commercialLeads.createdAt))
    .limit(150);

  const events = await db
    .select()
    .from(commercialEvents)
    .orderBy(desc(commercialEvents.createdAt))
    .limit(500);

  const lastEventByLead = new Map<number, typeof events[number]>();
  for (const event of events) {
    if (!event.leadId || lastEventByLead.has(event.leadId)) continue;
    lastEventByLead.set(event.leadId, event);
  }

  const leadRows: CommercialLeadRow[] = leads.map((lead) => {
    const lastEvent = lastEventByLead.get(lead.id);
    return {
      id: lead.id,
      name: lead.name,
      businessName: lead.businessName,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      source: lead.source,
      offer: lead.offer,
      status: lead.status as CommercialLeadStatus,
      nextAction: lead.nextAction,
      nextActionAt: toIso(lead.nextActionAt),
      contactedAt: toIso(lead.contactedAt),
      notes: lead.notes,
      lostReason: lead.lostReason,
      landingPath: lead.landingPath,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
      createdAt: new Date(lead.createdAt).toISOString(),
      updatedAt: new Date(lead.updatedAt).toISOString(),
      lastEventName: lastEvent?.eventName ?? null,
      lastEventAt: toIso(lastEvent?.createdAt ?? null),
    };
  }).sort((a, b) => {
    const aDue = a.nextActionAt ? new Date(a.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.nextActionAt ? new Date(b.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
    const aOpen = ['won', 'lost', 'bad_fit', 'duplicate'].includes(a.status) ? 1 : 0;
    const bOpen = ['won', 'lost', 'bad_fit', 'duplicate'].includes(b.status) ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const recentEvents = events.slice(0, 80);

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1.5rem' }}>
      <header>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase' }}>
          Commercial truth
        </p>
        <h1 style={{ margin: '0.35rem 0 0', fontSize: '1.8rem' }}>First-party leads</h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 760 }}>
          Acquisition leads and server-side commercial events. This is the sales source of truth, separate from restaurant guest and event leads.
        </p>
      </header>

      <CommercialLeadsTable initialLeads={leadRows} />

      <section style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'white', padding: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Recent commercial events</h2>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {recentEvents.map((event) => (
            <div key={event.id} style={{ display: 'grid', gridTemplateColumns: '180px 220px 1fr', gap: '1rem', padding: '0.65rem 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{formatDate(event.createdAt)}</span>
              <strong>{event.eventName}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                {event.leadId ? `lead #${event.leadId}` : 'no lead'}{event.restaurantId ? ` · restaurant #${event.restaurantId}` : ''}{event.path ? ` · ${event.path}` : ''}
              </span>
            </div>
          ))}
          {recentEvents.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No commercial events recorded yet.</p>}
        </div>
      </section>
    </main>
  );
}
