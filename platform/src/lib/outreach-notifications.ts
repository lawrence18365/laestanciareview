import { db } from '@/db';
import { outreachEvents, outreachProspects, restaurants } from '@/db/schema';
import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { sendEmail, escapeHtml } from '@/lib/email';
import {
  startOfTodayMexico,
  startOfTomorrowMexico,
  startOfYesterdayMexico,
} from '@/lib/mexico-tz';
import { hotLeadWhatsappUrl } from '@/lib/outreach-templates';
import type { OutreachProspect } from '@/lib/outreach-templates';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
  .replace(/\\n/g, '')
  .trim()
  .replace(/\/$/, '');

const OWNER_NOTIFICATION_EMAIL =
  (process.env.OWNER_NOTIFICATION_EMAIL ?? '').replace(/\\n/g, '').trim() ||
  (process.env.ADMIN_EMAIL ?? '').replace(/\\n/g, '').trim();

function ownerEmailOrNull(): string | null {
  return OWNER_NOTIFICATION_EMAIL || null;
}

function emailLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 28px 4px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#b45309;">RateTap Outreach</p>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#1c1917;">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-size:15px;line-height:1.6;color:#44403c;">
          ${body}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendAuditViewedAlert(prospect: OutreachProspect): Promise<void> {
  const to = ownerEmailOrNull();
  if (!to) {
    console.warn('[outreach-notifications] OWNER_NOTIFICATION_EMAIL not set — skipping alert');
    return;
  }

  const waUrl = hotLeadWhatsappUrl(prospect);
  const ratingText = prospect.rating ? `${Number(prospect.rating).toFixed(1)}★` : 'sin rating';
  const auditUrl = prospect.placeId ? `${BASE_URL}/audit/${encodeURIComponent(prospect.placeId)}` : null;

  const body = `
    <p style="margin:0 0 16px;"><strong>${escapeHtml(prospect.name)}</strong> acaba de abrir su auditoría.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;font-size:14px;color:#1c1917;">
      <tr><td style="color:#78716c;padding:6px 0;">Email</td><td style="font-weight:500;">${escapeHtml(prospect.email)}</td></tr>
      <tr><td style="color:#78716c;padding:6px 0;">Ciudad</td><td style="font-weight:500;">${escapeHtml(prospect.city ?? '—')}</td></tr>
      <tr><td style="color:#78716c;padding:6px 0;">Google</td><td style="font-weight:500;">${escapeHtml(ratingText)}</td></tr>
      <tr><td style="color:#78716c;padding:6px 0;">Tipo</td><td style="font-weight:500;">${prospect.kind === 'group' ? 'Grupo' : 'León'}</td></tr>
      ${auditUrl ? `<tr><td style="color:#78716c;padding:6px 0;">Auditoría</td><td style="font-weight:500;"><a href="${auditUrl}" style="color:#2563EB;">${auditUrl}</a></td></tr>` : ''}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr><td style="background:#2563EB;border-radius:10px;text-align:center;">
        <a href="${waUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Escribir por WhatsApp →</a>
      </td></tr>
    </table>
  `;

  await sendEmail({
    to,
    subject: `🔥 ${prospect.name} abrió su auditoría`,
    html: emailLayout('Hot lead', body),
  });
}

interface AuditViewedRow {
  prospectId: number;
  name: string;
  phone: string | null;
  placeId: string | null;
  viewedAt: Date;
}

export async function getYesterdaysAuditViews(): Promise<AuditViewedRow[]> {
  const start = startOfYesterdayMexico();
  const end = startOfTodayMexico();
  return db
    .select({
      prospectId: outreachEvents.prospectId,
      name: outreachProspects.name,
      phone: outreachProspects.phone,
      placeId: outreachProspects.placeId,
      viewedAt: outreachEvents.createdAt,
    })
    .from(outreachEvents)
    .innerJoin(outreachProspects, eq(outreachEvents.prospectId, outreachProspects.id))
    .where(
      and(
        eq(outreachEvents.type, 'audit_viewed'),
        gte(outreachEvents.createdAt, start),
        lt(outreachEvents.createdAt, end),
      ),
    )
    .orderBy(outreachEvents.createdAt);
}

interface SentCountRow {
  touchNumber: number | null;
  count: number;
}

export async function getTodaysSentCountsByTouch(): Promise<SentCountRow[]> {
  const start = startOfTodayMexico();
  const end = startOfTomorrowMexico();
  return db
    .select({
      touchNumber: outreachEvents.touchNumber,
      count: sql<number>`count(*)::int`,
    })
    .from(outreachEvents)
    .where(and(eq(outreachEvents.type, 'sent'), gte(outreachEvents.createdAt, start), lt(outreachEvents.createdAt, end)))
    .groupBy(outreachEvents.touchNumber);
}

export async function getTodaysUnsubscribes(): Promise<number> {
  const start = startOfTodayMexico();
  const end = startOfTomorrowMexico();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreachEvents)
    .where(and(eq(outreachEvents.type, 'unsubscribed'), gte(outreachEvents.createdAt, start), lt(outreachEvents.createdAt, end)));
  return rows[0]?.count ?? 0;
}

export async function getPilotRestaurantCount(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(restaurants)
    .where(eq(restaurants.pilot, true));
  return rows[0]?.count ?? 0;
}

