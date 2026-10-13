/**
 * Daily cron: send email nurture messages to trialing restaurants (WhatsApp
 * only when WHATSAPP_API_ENABLED=1).
 * Day 1 → activation nudge, only when waiters or the Google listing are missing.
 * Day 3 → tips. Day 7 → case study (both switch to an activation variant while
 * the restaurant has no waiters or no guest ratings yet). Restaurants with
 * team_mode solo | team (self-serve onboarding) are tailored instead:
 * activation = first rating, and day 3 / 7 show real progress numbers once
 * ratings exist. team_mode NULL keeps the copy above exactly. Every trial
 * (self-serve and founder pilot) → ending warning three days before
 * trialEndsAt, linking to the Mercado Pago activation in Settings.
 *
 * Plan Restaurante (US-15), self-serve only (group_key NULL): day 25 of a
 * non-pilot trial ("Tu prueba termina el …", progress numbers, price) and, once
 * the trial lapsed onto the free plan, a counts-only teaser 3 and 10 days after
 * it ended. All link to /plan, email-first, and each email records an
 * upgrade_prompt_shown event (email_day25 / email_free_d3 / email_free_d10).
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
import { restaurants, nurtureEvents, staff, reviews, googleRatingSnapshots } from '@/db/schema';
import { eq, ne, and, count, desc, isNotNull } from 'drizzle-orm';
import { FROM, sendMail } from '@/lib/mailer';
import { reviewGoal } from '@/lib/onboarding-profile';
import { getPriceBreakdown } from '@/lib/mercadopago';
import { planFor, selfServePrice, usesPlanRestaurantePrice } from '@/lib/entitlements';
import { recordProductEvent } from '@/lib/product-events';
import { addEmailTracking } from '@/lib/email-tracking';

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
  // US-14: 'solo' | 'team' get the tailored copy. Anything else (NULL = every
  // legacy restaurant, incl. Grupo Estancia) keeps today's copy exactly.
  mode: 'solo' | 'team' | 'legacy';
  staffCount: number;
  ratingCount: number;
  hasGoogle: boolean;
  // Tailored modes only; null = unknown, and the number is then omitted.
  sentToGoogle: number | null;
  googleCount: number | null;
  // Plan Restaurante messages only (day25, free_d3, free_d10).
  endsOn: string | null;
  commentCount: number;
  // Billed at the Plan Restaurante price (self-serve, 1 location); others keep
  // the global monthly price.
  restaurantePrice: boolean;
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

// ── Tailored modes (team_mode solo | team): activation = first rating ──────

const tailored = (c: Ctx) => c.mode !== 'legacy';
const fmt = (n: number) => n.toLocaleString('es-MX');

/** "Llevas 12 calificaciones; 7 fueron a Google. Tienes 48 reseñas; tu meta: 68." Unknown numbers are omitted. */
function progressText(c: Ctx): string {
  const n = c.ratingCount;
  const first = c.sentToGoogle === null
    ? `Llevas ${fmt(n)} ${n === 1 ? 'calificación' : 'calificaciones'}.`
    : `Llevas ${fmt(n)} ${n === 1 ? 'calificación' : 'calificaciones'}; ${fmt(c.sentToGoogle)} ${c.sentToGoogle === 1 ? 'fue' : 'fueron'} a Google.`;
  if (c.googleCount === null) return first;
  const g = c.googleCount;
  return `${first} Tienes ${fmt(g)} ${g === 1 ? 'reseña' : 'reseñas'}; tu meta: ${fmt(reviewGoal(g))}.`;
}

function progressWhatsApp(c: Ctx, lead: string): string {
  return `*${c.name}*, ${lead} ${progressText(c)}\nTu panel: ${BASE_URL}/dashboard`;
}

function progressHtml(c: Ctx, lead: string): string {
  return `<p>Hola ${c.name},</p><p>${lead} ${progressText(c)}</p><p><a href="${BASE_URL}/dashboard">Ver mi panel →</a></p>`;
}

