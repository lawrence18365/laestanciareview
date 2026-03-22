import { NextRequest } from 'next/server';
import { sendSMSAlert } from '@/lib/sms';

/**
 * Telnyx inbound message webhook — forwards incoming SMS to owner phone.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const event = body?.data;

  if (event?.event_type === 'message.received') {
    const payload = event.payload;
    const text = payload?.text ?? '';
    const from = payload?.from?.phone_number ?? 'unknown';

    console.log('[telnyx-inbound]', from, text);

    // Forward to owner's personal number
    try {
      await sendSMSAlert({
        to: '+12369711199',
        restaurantName: 'RateTap System',
        customerName: `From: ${from}`,
        rating: 5,
        staffName: null,
        feedback: text,
      });
    } catch (err) {
      console.error('[telnyx-forward] Failed:', err);
    }
  }

  return Response.json({ ok: true });
}

/** Allow GET for webhook verification */
export async function GET() {
  return Response.json({ ok: true });
}
