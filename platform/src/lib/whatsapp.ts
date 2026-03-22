/**
 * WhatsApp alert integration via CallMeBot (free, no business docs needed).
 *
 * Setup per manager:
 *   1. Add +34 644 20 47 56 to phone contacts
 *   2. Send "I allow callmebot to send me messages" via WhatsApp
 *   3. Receive API key, store it in restaurant settings (callmebotApiKey)
 *
 * Also supports Meta Cloud API as a fallback if configured.
 */

// ── CallMeBot (primary — free, no verification) ─────────────────────

interface WhatsAppAlertParams {
  to: string;
  apiKey: string;
  restaurantName: string;
  customerName: string | null;
  rating: number;
  staffName: string | null;
  feedback: string;
}

export async function sendWhatsAppAlert({
  to,
  apiKey,
  restaurantName,
  customerName,
  rating,
  staffName,
  feedback,
}: WhatsAppAlertParams) {
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

  const message = lines.join('\n');

  // Normalize phone: ensure + prefix
  let phone = to.trim();
  if (!phone.startsWith('+')) phone = `+${phone}`;
  // Strip old Mexican mobile "1" prefix: +521XXXXXXXXXX → +52XXXXXXXXXX
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) {
    phone = '+52' + digits.slice(3);
  }

  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('text', message);
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CallMeBot error ${res.status}: ${body}`);
  }
}
