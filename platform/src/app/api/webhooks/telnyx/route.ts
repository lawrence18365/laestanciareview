import { NextRequest } from 'next/server';
import { markProspectDelivery, markProspectReplied } from '@/lib/outreach-tracking';
import { verifyTelnyxSignature } from '@/lib/webhook-verify';

/**
 * Telnyx inbound message webhook.
 */

export async function POST(req: NextRequest) {
  // Verify Ed25519 signature over the raw body before processing. Fail closed.
  const rawBody = await req.text();
  const valid = await verifyTelnyxSignature(rawBody, req.headers);
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: {
    data?: {
      event_type?: string;
      payload?: {
        id?: string;
        text?: string;
        from?: { phone_number?: string };
        errors?: unknown;
      };
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const event = body?.data;
  const eventType = event?.event_type;
  const payload = event?.payload;
  const providerMessageId = typeof payload?.id === 'string' ? payload.id : null;

  if (eventType === 'message.received') {
    const text = payload?.text ?? '';
    const from = payload?.from?.phone_number ?? 'unknown';

    await markProspectReplied({
      phone: from,
      text,
      provider: 'telnyx',
      providerMessageId,
    });

    // Log each word separately to avoid Vercel log truncation
    console.log('[telnyx-from]', from);
    console.log('[telnyx-text]', text);
  }

  if (providerMessageId && eventType === 'message.delivered') {
    await markProspectDelivery({
      providerMessageId,
      eventName: 'outreach_delivered',
      deliveryStatus: 'delivered',
      provider: 'telnyx',
      payload: { event_type: eventType },
    });
  }

  if (providerMessageId && (eventType === 'message.delivery_failed' || eventType === 'message.failed')) {
    await markProspectDelivery({
      providerMessageId,
      eventName: 'outreach_failed',
      deliveryStatus: 'failed',
      provider: 'telnyx',
      payload: { event_type: eventType },
      error: payload?.errors ? JSON.stringify(payload.errors) : null,
    });
  }

  return Response.json({ ok: true });
}
