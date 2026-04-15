import Telnyx from 'telnyx';

let _client: Telnyx | null = null;

function getClient(): Telnyx | null {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Telnyx({ apiKey: key.trim() });
  return _client;
}

const MESSAGING_PROFILE_ID = (process.env.TELNYX_MESSAGING_PROFILE_ID ?? '').trim();
const SENDER_ID = 'RateTap';

/**
 * Normalize a phone number to E.164 format.
 * If a 10-digit Mexican number is provided without country code, prepend +52.
 */
function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip old Mexican mobile "1" prefix: +521XXXXXXXXXX → +52XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  if (phone.startsWith('+') && digits.length === 12 && digits.startsWith('52')) {
    return `+${digits}`;
  }
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

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetap.com').replace(/\\n/g, '').trim();
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

interface TrialEndingSmsParams {
  to: string;
  restaurantName: string;
  daysLeft: number;
  amountMxn: number;
  paymentUrl: string;
}

export async function sendTrialEndingSms({
  to,
  restaurantName,
  daysLeft,
  amountMxn,
  paymentUrl,
}: TrialEndingSmsParams) {
  const client = getClient();
  if (!client) {
    console.warn('[sms] Telnyx not configured — skipping trial-ending SMS');
    return;
  }

  const amount = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(amountMxn);

  const text =
    `RateTap: ${restaurantName}, tu prueba termina en ${daysLeft} días. ` +
    `Cobraremos ${amount} a tu tarjeta. Administra: ${paymentUrl}`;

  await client.messages.send({
    to: normalizePhone(to),
    from: SENDER_ID,
    text,
    messaging_profile_id: MESSAGING_PROFILE_ID,
  });
}