const SOLO_STEPS = ['Imprime tu letrero', 'Pídele la reseña a tu próximo cliente'] as const;

function soloActivationWhatsApp(c: Ctx, lead: string): string {
  return `*${c.name}*, ${lead} Aún no hay calificaciones de tus clientes.\n1. ${SOLO_STEPS[0]}: ${BASE_URL}/qr-codes/letrero\n2. ${SOLO_STEPS[1]}.`;
}

function soloActivationHtml(c: Ctx, lead: string): string {
  return `<p>Hola ${c.name},</p><p>${lead} Aún no hay calificaciones de tus clientes.</p><ol><li><a href="${BASE_URL}/qr-codes/letrero">${SOLO_STEPS[0]} →</a></li><li>${SOLO_STEPS[1]}.</li></ol>`;
}

// Team: the waiter step is only listed while there are no waiters yet.
function teamActivationWhatsApp(c: Ctx, lead: string): string {
  const steps: string[] = [];
  if (c.staffCount === 0) steps.push(`Agrega a tus meseros: ${BASE_URL}/staff`);
  steps.push(`Imprime sus QR: ${BASE_URL}/qr-codes`);
  return `*${c.name}*, ${lead} Aún no hay calificaciones de tus clientes.\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

function teamActivationHtml(c: Ctx, lead: string): string {
  const items: string[] = [];
  if (c.staffCount === 0) items.push(`<li><a href="${BASE_URL}/staff">Agrega a tus meseros →</a></li>`);
  items.push(`<li><a href="${BASE_URL}/qr-codes">Imprime sus QR →</a></li>`);
  return `<p>Hola ${c.name},</p><p>${lead} Aún no hay calificaciones de tus clientes.</p><ol>${items.join('')}</ol>`;
}

function soloDay1WhatsApp(c: Ctx): string {
  const lines = [`Hola *${c.name}* 👋 Para tu primera reseña:`, `• ${SOLO_STEPS[0]}: ${BASE_URL}/qr-codes/letrero`, `• ${SOLO_STEPS[1]}.`];
  if (!c.hasGoogle) lines.push(`• Conecta tu Google: ${BASE_URL}/settings`);
  return lines.join('\n');
}

function soloDay1Html(c: Ctx): string {
  const items = [
    `<li><a href="${BASE_URL}/qr-codes/letrero">${SOLO_STEPS[0]} →</a></li>`,
    `<li>${SOLO_STEPS[1]}.</li>`,
  ];
  if (!c.hasGoogle) items.push(`<li><a href="${BASE_URL}/settings">Conecta tu Google →</a></li>`);
  return `<p>Hola ${c.name},</p><p>Para tu primera reseña:</p><ol>${items.join('')}</ol>`;
}

// ── Plan Restaurante (US-15): trial ending (day25) and the free plan ───────
// Counts only, never a guest's name, contact or comment. Each message is
// 60 words or fewer and links to /plan.

/** "Plan Restaurante desde MX$299/mes" for 1-location self-serve; the global price otherwise. */
function planPriceLine(c: Ctx): string {
  return c.restaurantePrice
    ? `Plan Restaurante desde MX$${selfServePrice('monthly')}/mes`
    : `Tu plan: ${monthlyPrice()}`;
}

const CANCEL_NOTE = 'Cancela cuando quieras.';

/** "Llevas 12 calificaciones; 48 reseñas en Google." The Google part is omitted when unknown. */
function endingProgress(c: Ctx): string {
  const n = c.ratingCount;
  const base = `Llevas ${fmt(n)} ${n === 1 ? 'calificación' : 'calificaciones'}`;
  if (c.googleCount === null) return `${base}.`;
  const g = c.googleCount;
  return `${base}; ${fmt(g)} ${g === 1 ? 'reseña' : 'reseñas'} en Google.`;
}

/** Free-plan teaser counts. The comment count is a number only, never text. */
function freeCounts(c: Ctx): string {
  const n = c.ratingCount;
  const k = c.commentCount;
  return `Hasta hoy: ${fmt(n)} ${n === 1 ? 'calificación' : 'calificaciones'}, ${fmt(c.sentToGoogle ?? 0)} a Google, ${fmt(k)} ${k === 1 ? 'comentario' : 'comentarios'}.`;
}

function day25Text(c: Ctx): string {
  return `${endingProgress(c)} Tu prueba termina el ${c.endsOn}. ${planPriceLine(c)}. ${CANCEL_NOTE}`;
}

function freeText(c: Ctx, lead: string): string {
  return `${lead} ${freeCounts(c)} Los comentarios están bloqueados. Activa tu plan para leerlos. ${planPriceLine(c)}. ${CANCEL_NOTE}`;
}

const planHtml = (c: Ctx, text: string) =>
  `<p>Hola ${c.name},</p><p>${text}</p><p><a href="${BASE_URL}/plan" style="${BUTTON}">Ver el plan →</a></p>`;
const planWhatsApp = (c: Ctx, text: string) => `*${c.name}*, ${text}\nVer el plan: ${BASE_URL}/plan`;

const FREE_D3_LEAD = 'Tu prueba terminó, pero tu QR sigue funcionando.';
const FREE_D10_LEAD = 'Tu QR sigue funcionando en el plan gratis.';

const NURTURE: Record<string, {
  days: number;
  // 'free' = post-trial teaser for a self-serve restaurant on the free plan.
  audience?: 'free';
  // product_events placement for the upgrade_prompt_shown row written after the email.
  placement?: string;
  // Content gate beyond the signup age (e.g. day1 only when something is missing).
  applies?: (c: Ctx) => boolean;
  whatsapp: (c: Ctx) => string;
  subject: (c: Ctx) => string;
  html: (c: Ctx) => string;
}> = {
  day1: {
    days: 1,
    applies: (c) => {
      const missing = c.staffCount === 0 || !c.hasGoogle;
      if (c.mode === 'solo') return c.ratingCount === 0;
      if (c.mode === 'team') return c.ratingCount === 0 && missing;
      return missing;
    },
    whatsapp: (c) => {
      if (c.mode === 'solo') return soloDay1WhatsApp(c);
      const lines = [`Hola *${c.name}* 👋 Para empezar con RateTap te falta:`];
      if (c.staffCount === 0) lines.push(`• Agregar a tus meseros: ${BASE_URL}/staff`);
      if (!c.hasGoogle) lines.push(`• Conectar tu Google: ${BASE_URL}/settings`);
      return lines.join('\n');
    },
    subject: (c) => c.mode === 'solo'
      ? `Tu primera reseña: ${c.name}`
      : `Te falta un paso para empezar: ${c.name}`,
    html: (c) => {
      if (c.mode === 'solo') return soloDay1Html(c);
      const items: string[] = [];
      if (c.staffCount === 0) items.push(`<li><a href="${BASE_URL}/staff">Agrega a tus meseros →</a></li>`);
      if (!c.hasGoogle) items.push(`<li><a href="${BASE_URL}/settings">Conecta tu Google →</a></li>`);
      return `<p>Hola ${c.name},</p><p>Para empezar con RateTap te falta:</p><ul>${items.join('')}</ul>`;
    },
  },
  day3: {
    days: 3,
    whatsapp: (c) => {
      if (tailored(c)) {
        if (c.ratingCount > 0) return progressWhatsApp(c, 'llevas 3 días con RateTap.');
        return c.mode === 'solo'
          ? soloActivationWhatsApp(c, 'llevas 3 días con RateTap.')
          : teamActivationWhatsApp(c, 'llevas 3 días con RateTap.');
      }
      return needsActivation(c)
        ? activationWhatsApp(c, 'llevas 3 días con RateTap.')
        : `Hola *${c.name}* 👋 Llevas 3 días con RateTap. Tip: pídele a tu equipo que muestren el código QR con la frase "Nos encantaría conocer tu opinión, ¿nos ayudas con una reseña? ⭐". ¿Cómo va hasta ahora?`;
    },
    subject: (c) => tailored(c)
      ? (c.ratingCount > 0 ? `Tu avance en RateTap: ${c.name}` : `Activa tu RateTap: ${c.name}`)
      : needsActivation(c) ? `Activa tu RateTap: ${c.name}` : `Tip del día 3: ${c.name}`,
    html: (c) => tailored(c)
      ? (c.ratingCount > 0
        ? progressHtml(c, 'Llevas 3 días con RateTap.')
        : c.mode === 'solo'
          ? soloActivationHtml(c, 'Llevas 3 días con RateTap.')
          : teamActivationHtml(c, 'Llevas 3 días con RateTap.'))
      : needsActivation(c)
      ? activationHtml(c, 'Llevas 3 días con RateTap.')
      : `<p>Hola ${c.name},</p><p>Llevas 3 días con RateTap. El truco que mejor funciona: tu mesero muestra el código QR y dice "Nos encantaría conocer su opinión, ¿nos ayuda con una reseña en Google? ⭐".</p><p><a href="${BASE_URL}/dashboard">Ver mi dashboard →</a></p>`,
  },
  day7: {
    days: 7,
    // The La Estancia case study is only shown to that group's own locations;
    // everyone else gets the outcome without naming a client or its figures.
    whatsapp: (c) => tailored(c)
      ? (c.ratingCount > 0
        ? progressWhatsApp(c, 'llevas una semana con RateTap.')
        : c.mode === 'solo'
          ? soloActivationWhatsApp(c, 'llevas una semana con RateTap.')
          : teamActivationWhatsApp(c, 'llevas una semana con RateTap.'))
      : needsActivation(c)
      ? activationWhatsApp(c, 'llevas una semana con RateTap.')
      : c.slug.startsWith('estancia')
        ? `*${c.name}*, llevas una semana 🎉 La Estancia (12 restaurantes en México) logró subir consistentemente sus calificaciones en todos sus locales con RateTap. Tus reseñas nuevas ya están trabajando para ti. Panel: ${BASE_URL}/dashboard`
        : `*${c.name}*, llevas una semana 🎉 Los restaurantes que piden la reseña en cada mesa reciben más reseñas. Tus reseñas nuevas ya están trabajando para ti. Panel: ${BASE_URL}/dashboard`,
    subject: (c) => tailored(c)
      ? (c.ratingCount > 0 ? `Una semana con RateTap: ${c.name}` : `Aún no hay calificaciones: ${c.name}`)
      : needsActivation(c) ? `Aún no hay calificaciones: ${c.name}` : `Una semana con RateTap: ${c.name}`,
    html: (c) => tailored(c)
      ? (c.ratingCount > 0
        ? progressHtml(c, 'Llevas 7 días con RateTap.')
        : c.mode === 'solo'
          ? soloActivationHtml(c, 'Llevas una semana con RateTap.')
          : teamActivationHtml(c, 'Llevas una semana con RateTap.'))
      : needsActivation(c)
      ? activationHtml(c, 'Llevas una semana con RateTap.')
      : c.slug.startsWith('estancia')
        ? `<p>Hola ${c.name},</p><p>Llevas 7 días con RateTap. Grupo La Estancia (12 restaurantes en México) ha visto cómo sus reseñas de Google crecen consistentemente desde que usan el sistema.</p><p>Tus reseñas nuevas ya están llegando.</p><p><a href="${BASE_URL}/dashboard">Ver mi progreso →</a></p>`
        : `<p>Hola ${c.name},</p><p>Llevas 7 días con RateTap. Los restaurantes que piden la reseña en cada mesa reciben más reseñas.</p><p>Tus reseñas nuevas ya están llegando.</p><p><a href="${BASE_URL}/dashboard">Ver mi progreso →</a></p>`,
  },
  // Self-serve, non-pilot trials only (eligibility is in GET). Progress numbers
  // and the Plan Restaurante price, linking to /plan.
  day25: {
    days: 25,
    placement: 'email_day25',
    whatsapp: (c) => planWhatsApp(c, day25Text(c)),
    subject: (c) => `Tu prueba termina el ${c.endsOn}: ${c.name}`,
    html: (c) => planHtml(c, day25Text(c)),
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
  // Post-trial, free plan (group_key NULL): 3 and 10 days after the trial ended.
  free_d3: {
    days: 3,
    audience: 'free',
    placement: 'email_free_d3',
    whatsapp: (c) => planWhatsApp(c, freeText(c, FREE_D3_LEAD)),
    subject: (c) => `Tu QR sigue activo: ${c.name}`,
    html: (c) => planHtml(c, freeText(c, FREE_D3_LEAD)),
  },
  free_d10: {
    days: 10,
    audience: 'free',
    placement: 'email_free_d10',
    whatsapp: (c) => planWhatsApp(c, freeText(c, FREE_D10_LEAD)),
    subject: (c) => `Tu plan gratis en RateTap: ${c.name}`,
    html: (c) => planHtml(c, freeText(c, FREE_D10_LEAD)),
  },
};

/** Only send a post-trial message inside a window, so a long-lapsed restaurant is never backfilled. */
const FREE_WINDOW_DAYS = 7;

/** "5 de noviembre", in Mexico City time. */
function mxDate(d: Date): string {
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });
}

async function countComments(restaurantId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(reviews)
    .where(and(eq(reviews.restaurantId, restaurantId), isNotNull(reviews.feedback)));
  return row?.n ?? 0;
}

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

async function countSentToGoogle(restaurantId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(reviews)
    .where(and(eq(reviews.restaurantId, restaurantId), eq(reviews.sentToGoogle, true)));
  return row?.n ?? 0;
}

/** Google review count from the latest snapshot; null when none was ever captured. */
async function latestGoogleCount(restaurantId: number): Promise<number | null> {
  const [row] = await db.select({ n: googleRatingSnapshots.reviewCount })
    .from(googleRatingSnapshots)
    .where(eq(googleRatingSnapshots.restaurantId, restaurantId))
    .orderBy(desc(googleRatingSnapshots.capturedAt))
    .limit(1);
  return typeof row?.n === 'number' ? row.n : null;
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

  // Trials, plus lapsed self-serve restaurants (the free plan, US-15). Paying
  // restaurants are excluded in SQL; anything else is sorted out by planFor().
  const candidates = await db.select().from(restaurants)
    .where(ne(restaurants.subscriptionStatus, 'active'));

  let processed = 0;

  for (const r of candidates) {
    const plan = planFor(r);
    if (plan !== 'trial' && plan !== 'free') continue;
    const isFreePlan = plan === 'free';
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
    const getCtx = async (): Promise<Ctx> => {
      if (ctx) return ctx;
      // Only an explicit 'solo' | 'team' is tailored; NULL (and anything else)
      // stays on the legacy path, with the same queries as before.
      const mode = r.teamMode === 'solo' || r.teamMode === 'team' ? r.teamMode : 'legacy';
      const staffCount = await countActiveStaff(r.id);
      const ratingCount = await countRatings(r.id);
      let sentToGoogle: number | null = null;
      let googleCount: number | null = null;
      if (mode !== 'legacy' && ratingCount > 0) {
        sentToGoogle = await countSentToGoogle(r.id);
        googleCount = (await latestGoogleCount(r.id)) ?? r.googleReviewCount ?? null;
      }
      return ctx = {
        name: r.name,
        pilot: r.pilot,
        slug: r.slug,
        mode,
        staffCount,
        ratingCount,
        hasGoogle: Boolean(r.googlePlaceId || r.googleReviewUrl),
        sentToGoogle,
        googleCount,
        endsOn: r.trialEndsAt ? mxDate(r.trialEndsAt) : null,
        commentCount: 0,
        restaurantePrice: usesPlanRestaurantePrice(r),
      };
    };

    // Plan Restaurante messages quote real numbers whatever the team mode, so
    // they fill what the tailored path only fetches for some modes.
    let planCtx: Ctx | null = null;
    const getPlanCtx = async (): Promise<Ctx> => {
      if (planCtx) return planCtx;
      const base = await getCtx();
      const sentToGoogle = await countSentToGoogle(r.id);
      const googleCount = (await latestGoogleCount(r.id)) ?? r.googleReviewCount ?? null;
      const commentCount = await countComments(r.id);
      return planCtx = { ...base, sentToGoogle, googleCount, commentCount };
    };

    // Day 12 is the ending warning for shorter trials; a restaurant that already
    // got the day 25 note is not warned twice.
    let endingNoted = [...sent].some((e) => e.startsWith('day25'));

    for (const [eventKey, nurture] of Object.entries(NURTURE)) {
      let eligible: boolean;
      if (nurture.audience === 'free') {
        // Post-trial: only on the free plan, N days after the trial ended, and
        // only inside a week-long window so a long-lapsed restaurant is not backfilled.
        const sinceEnd = r.trialEndsAt
          ? Math.floor((Date.now() - r.trialEndsAt.getTime()) / 86_400_000)
          : -1;
        eligible = isFreePlan && sinceEnd >= nurture.days && sinceEnd < nurture.days + FREE_WINDOW_DAYS;
      } else if (isFreePlan) {
        eligible = false;
      } else if (eventKey === 'day12') {
        // The ending warning keys off trialEndsAt only: without an end date (or
        // once it has passed) "termina en 3 días" would be false.
        eligible = !endingNoted
          && daysUntilTrialEnd !== null && daysUntilTrialEnd > 0 && daysUntilTrialEnd <= 3;
      } else if (eventKey === 'day25') {
        // Self-serve trials only (Grupo and founder pilots keep today's flow).
        eligible = r.groupKey === null && !r.pilot
          && daysSinceSignup >= nurture.days
          && daysUntilTrialEnd !== null && daysUntilTrialEnd > 0;
      } else {
        eligible = daysSinceSignup >= nurture.days;
      }
      if (!eligible) continue;

      // A plain `${eventKey}` row (pre channel split) means both channels sent.
      const legacySent = sent.has(eventKey);
      const needEmail = Boolean(r.managerEmail) && !legacySent && !sent.has(`${eventKey}:email`);
      const needWhatsApp = hasWhatsApp && !legacySent && !sent.has(`${eventKey}:whatsapp`);
      if (!needEmail && !needWhatsApp) continue;

      const c = nurture.placement ? await getPlanCtx() : await getCtx();
      if (nurture.applies && !nurture.applies(c)) continue;

      let delivered = false;

      if (needEmail && r.managerEmail) {
        const to = r.managerEmail;
        const emailed = await deliver(r.id, `${eventKey}:email`, r.name, async () => {
          const result = await sendMail({
            from: FROM,
            to,
            subject: nurture.subject(c),
            // Open pixel + wrapped links (SQ-218); no-op when signing is unavailable.
            html: await addEmailTracking(nurture.html(c), {
              template: `nurture_${eventKey}`,
              restaurantId: r.id,
            }),
          });
          if (!result.success) {
            throw new Error(result.error?.message ?? 'SMTP send skipped');
          }
        });
        delivered = emailed || delivered;
        if (emailed && nurture.placement) {
          await recordProductEvent({
            name: 'upgrade_prompt_shown',
            restaurantId: r.id,
            path: '/plan',
            properties: { placement: nurture.placement, plan },
          });
        }
      }
      if (needWhatsApp && r.managerPhone) {
        const to = r.managerPhone;
        delivered = await deliver(r.id, `${eventKey}:whatsapp`, r.name, () =>
          sendWhatsApp(to, nurture.whatsapp(c)),
        ) || delivered;
      }

      if (delivered) {
        if (eventKey === 'day25') endingNoted = true;
        processed++;
        console.log(`[trial-nurture] ${eventKey} → ${r.name}`);
      }
    }
  }

  return Response.json({ processed });
}