interface TodaysFollowUpRow {
  id: number;
  name: string;
  email: string;
  touchesSent: number;
  nextTouchAt: Date | null;
}

export async function getTodaysFollowUps(): Promise<TodaysFollowUpRow[]> {
  const start = startOfTodayMexico();
  const end = startOfTomorrowMexico();
  return db
    .select({
      id: outreachProspects.id,
      name: outreachProspects.name,
      email: outreachProspects.email,
      touchesSent: outreachProspects.touchesSent,
      nextTouchAt: outreachProspects.nextTouchAt,
    })
    .from(outreachProspects)
    .where(
      and(
        isNotNull(outreachProspects.nextTouchAt),
        gte(outreachProspects.nextTouchAt, start),
        lt(outreachProspects.nextTouchAt, end),
      ),
    )
    .orderBy(outreachProspects.nextTouchAt);
}

export interface DigestResult {
  sent: boolean;
  skipped: boolean;
}

interface DigestEmptyInput {
  views: unknown[];
  sentCounts: SentCountRow[];
  unsubscribes: number;
  pilotCount: number;
  followUps: unknown[];
}

export function digestIsEmpty(input: DigestEmptyInput): boolean {
  const totalSent = input.sentCounts.reduce((sum, r) => sum + r.count, 0);
  return (
    input.views.length === 0 &&
    totalSent === 0 &&
    input.unsubscribes === 0 &&
    input.pilotCount === 0 &&
    input.followUps.length === 0
  );
}

export async function sendDailyDigest(): Promise<DigestResult> {
  const to = ownerEmailOrNull();
  if (!to) {
    console.warn('[outreach-notifications] OWNER_NOTIFICATION_EMAIL not set — skipping digest');
    return { sent: false, skipped: true };
  }

  const [views, sentCounts, unsubscribes, pilotCount, followUps] = await Promise.all([
    getYesterdaysAuditViews(),
    getTodaysSentCountsByTouch(),
    getTodaysUnsubscribes(),
    getPilotRestaurantCount(),
    getTodaysFollowUps(),
  ]);

  const totalSent = sentCounts.reduce((sum, r) => sum + r.count, 0);

  if (digestIsEmpty({ views, sentCounts, unsubscribes, pilotCount, followUps })) {
    return { sent: false, skipped: true };
  }

  const sections: string[] = [];

  // 1. Auditorías vistas ayer
  if (views.length > 0) {
    const rows = views
      .map((v) => {
        const url = v.placeId ? `${BASE_URL}/audit/${encodeURIComponent(v.placeId)}` : null;
        const wa = v.phone
          ? `https://wa.me/${v.phone.replace(/\D/g, '').length === 10 ? '52' + v.phone.replace(/\D/g, '') : v.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, soy Lawrence de RateTap — vi que revisó la auditoría de ${v.name}. ¿Le quedó alguna duda?`)}`
          : null;
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0ece7;">${escapeHtml(v.name)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0ece7;text-align:right;">${url ? `<a href="${url}" style="color:#2563EB;">auditoría</a>` : '—'}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0ece7;text-align:right;">${wa ? `<a href="${wa}" style="color:#2563EB;">WhatsApp</a>` : '—'}</td>
        </tr>`;
      })
      .join('');
    sections.push(`
      <h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#1c1917;">🔥 Auditorías vistas ayer (${views.length})</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">${rows}</table>
    `);
  }

  // 2. Envíos de secuencia
  if (totalSent > 0) {
    const counts = [1, 2, 3]
      .map((n) => {
        const row = sentCounts.find((r) => r.touchNumber === n);
        return `<tr><td style="padding:6px 0;">Touch ${n}</td><td style="padding:6px 0;text-align:right;font-weight:700;">${row?.count ?? 0}</td></tr>`;
      })
      .join('');
    sections.push(`
      <h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#1c1917;">📤 Envíos hoy (${totalSent})</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">${counts}</table>
    `);
  }

  // 3. Bajas
  if (unsubscribes > 0) {
    sections.push(`
      <h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#1c1917;">🚫 Bajas hoy</h2>
      <p style="margin:0;">${unsubscribes} prospecto${unsubscribes === 1 ? '' : 's'} dado${unsubscribes === 1 ? '' : 's'} de baja.</p>
    `);
  }

  // 4. Lugares piloto activos
  if (pilotCount > 0) {
    sections.push(`
      <h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#1c1917;">🧪 Lugares piloto activos</h2>
      <p style="margin:0;">${pilotCount} restaurante${pilotCount === 1 ? '' : 's'} en piloto.</p>
    `);
  }

  // 5. Hoy tocan
  if (followUps.length > 0) {
    const rows = followUps
      .map((f) => `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #f0ece7;">${escapeHtml(f.name)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #f0ece7;text-align:right;">Touch ${(f.touchesSent ?? 0) + 1}</td>
      </tr>`)
      .join('');
    sections.push(`
      <h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#1c1917;">⏰ Hoy tocan (${followUps.length})</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">${rows}</table>
    `);
  }

  const body = sections.join('');

  await sendEmail({
    to,
    subject: 'Resumen diario — RateTap Outreach',
    html: emailLayout('Resumen diario', body),
  });

  return { sent: true, skipped: false };
}
