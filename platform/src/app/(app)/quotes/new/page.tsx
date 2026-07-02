import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { restaurants, eventLeads } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getBrandForSlug } from '@/lib/brands';
import { isAdminEmail } from '@/lib/admin';
import QuoteBuilderV2 from '@/components/quotes/QuoteBuilderV2';
import { emptyConfig, type QuoteConfig } from '@/lib/quote-data';

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, managerEmail: restaurants.managerEmail })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  const brand = getBrandForSlug(session.slug);

  // Prefill from an event lead when arriving via /quotes/new?leadId=… .
  // Tenant-scoped so a foreign lead id can't leak another restaurant's data;
  // an unknown/foreign id simply falls through to a blank quote.
  let initialConfig: QuoteConfig | undefined;
  let leadId: number | undefined;
  const { leadId: leadIdRaw } = await searchParams;
  const parsedLeadId = leadIdRaw ? parseInt(leadIdRaw, 10) : NaN;
  if (restaurant && !isNaN(parsedLeadId)) {
    const [lead] = await db
      .select()
      .from(eventLeads)
      .where(and(eq(eventLeads.id, parsedLeadId), eq(eventLeads.restaurantId, restaurant.id)))
      .limit(1);
    if (lead) {
      leadId = lead.id;
      const c = emptyConfig();
      c.evento = {
        ...c.evento,
        cliente: lead.name ?? '',
        telefono: lead.phone,
        tipo: lead.tipoEvento || c.evento.tipo,
        personas: lead.pax ?? c.evento.personas,
      };
      // fechaTentativa is free-typed ("15 jun", "todavía no sé"), not a valid
      // date-input value, so it is intentionally not forced into evento.fecha.
      initialConfig = c;
    }
  }

  return (
    <QuoteBuilderV2
      initialConfig={initialConfig}
      leadId={leadId}
      restaurantName={restaurant?.name ?? 'La Estancia'}
      logoSrc={brand.logo}
      isAdmin={isAdminEmail(restaurant?.managerEmail)}
    />
  );
}
