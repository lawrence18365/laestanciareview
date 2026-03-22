import { NextRequest } from 'next/server';

/**
 * Telnyx inbound message webhook — logs incoming SMS for debugging.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const event = body?.data;

  if (event?.event_type === 'message.received') {
    const payload = event.payload;
    console.log('[telnyx-inbound]', JSON.stringify({
      from: payload?.from?.phone_number,
      to: payload?.to?.[0]?.phone_number,
      text: payload?.text,
      received_at: payload?.received_at,
    }));
  }

  return Response.json({ ok: true });
}
