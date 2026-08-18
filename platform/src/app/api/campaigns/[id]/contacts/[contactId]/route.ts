import { NextRequest } from 'next/server';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { db } from '@/db';
import { campaignContacts, eventCampaigns, guests } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import {
  campaignContactPatchSchema,
  contactTimestamps,
  decideContactTransition,
  type ContactStatus,
} from '@/lib/event-campaigns';

export const runtime = 'nodejs';

const SOURCE = 'PATCH /api/campaigns/[id]/contacts/[contactId]';
const CONTACT_SELECT = {
  contact: getTableColumns(campaignContacts),
  marketingConsent: guests.marketingConsent,
  guestStatus: guests.status,
  campaignStatus: eventCampaigns.status,
};

async function findContact(campaignId: number, contactId: number, restaurantId: number) {
  const [contact] = await db
    .select(CONTACT_SELECT)
    .from(campaignContacts)
    .innerJoin(eventCampaigns, eq(eventCampaigns.id, campaignContacts.campaignId))
    .innerJoin(guests, eq(guests.id, campaignContacts.guestId))
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
        eq(campaignContacts.restaurantId, restaurantId),
        eq(eventCampaigns.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  return contact;
}

function canOpenWhatsApp(contact: {
  contact: { status: string };
  marketingConsent: boolean;
  guestStatus: string;
  campaignStatus: string;
}) {
  return (
    ['queued', 'opened'].includes(contact.contact.status) &&
    contact.marketingConsent &&
    contact.guestStatus === 'validated' &&
    ['ready', 'active'].includes(contact.campaignStatus)
  );
}

function logTransition({
  campaignId,
  contactId,
  requestedStatus,
  currentStatus,
  expectedStatus,
  result,
  requestId,
}: {
  campaignId: number;
  contactId: number;
  requestedStatus: string;
  currentStatus: string | null;
  expectedStatus: string;
  result: string;
  requestId: string | null;
}) {
  console.warn(JSON.stringify({
    campaignId,
    contactId,
    requestedStatus,
    currentStatus,
    expectedStatus,
    result,
    requestId,
    timestamp: new Date().toISOString(),
    source: SOURCE,
  }));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) {
    return Response.json(
      { code: 'INVALID_ORIGIN', message: 'La solicitud no es válida para este sitio.' },
      { status: csrf.status },
    );
  }
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json(
      { code: 'UNAUTHORIZED', message: 'No tienes autorización para realizar esta acción.' },
      { status: 401 },
    );
  }
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'No se encontró el restaurante.' },
      { status: 404 },
    );
  }

  const routeParams = await params;
  const campaignId = Number(routeParams.id);
  const contactId = Number(routeParams.contactId);
  if (![campaignId, contactId].every((value) => Number.isInteger(value) && value > 0)) {
    return Response.json(
      { code: 'INVALID_ID', message: 'El identificador del contacto no es válido.' },
      { status: 400 },
    );
  }

  const parsed = campaignContactPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { code: 'VALIDATION_ERROR', message: 'Los datos del contacto no son válidos.' },
      { status: 400 },
    );
  }

  const requestId = req.headers.get('x-vercel-id') ?? req.headers.get('x-request-id') ?? null;
  const loaded = await findContact(campaignId, contactId, restaurant.id);
  if (!loaded) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'No se encontró el contacto de la campaña.' },
      { status: 404 },
    );
  }

  const currentStatus = loaded.contact.status as ContactStatus;
  const requestedStatus = parsed.data.status;
  const decision = decideContactTransition({ currentStatus, requestedStatus });
  const logResult = (result: string, canonicalStatus = currentStatus) => logTransition({
    campaignId,
    contactId,
    requestedStatus,
    currentStatus: canonicalStatus,
    expectedStatus: currentStatus,
    result,
    requestId,
  });

  if (decision.kind === 'blocked') {
    const code = decision.reason === 'opted_out' ? 'OPTED_OUT' : 'DECLINED';
    logResult(code);
    return Response.json(
      {
        contact: loaded.contact,
        code,
        canOpenWhatsApp: false,
        message: decision.reason === 'opted_out'
          ? 'Este invitado se dio de baja y no puede recibir mensajes.'
          : 'Este invitado está marcado como no interesado y no puede recibir mensajes.',
      },
      { status: 409 },
    );
  }

  if (decision.kind === 'stale') {
    logResult('STALE_CONTACT_STATE');
    return Response.json(
      {
        contact: loaded.contact,
        code: 'STALE_CONTACT_STATE',
        canOpenWhatsApp: false,
        message: 'El estado de este invitado cambió. Revisa la fila actualizada antes de continuar.',
      },
      { status: 409 },
    );
  }

  if (decision.kind === 'invalid') {
    logResult(decision.code);
    return Response.json(
      {
        contact: loaded.contact,
        code: decision.code,
        message: 'No se puede realizar ese cambio desde el estado actual del invitado.',
      },
      { status: 409 },
    );
  }

  if (decision.kind === 'noop') {
    return Response.json({
      contact: loaded.contact,
      code: 'NOOP',
      canOpenWhatsApp: canOpenWhatsApp(loaded),
    });
  }

  const outboundStatuses: ContactStatus[] = ['opened', 'sent'];
  if (
    outboundStatuses.includes(requestedStatus) &&
    (!loaded.marketingConsent || loaded.guestStatus !== 'validated')
  ) {
    logResult('NOT_CONTACTABLE');
    return Response.json(
      {
        contact: loaded.contact,
        code: 'NOT_CONTACTABLE',
        canOpenWhatsApp: false,
        message: 'Este invitado no tiene consentimiento activo o no está validado para recibir mensajes.',
      },
      { status: 409 },
    );
  }
  if (
    outboundStatuses.includes(requestedStatus) &&
    !['ready', 'active'].includes(loaded.campaignStatus)
  ) {
    logResult('CAMPAIGN_NOT_OPERABLE');
    return Response.json(
      {
        contact: loaded.contact,
        code: 'CAMPAIGN_NOT_OPERABLE',
        canOpenWhatsApp: false,
        message: 'La campaña debe estar lista o activa antes de operar WhatsApp.',
      },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(campaignContacts)
    .set({
      status: decision.to,
      notes: parsed.data.notes,
      ...contactTimestamps(decision.to),
    })
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
        eq(campaignContacts.restaurantId, restaurant.id),
        eq(campaignContacts.status, currentStatus),
      ),
    )
    .returning();

  if (!updated) {
    const canonical = await findContact(campaignId, contactId, restaurant.id);
    if (!canonical) {
      logTransition({
        campaignId,
        contactId,
        requestedStatus,
        currentStatus: null,
        expectedStatus: currentStatus,
        result: 'NOT_FOUND',
        requestId,
      });
      return Response.json(
        { code: 'NOT_FOUND', message: 'El contacto ya no está disponible.' },
        { status: 404 },
      );
    }

    if (canonical.contact.status === requestedStatus) {
      logResult('NOOP', canonical.contact.status as ContactStatus);
      return Response.json({
        contact: canonical.contact,
        code: 'NOOP',
        canOpenWhatsApp: canOpenWhatsApp(canonical),
      });
    }

    logResult('STALE_CONTACT_STATE', canonical.contact.status as ContactStatus);
    return Response.json(
      {
        contact: canonical.contact,
        code: 'STALE_CONTACT_STATE',
        canOpenWhatsApp: false,
        message: 'El estado de este invitado cambió. Revisa la fila actualizada antes de continuar.',
      },
      { status: 409 },
    );
  }

  if (decision.to === 'opted_out') {
    await db
      .update(guests)
      .set({ marketingConsent: false })
      .where(eq(guests.id, loaded.contact.guestId));
  }

  return Response.json({
    contact: updated,
    code: 'OK',
    canOpenWhatsApp: decision.to === 'opened',
  });
}
