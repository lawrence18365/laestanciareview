import { NextRequest } from 'next/server';

/**
 * Telnyx inbound message webhook — stores messages for retrieval.
 */

// In-memory store (survives within a single invocation only, but
// the GET endpoint below can read the latest message if hit fast enough)
let lastMessage = { from: '', text: '', ts: '' };

export async function POST(req: NextRequest) {
  const body = await req.json();
  const event = body?.data;

  if (event?.event_type === 'message.received') {
    const payload = event.payload;
    const text = payload?.text ?? '';
    const from = payload?.from?.phone_number ?? 'unknown';

    lastMessage = { from, text, ts: new Date().toISOString() };

    // Log each word separately to avoid Vercel log truncation
    console.log('[telnyx-from]', from);
    console.log('[telnyx-text]', text);
  }

  return Response.json({ ok: true });
}

/** GET endpoint to check last received message */
export async function GET() {
  return Response.json(lastMessage);
}
