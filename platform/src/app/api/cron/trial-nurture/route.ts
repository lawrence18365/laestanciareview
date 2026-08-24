/**
 * Daily cron: send WhatsApp + email nurture messages to trialing restaurants.
 * Day 3 → tips. Day 7 → case study. Founder pilots → ending warning
 * three days before trialEndsAt. Stripe-managed ending warnings come from the
 * customer.subscription.trial_will_end webhook instead.
 *
 * Schedule: every day at noon Mexico City (18:00 UTC)
 * Vercel cron: "0 18 * * *"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants, nurtureEvents } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { FROM, sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = 'https://app.ratetapmx.com';

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

async function sendWhatsApp(to: string, body: string) {
  const cfg = getTwilioConfig();
  if (!cfg) throw new Error('Twilio WhatsApp is not configured');

  let digits = to.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) digits = '52' + digits.slice(3);
  if (digits.length === 10) digits = '52' + digits;

  const params = new URLSearchParams({
    To: `whatsapp:+${digits}`,
    From: `whatsapp:${cfg.from}`,
    Body: body,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error(`Twilio WhatsApp delivery failed with status ${response.status}`);
  }
}

const NURTURE: Record<string, {
  days: number;
  whatsapp: (name: string, pilot: boolean) => string;
  subject: (name: string, pilot: boolean) => string;
  html: (name: string, pilot: boolean) => string;
}> = {
  day3: {
    days: 3,
    whatsapp: (name) =>
      `Hola *${name}* 👋 Llevas 3 días con RateTap. Tip: pídele a tu equipo que entreguen la tarjeta con la frase "Nos encantaría conocer tu opinión, ¿nos ayudas con una reseña? ⭐". Eso duplica la tasa de escaneo. ¿Cómo va hasta ahora?`,
    subject: (name) => `Tip del día 3: ${name}`,
    html: (name) => `<p>Hola ${name},</p><p>Llevas 3 días con RateTap. El truco que mejor funciona: tu mesero entrega la tarjeta y dice "Nos encantaría conocer su opinión, ¿nos ayuda con una reseña en Google? ⭐".</p><p>Eso solo duplica la tasa de escaneo.</p><p><a href="${BASE_URL}/dashboard">Ver mi dashboard →</a></p>`,
  },
  day7: {
    days: 7,
    whatsapp: (name) =>
      `*${name}*, llevas una semana 🎉 La Estancia (12 restaurantes en León) logró subir consistentemente sus calificaciones en todos sus locales con RateTap. Tus reseñas nuevas ya están trabajando para ti. Panel: ${BASE_URL}/dashboard`,
    subject: (name) => `Una semana con RateTap: ${name}`,
    html: (name) => `<p>Hola ${name},</p><p>Llevas 7 días con RateTap. Un cliente nuestro, Grupo La Estancia (12 restaurantes en León), ha visto cómo sus reseñas de Google crecen consistentemente desde que usan el sistema.</p><p>Tus reseñas nuevas ya están llegando.</p><p><a href="${BASE_URL}/dashboard">Ver mi progreso →</a></p>`,
  },
  day12: {
    days: 12,
    whatsapp: (name, pilot) => pilot
      ? `Hola *${name}*, tu piloto fundador termina en 3 días. Si decides continuar, tu plan será de $700 MXN/mes y la cuota de setup de $1,500 MXN se factura al activar. Escríbenos desde tu panel: ${BASE_URL}/dashboard`
      : `Hola *${name}*, tu prueba gratis termina en 3 días. Para seguir recibiendo reseñas de Google sin interrupciones, activa tu plan aquí: ${BASE_URL}/dashboard. $700 MXN/mes, cancela cuando quieras.`,
    subject: (name, pilot) => `${pilot ? 'Tu piloto' : 'Tu prueba'} termina en 3 días, ${name}`,
    html: (name, pilot) => pilot
      ? `<p>Hola ${name},</p><p>Tu piloto fundador de RateTap termina en <strong>3 días</strong>.</p><p>Si decides continuar, el plan cuesta $700 MXN/mes y la cuota de setup de $1,500 MXN se factura al activar.</p><p><a href="${BASE_URL}/dashboard" style="background:#10B981;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;display:inline-block;border-radius:6px">Continuar con RateTap →</a></p><p style="color:#6b7280;font-size:13px">Sin contrato. Cancela cuando quieras.</p>`
      : `<p>Hola ${name},</p><p>Tu prueba gratis de RateTap termina en <strong>3 días</strong>.</p><p>Para que tus reseñas de Google sigan llegando sin interrupciones, activa tu plan ($700 MXN/mes).</p><p><a href="${BASE_URL}/dashboard" style="background:#10B981;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;display:inline-block;border-radius:6px">Activar mi plan →</a></p><p style="color:#6b7280;font-size:13px">Sin contrato. Cancela cuando quieras.</p>`,
  },
};

export async function GET(req: NextRequest) {
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || auth !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const trialing = await db.select().from(restaurants)
    .where(eq(restaurants.subscriptionStatus, 'trialing'));

  let processed = 0;

  for (const r of trialing) {
    if (!r.createdAt) continue;
    const daysSinceSignup = Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000);
    const daysUntilTrialEnd = r.trialEndsAt
      ? Math.ceil((r.trialEndsAt.getTime() - Date.now()) / 86_400_000)
      : null;

    for (const [eventKey, nurture] of Object.entries(NURTURE)) {
      if (eventKey === 'day12' && !r.pilot) continue;
      const eligible = eventKey === 'day12' && daysUntilTrialEnd !== null
        ? daysUntilTrialEnd <= 3
        : daysSinceSignup >= nurture.days;
      if (!eligible) continue;

      // Check if already sent
      const existing = await db.select().from(nurtureEvents)
        .where(and(
          eq(nurtureEvents.restaurantId, r.id),
          eq(nurtureEvents.event, eventKey),
        )).limit(1);

      if (existing.length > 0) continue;

      const hasEmail = Boolean(r.managerEmail);
      const hasWhatsApp = Boolean(r.managerPhone && getTwilioConfig());
      if (!hasEmail && !hasWhatsApp) continue;

      // Claim the event before delivery so overlapping cron invocations cannot
      // double-send. Remove the claim on failure so the next run can retry.
      try {
        await db.insert(nurtureEvents).values({ restaurantId: r.id, event: eventKey });
      } catch {
        continue;
      }

      try {
        if (r.managerEmail) {
          const result = await sendMail({
            from: FROM,
            to: r.managerEmail,
            subject: nurture.subject(r.name, r.pilot),
            html: nurture.html(r.name, r.pilot),
          });
          if (!result.success) {
            throw new Error(result.error?.message ?? 'SMTP send skipped');
          }
        }
        if (r.managerPhone && hasWhatsApp) {
          await sendWhatsApp(r.managerPhone, nurture.whatsapp(r.name, r.pilot));
        }
      } catch (error) {
        await db.delete(nurtureEvents).where(and(
          eq(nurtureEvents.restaurantId, r.id),
          eq(nurtureEvents.event, eventKey),
        ));
        console.error(`[trial-nurture] ${eventKey} delivery failed for ${r.name}:`, error);
        continue;
      }

      processed++;
      console.log(`[trial-nurture] ${eventKey} → ${r.name}`);
    }
  }

  return Response.json({ processed });
}
