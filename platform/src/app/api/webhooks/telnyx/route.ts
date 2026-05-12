import { NextRequest } from 'next/server';
import { markProspectDelivery, markProspectReplied } from '@/lib/outreach-tracking';

/**
 * Telnyx inbound message webhook — stores messages for retrieval.
 */

// In-memory store (survives within a single invocation only, but
// the GET endpoint below can read the latest message if hit fast enough)
let lastMessage = { from: '', text: '', ts: '' };

export async function POST(req: NextRequest) {
  const body = await req.json();
  const event = body?.data;
  const eventType = event?.event_type;
  const payload = event?.payload;
  const providerMessageId = typeof payload?.id === 'string' ? payload.id : null;

  if (eventType === 'message.received') {
    const text = payload?.text ?? '';
    const from = payload?.from?.phone_number ?? 'unknown';

    lastMessage = { from, text, ts: new Date().toISOString() };

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

/** GET endpoint to check last received message */
export async function GET() {
  return Response.json(lastMessage);
}
