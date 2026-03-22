/**
 * WhatsApp Business Cloud API integration for sending alert messages.
 *
 * Required env vars:
 *   WHATSAPP_TOKEN          – Permanent access token from Meta Business
 *   WHATSAPP_PHONE_ID       – Phone number ID (not the phone number itself)
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */

const API_VERSION = 'v21.0';

function getConfig() {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_ID?.trim();
  if (!token || !phoneId) return null;
  return { token, phoneId };
}

/**
 * Normalize a phone number to E.164 (digits only, no +).
 * WhatsApp Cloud API expects the number WITHOUT the leading +.
 */
function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip old Mexican mobile "1" prefix: 521XXXXXXXXXX → 52XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  // 10-digit Mexican number without country code
  if (digits.length === 10) digits = '52' + digits;
  return digits;
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
    console.warn('[whatsapp] Not configured — skipping WhatsApp alert');
    return;
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetap.com')
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

  const normalizedTo = normalizePhone(to);

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${cfg.phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { body: lines.join('\n') },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${body}`);
  }
}
