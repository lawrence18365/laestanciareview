/**
 * Daily cron: send email nurture messages to trialing restaurants (WhatsApp
 * only when WHATSAPP_API_ENABLED=1).
 * Day 1 → activation nudge, only when waiters or the Google listing are missing.
 * Day 3 → tips. Day 7 → case study (both switch to an activation variant while
 * the restaurant has no waiters or no guest ratings yet). Every trial
 * (self-serve and founder pilot) → ending warning three days before
 * trialEndsAt, linking to the Mercado Pago activation in Settings.
 *
 * Each channel is tracked on its own (`day3:email`, `day3:whatsapp`) so a
 * failed WhatsApp never makes the email send again. A plain `day3` row from
 * before this split counts as both channels sent.
 *
 * Schedule: every day at noon Mexico City (18:00 UTC)
 * Vercel cron: "0 18 * * *"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants, nurtureEvents, staff, reviews } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { FROM, sendMail } from '@/lib/mailer';
import { getPriceBreakdown } from '@/lib/mercadopago';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = 'https://app.ratetapmx.com';

// We have no WhatsApp Business API (only a Twilio sandbox owners never join),
// so nurture is email-only unless this is explicitly switched on.
const WHATSAPP_API_ENABLED = process.env.WHATSAPP_API_ENABLED === '1';

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

type Ctx = {
  name: string;
  pilot: boolean;
  slug: string;
  staffCount: number;
  ratingCount: number;
  hasGoogle: boolean;
};

const BUTTON = 'background:#10B981;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;display:inline-block;border-radius:6px';

function monthlyPrice(): string {
  return `$${getPriceBreakdown().total.toLocaleString('es-MX')} MXN/mes`;
}

// Nothing to celebrate yet: no waiters, or nobody has rated.
const needsActivation = (c: Ctx) => c.staffCount === 0 || c.ratingCount === 0;

function activationWhatsApp(c: Ctx, lead: string): string {
  return `*${c.name}*, ${lead} Aún no hay calificaciones de tus clientes.\n1. Agrega a tus meseros: ${BASE_URL}/staff\n2. Imprime sus QR: ${BASE_URL}/qr-codes`;
}

function activationHtml(c: Ctx, lead: string): string {
  return `<p>Hola ${c.name},</p><p>${lead} Aún no hay calificaciones de tus clientes.</p><ol><li><a href="${BASE_URL}/staff">Agrega a tus meseros →</a></li><li><a href="${BASE_URL}/qr-codes">Imprime sus QR →</a></li></ol>`;
}

const NURTURE: Record<string, {
  days: number;
  // Content gate beyond the signup age (e.g. day1 only when something is missing).
  applies?: (c: Ctx) => boolean;
  whatsapp: (c: Ctx) => string;
  subject: (c: Ctx) => string;
  html: (c: Ctx) => string;
}> = {
  day1: {
    days: 1,
    applies: (c) => c.staffCount === 0 || !c.hasGoogle,
    whatsapp: (c) => {
      const lines = [`Hola *${c.name}* 👋 Para empezar con RateTap te falta:`];
      if (c.staffCount === 0) lines.push(`• Agregar a tus meseros: ${BASE_URL}/staff`);
      if (!c.hasGoogle) lines.push(`• Conectar tu Google: ${BASE_URL}/settings`);
      return lines.join('\n');
    },
    subject: (c) => `Te falta un paso para empezar: ${c.name}`,
    html: (c) => {
      const items: string[] = [];
      if (c.staffCount === 0) items.push(`<li><a href="${BASE_URL}/staff">Agrega a tus meseros →</a></li>`);
      if (!c.hasGoogle) items.push(`<li><a href="${BASE_URL}/settings">Conecta tu Google →</a></li>`);
      return `<p>Hola ${c.name},</p><p>Para empezar con RateTap te falta:</p><ul>${items.join('')}</ul>`;
    },
  },
  day3: {
    days: 3,
    whatsapp: (c) => needsActivation(c)
      ? activationWhatsApp(c, 'llevas 3 días con RateTap.')
      : `Hola *${c.name}* 👋 Llevas 3 días con RateTap. Tip: pídele a tu equipo que muestren el código QR con la frase "Nos encantaría conocer tu opinión, ¿nos ayudas con una reseña? ⭐". ¿Cómo va hasta ahora?`,
    subject: (c) => needsActivation(c) ? `Activa tu RateTap: ${c.name}` : `Tip del día 3: ${c.name}`,
    html: (c) => needsActivation(c)
      ? activationHtml(c, 'Llevas 3 días con RateTap.')
      : `<p>Hola ${c.name},</p><p>Llevas 3 días con RateTap. El truco que mejor funciona: tu mesero muestra el código QR y dice "Nos encantaría conocer su opinión, ¿nos ayuda con una reseña en Google? ⭐".</p><p><a href="${BASE_URL}/dashboard">Ver mi dashboard →</a></p>`,
  },
  day7: {
    days: 7,
    // The La Estancia case study is only shown to that group's own locations;
    // everyone else gets the outcome without naming a client or its figures.
    whatsapp: (c) => needsActivation(c)
      ? activationWhatsApp(c, 'llevas una semana con RateTap.')
      : c.slug.startsWith('estancia')
        ? `*${c.name}*, llevas una semana 🎉 La Estancia (12 restaurantes en México) logró subir consistentemente sus calificaciones en todos sus locales con RateTap. Tus reseñas nuevas ya están trabajando para ti. Panel: ${BASE_URL}/dashboard`
        : `*${c.name}*, llevas una semana 🎉 Los restaurantes que piden la reseña en cada mesa reciben más reseñas. Tus reseñas nuevas ya están trabajando para ti. Panel: ${BASE_URL}/dashboard`,
    subject: (c) => needsActivation(c) ? `Aún no hay calificaciones: ${c.name}` : `Una semana con RateTap: ${c.name}`,
    html: (c) => needsActivation(c)
      ? activationHtml(c, 'Llevas una semana con RateTap.')
      : c.slug.startsWith('estancia')
        ? `<p>Hola ${c.name},</p><p>Llevas 7 días con RateTap. Grupo La Estancia (12 restaurantes en México) ha visto cómo sus reseñas de Google crecen consistentemente desde que usan el sistema.</p><p>Tus reseñas nuevas ya están llegando.</p><p><a href="${BASE_URL}/dashboard">Ver mi progreso →</a></p>`
        : `<p>Hola ${c.name},</p><p>Llevas 7 días con RateTap. Los restaurantes que piden la reseña en cada mesa reciben más reseñas.</p><p>Tus reseñas nuevas ya están llegando.</p><p><a href="${BASE_URL}/dashboard">Ver mi progreso →</a></p>`,
  },
  day12: {
    days: 12,
    whatsapp: (c) => c.pilot
      ? `Hola *${c.name}*, tu piloto fundador termina en 3 días. Si decides continuar, tu plan será de ${monthlyPrice()}. Escríbenos desde tu panel: ${BASE_URL}/settings`
      : `Hola *${c.name}*, tu prueba gratis termina en 3 días. Para seguir recibiendo reseñas de Google sin interrupciones, activa tu plan aquí: ${BASE_URL}/settings. ${monthlyPrice()}, cancela cuando quieras.`,
    subject: (c) => `${c.pilot ? 'Tu piloto' : 'Tu prueba'} termina en 3 días, ${c.name}`,
    html: (c) => c.pilot
      ? `<p>Hola ${c.name},</p><p>Tu piloto fundador de RateTap termina en <strong>3 días</strong>.</p><p>Si decides continuar, el plan cuesta ${monthlyPrice()}.</p><p><a href="${BASE_URL}/settings" style="${BUTTON}">Continuar con RateTap →</a></p><p style="color:#6b7280;font-size:13px">Sin contrato. Cancela cuando quieras.</p>`
      : `<p>Hola ${c.name},</p><p>Tu prueba gratis de RateTap termina en <strong>3 días</strong>.</p><p>Para que tus reseñas de Google sigan llegando sin interrupciones, activa tu plan (${monthlyPrice()}).</p><p><a href="${BASE_URL}/settings" style="${BUTTON}">Activar mi plan →</a></p><p style="color:#6b7280;font-size:13px">Sin contrato. Cancela cuando quieras.</p>`,
  },
};

async function countActiveStaff(restaurantId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(staff)
    .where(and(eq(staff.restaurantId, restaurantId), eq(staff.active, true)));
  return row?.n ?? 0;
}

async function countRatings(restaurantId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(reviews)
    .where(eq(reviews.restaurantId, restaurantId));
  return row?.n ?? 0;
}

/**
 * Claim one channel of one event before delivery so overlapping cron
 * invocations cannot double-send. The claim is removed on failure so only that
 * channel retries on the next run.
 */
