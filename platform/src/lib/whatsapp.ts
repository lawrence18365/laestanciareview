/**
 * WhatsApp alerts via Green API (green-api.com).
 *
 * Setup:
 *   1. Sign up at https://console.green-api.com
 *   2. Create an instance → get idInstance + apiTokenInstance
 *   3. Scan QR code with WhatsApp (Settings > Linked Devices)
 *   4. Set GREENAPI_ID_INSTANCE and GREENAPI_API_TOKEN in env
 *
 * Cost: $12/mo Business plan (unlimited chats & messages)
 * Docs: https://green-api.com/en/docs/api/sending/SendMessage/
 */

function getConfig() {
  const idInstance = process.env.GREENAPI_ID_INSTANCE?.trim();
  const apiToken = process.env.GREENAPI_API_TOKEN?.trim();
  if (!idInstance || !apiToken) return null;
  return { idInstance, apiToken };
}

/**
 * Format phone number as Green API chatId.
 * Format: countrycode + number + @c.us (e.g. "5215551234567@c.us")
 */
function toChatId(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip old Mexican mobile "1" prefix: 521XXXXXXXXXX → 52XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  // 10-digit Mexican number without country code
  if (digits.length === 10) digits = '52' + digits;
  return `${digits}@c.us`;
}

interface WhatsAppAlertParams {
  to: string;
  restaurantName: string;
  customerName: string | null;
  rating: number;
  staffName: string | null;
  feedback: string;
}

export async function sendWhatsAppAlert({
  to,
  restaurantName,
  customerName,
  rating,
  staffName,
  feedback,
}: WhatsAppAlertParams) {
  const cfg = getConfig();
  if (!cfg) {
    console.warn('[whatsapp] Green API not configured — skipping');
    return;
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim();

  const urgency = rating <= 2 ? '🔴' : rating <= 3 ? '🟡' : '🟢';
  const stars = '⭐'.repeat(rating);
  const customer = customerName || 'Anónimo';
  const preview =
    feedback.length > 200 ? feedback.slice(0, 200) + '...' : feedback;

  const lines = [`${urgency} *${restaurantName}* — ${stars}`];
  if (staffName) lines.push(`*Mesero:* ${staffName}`);
  lines.push(`*Cliente:* ${customer}`);
  lines.push('');
  lines.push(`_"${preview}"_`);
  lines.push('');
  lines.push(`📋 Ver en Inbox: ${baseUrl}/inbox`);

  const chatId = toChatId(to);

  const res = await fetch(
    `https://api.greenapi.com/waInstance${cfg.idInstance}/sendMessage/${cfg.apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        message: lines.join('\n'),
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Green API error ${res.status}: ${body}`);
  }
}
