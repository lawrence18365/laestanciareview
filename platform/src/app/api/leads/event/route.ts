/**
 * Webhook endpoint for the Manychat WhatsApp event-bot.
 *
 * Auth: static `Authorization: Bearer <LEADS_WEBHOOK_TOKEN>`. Manychat sends
 * the same token on every request — there's no signature scheme, so the token
 * IS the trust boundary. Rotate by changing the env var + Manychat config.
 *
 * Tenant routing: prefer body.restaurant_slug (forward-compat for the 13-
 * location rollout — Manychat adds one custom field per workspace). Falls
 * back to LEADS_DEFAULT_RESTAURANT_SLUG so the May-10 demo doesn't need any
 * Manychat schema change.
 *
 * Dedup: unique violation on the partial index `event_leads_dedup_uniq`
 * (source, phone, external_created_at). Manychat retries within seconds carry
 * the same `created_at` from the bot's clock, so the realistic duplicate case
 * is caught. We catch the 23505 and return the existing row — the webhook
 * stays idempotent for retries while still letting the same number make a
 * legitimate second inquiry days later.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eventLeads, restaurants } from '@/db/schema';
import { timingSafeEqual } from '@/lib/timing';
import { sendPushToRestaurant } from '@/lib/push';
import {
  checkRateLimitAsync,
  getClientIP,
  rateLimitResponse,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  source: z.string().min(1).max(64),
  phone: z.string().min(6).max(32),
  name: z.string().max(120).nullish(),
  tipo_evento: z.string().max(120).nullish(),
  pax: z.coerce.number().int().nonnegative().max(100_000).nullish(),
  fecha_tentativa: z.string().max(120).nullish(),
  presupuesto_pp: z.string().max(64).nullish(),
  prioridad: z.string().max(64).nullish(),
  notas_extra: z.string().max(8_000).nullish(),
  urgente: z.boolean().nullish(),
  raw_conversation: z.string().max(50_000).nullish(),
  created_at: z.string().nullish(),
  restaurant_slug: z.string().max(120).nullish(),
});

type LeadBody = z.infer<typeof bodySchema>;

function buildPushPayload(lead: { id: number }, data: LeadBody) {
  const tipo = data.tipo_evento || 'evento';
  const paxPart = data.pax ? ` · ${data.pax} pax` : '';
  const fechaPart = data.fecha_tentativa ? ` · ${data.fecha_tentativa}` : '';
  const lines = [
    data.presupuesto_pp ? `Presupuesto: ${data.presupuesto_pp}` : null,
    data.prioridad ? `Prioridad: ${data.prioridad}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    title: data.urgente ? '🔥 Lead URGENTE de eventos' : 'Nuevo lead de eventos',
    body: `${tipo}${paxPart}${fechaPart}${lines ? `\n${lines}` : ''}`,
    url: `/leads?focus=${lead.id}`,
    tag: `lead-${lead.id}`,
  };
}

export async function POST(req: NextRequest) {
  // 1. Bearer token gate. Fail closed if the env isn't set.
  // The .replace(/\\n/g, '').trim() guards against the same env-storage quirk
  // that lib/google-places.ts and cron/refresh-ratings already defend against —
  // some envs in this project end up with a literal "\n" suffix.
  const expected = process.env.LEADS_WEBHOOK_TOKEN?.replace(/\\n/g, '').trim();
  if (!expected) {
    console.error('[leads-webhook] LEADS_WEBHOOK_TOKEN is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth || !timingSafeEqual(auth, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. IP rate limit. Defense in case the token leaks; not the primary gate.
  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`leads-webhook:${ip}`, 60, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // 3. Parse body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // 4. Resolve target restaurant. Body slug wins; env default is the demo
  //    fallback. Without either, refuse rather than silently writing to a
  //    random restaurant.
  const slug =
    data.restaurant_slug ??
    process.env.LEADS_DEFAULT_RESTAURANT_SLUG?.replace(/\\n/g, '').trim();
  if (!slug) {
    console.error(
      '[leads-webhook] no restaurant_slug in body and LEADS_DEFAULT_RESTAURANT_SLUG unset',
    );
    return Response.json(
      { error: 'No target restaurant configured' },
      { status: 500 },
    );
  }
  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found', slug }, { status: 404 });
  }

  // 5. Parse external_created_at. Bad timestamps fail loudly so Manychat
  //    config errors surface during testing instead of silently nulling out
  //    the dedup key.
  let externalCreatedAt: Date | null = null;
  if (data.created_at) {
    const d = new Date(data.created_at);
    if (isNaN(d.getTime())) {
      return Response.json(
        { error: 'Invalid created_at — expected ISO 8601' },
        { status: 400 },
      );
    }
    externalCreatedAt = d;
  }

  // 6. Insert. On 23505 (unique violation on the dedup index) treat it as a
  //    Manychat retry — return the existing row instead of erroring.
  let lead: typeof eventLeads.$inferSelect | undefined;
  let deduped = false;
  try {
    const [inserted] = await db
      .insert(eventLeads)
      .values({
        restaurantId: restaurant.id,
        source: data.source,
        phone: data.phone,
        name: data.name ?? null,
        tipoEvento: data.tipo_evento ?? null,
        pax: data.pax ?? null,
        fechaTentativa: data.fecha_tentativa ?? null,
        presupuestoPp: data.presupuesto_pp ?? null,
        prioridad: data.prioridad ?? null,
        notasExtra: data.notas_extra ?? null,
        urgente: data.urgente ?? false,
        rawConversation: data.raw_conversation ?? null,
        externalCreatedAt,
      })
      .returning();
    lead = inserted;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '23505' && externalCreatedAt) {
      const [existing] = await db
        .select()
        .from(eventLeads)
        .where(
          and(
            eq(eventLeads.source, data.source),
            eq(eventLeads.phone, data.phone),
            eq(eventLeads.externalCreatedAt, externalCreatedAt),
          ),
        )
        .limit(1);
      lead = existing;
      deduped = true;
    } else {
      console.error('[leads-webhook] insert failed', err);
      return Response.json({ error: 'Insert failed' }, { status: 500 });
    }
  }

  if (!lead) {
    return Response.json({ error: 'Insert failed' }, { status: 500 });
  }

  // 7. Push to the restaurant's hostess team — only on first arrival, not
  //    on retries. Failures don't fail the webhook; the lead is durably
  //    stored regardless.
  if (!deduped) {
    sendPushToRestaurant(restaurant.id, buildPushPayload(lead, data)).catch(
      (e) => console.error('[leads-webhook] push failed', e),
    );
  }

  return Response.json({
    lead_id: lead.id,
    deduped,
    claimed: lead.claimedAt !== null,
  });
}