async function deliver(
  restaurantId: number,
  event: string,
  label: string,
  send: () => Promise<void>,
): Promise<boolean> {
  try {
    await db.insert(nurtureEvents).values({ restaurantId, event });
  } catch {
    return false;
  }
  try {
    await send();
    return true;
  } catch (error) {
    await db.delete(nurtureEvents).where(and(
      eq(nurtureEvents.restaurantId, restaurantId),
      eq(nurtureEvents.event, event),
    ));
    console.error(`[trial-nurture] ${event} delivery failed for ${label}:`, error);
    return false;
  }
}

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

    const hasWhatsApp = WHATSAPP_API_ENABLED && Boolean(r.managerPhone && getTwilioConfig());
    if (!r.managerEmail && !hasWhatsApp) continue;

    const sentRows = await db.select().from(nurtureEvents)
      .where(eq(nurtureEvents.restaurantId, r.id));
    const sent = new Set(sentRows.map((e) => e.event));

    // Counts are only needed once something is actually pending; fetch lazily.
    let ctx: Ctx | null = null;
    const getCtx = async (): Promise<Ctx> => ctx ??= {
      name: r.name,
      pilot: r.pilot,
      slug: r.slug,
      staffCount: await countActiveStaff(r.id),
      ratingCount: await countRatings(r.id),
      hasGoogle: Boolean(r.googlePlaceId || r.googleReviewUrl),
    };

    for (const [eventKey, nurture] of Object.entries(NURTURE)) {
      // The ending warning keys off trialEndsAt only: without an end date (or
      // once it has passed) "termina en 3 días" would be false.
      const eligible = eventKey === 'day12'
        ? daysUntilTrialEnd !== null && daysUntilTrialEnd > 0 && daysUntilTrialEnd <= 3
        : daysSinceSignup >= nurture.days;
      if (!eligible) continue;

      // A plain `${eventKey}` row (pre channel split) means both channels sent.
      const legacySent = sent.has(eventKey);
      const needEmail = Boolean(r.managerEmail) && !legacySent && !sent.has(`${eventKey}:email`);
      const needWhatsApp = hasWhatsApp && !legacySent && !sent.has(`${eventKey}:whatsapp`);
      if (!needEmail && !needWhatsApp) continue;

      const c = await getCtx();
      if (nurture.applies && !nurture.applies(c)) continue;

      let delivered = false;

      if (needEmail && r.managerEmail) {
        const to = r.managerEmail;
        delivered = await deliver(r.id, `${eventKey}:email`, r.name, async () => {
          const result = await sendMail({
            from: FROM,
            to,
            subject: nurture.subject(c),
            html: nurture.html(c),
          });
          if (!result.success) {
            throw new Error(result.error?.message ?? 'SMTP send skipped');
          }
        }) || delivered;
      }
      if (needWhatsApp && r.managerPhone) {
        const to = r.managerPhone;
        delivered = await deliver(r.id, `${eventKey}:whatsapp`, r.name, () =>
          sendWhatsApp(to, nurture.whatsapp(c)),
        ) || delivered;
      }

      if (delivered) {
        processed++;
        console.log(`[trial-nurture] ${eventKey} → ${r.name}`);
      }
    }
  }

  return Response.json({ processed });
}
