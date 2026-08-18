/**
 * WhatsApp alerts via Twilio WhatsApp Sandbox.
 *
 * Setup:
 *   1. Go to Twilio Console → Messaging → Try it out → WhatsApp
 *   2. Note the sandbox code (e.g. "join xxx-yyy")
 *   3. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in env
 *   4. Each GM must send "join <code>" to the sandbox number to opt in
 *
 * Docs: https://www.twilio.com/docs/whatsapp/sandbox
 */

function getConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

/**
 * Format phone number to Twilio WhatsApp format.
 * Returns "whatsapp:+521234567890".
 */
function toWhatsAppNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Strip old Mexican mobile "1" prefix: 521XXXXXXXXXX → 52XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  // 10-digit Mexican number without country code
  if (digits.length === 10) digits = '52' + digits;
  return `whatsapp:+${digits}`;
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
    console.warn('[whatsapp] Twilio not configured — skipping');
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

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: toWhatsAppNumber(to),
    From: `whatsapp:${cfg.from}`,
    Body: lines.join('\n'),
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio WhatsApp error ${res.status}: ${text}`);
  }
}

interface WhatsAppWelcomeParams {
  to: string;
  restaurantName: string;
  trialEndsAt: Date;
}

export async function sendWhatsAppWelcome({
  to,
  restaurantName,
  trialEndsAt,
}: WhatsAppWelcomeParams) {
  const cfg = getConfig();
  if (!cfg) {
    console.warn('[whatsapp] Twilio not configured — skipping welcome');
    return;
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');

  const endDate = trialEndsAt.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
  });

  const lines = [
    `🎉 *¡Bienvenido a RateTap, ${restaurantName}!*`,
    '',
    `Tu prueba gratis de 30 días ya está activa (hasta el ${endDate}).`,
    '',
    `📊 Tu panel: ${baseUrl}/dashboard`,
    '',
    '¿Dudas? Responde a este mensaje y te ayudamos.',
  ];

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: toWhatsAppNumber(to),
    From: `whatsapp:${cfg.from}`,
    Body: lines.join('\n'),
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio WhatsApp welcome error ${res.status}: ${text}`);
  }
}
