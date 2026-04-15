const PIXEL_ID = (process.env.META_PIXEL_ID ?? '').trim();
const ACCESS_TOKEN = (process.env.META_CAPI_ACCESS_TOKEN ?? '').trim();
const TEST_EVENT_CODE = (process.env.META_CAPI_TEST_EVENT_CODE ?? '').trim();

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PurchaseEventParams {
  email: string;
  phone?: string;
  valueMxn: number;
  eventId: string;
  eventTimeUnix?: number;
}

export async function sendPurchaseEvent(params: PurchaseEventParams): Promise<void> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[meta-capi] META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set — skipping');
    return;
  }

  const digitsOnly = params.phone ? params.phone.replace(/\D/g, '') : undefined;
  const userData: Record<string, string> = {
    em: await sha256Hex(params.email),
  };
  if (digitsOnly) userData.ph = await sha256Hex(digitsOnly);

  const body = {
    data: [
      {
        event_name: 'Purchase',
        event_time: params.eventTimeUnix ?? Math.floor(Date.now() / 1000),
        event_id: params.eventId,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          currency: 'MXN',
          value: params.valueMxn,
        },
      },
    ],
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
  };

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[meta-capi] Purchase event failed ${res.status}: ${text}`);
  }
}
