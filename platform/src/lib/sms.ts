import Telnyx from 'telnyx';

let _client: Telnyx | null = null;

function getClient(): Telnyx | null {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Telnyx({ apiKey: key });
  return _client;
}

const MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID ?? '';
const SENDER_ID = 'RateTap';

/**
 * Normalize a phone number to E.164 format.
 * If a 10-digit Mexican number is provided without country code, prepend +52.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+')) return phone;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  return `+${digits}`;
}

interface SMSAlertParams {
  to: string;
  restaurantName: string;
  customerName: string | null;
  rating: number;
  staffName: string | null;
  feedback: string;
}

export async function sendSMSAlert({
  to,
  restaurantName,
  customerName,
  rating,
  staffName,
  feedback,
}: SMSAlertParams) {
  const client = getClient();
  if (!client) {
    console.warn('[sms] Telnyx not configured — skipping SMS');
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetap.com';
  const urgency = rating <= 2 ? '🔴' : rating <= 3 ? '🟡' : '🟢';
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const customer = customerName || 'Anónimo';
  const preview = feedback.length > 100 ? feedback.slice(0, 100) + '...' : feedback;

  const lines = [
    `${urgency} ${restaurantName} — ${stars}`,
  ];
  if (staffName) lines.push(`Mesero: ${staffName}`);
  lines.push(`Cliente: ${customer}`);
  lines.push('');
  lines.push(`"${preview}"`);
  lines.push('');
  lines.push(`${baseUrl}/inbox`);

  const normalizedTo = normalizePhone(to);

  await client.messages.send({
    to: normalizedTo,
    from: SENDER_ID,
    text: lines.join('\n'),
    messaging_profile_id: MESSAGING_PROFILE_ID,
  });
}
