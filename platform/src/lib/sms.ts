import Telnyx from 'telnyx';

let _client: Telnyx | null = null;

function getClient(): Telnyx | null {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Telnyx({ apiKey: key });
  return _client;
}

const FROM = process.env.TELNYX_PHONE_NUMBER ?? '';

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
  if (!client || !FROM) {
    console.warn('[sms] Telnyx not configured — skipping SMS');
    return;
  }

  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const name = customerName || 'Anonymous';
  const staff = staffName ? ` (staff: ${staffName})` : '';
  const preview = feedback.length > 120 ? feedback.slice(0, 120) + '...' : feedback;

  const text = `[RateTap] ${stars} at ${restaurantName}\n${name}${staff}\n"${preview}"\n\nView: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com'}/inbox`;

  await client.messages.send({ to, from: FROM, text });
}
