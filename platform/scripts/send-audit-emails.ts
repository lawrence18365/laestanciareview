#!/usr/bin/env npx tsx
/**
 * RateTap — Audit Email Outreach
 *
 * For each prospect: fetches their website from Google Places,
 * scrapes for a contact email, sends a personalized cold email
 * via SMTP with their audit URL.
 *
 * Usage:
 *   npx tsx scripts/send-audit-emails.ts           # dry run (prints only)
 *   npx tsx scripts/send-audit-emails.ts --send    # actually sends
 *   npx tsx scripts/send-audit-emails.ts --send --limit=5  # send first 5 only
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { extractEmailFromHtml } from '../src/lib/extract-email';
import { closeMailer, FROM, sendMail, type MailerError } from '../src/lib/mailer';

const DRY_RUN = !process.argv.includes('--send');
const LIMIT = (() => {
  const a = process.argv.find(a => a.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1]) : Infinity;
})();
const MAX_RECIPIENTS = (() => {
  const a = process.argv.find(a => a.startsWith('--max='));
  if (!a) return 200;
  const parsed = parseInt(a.split('=')[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
})();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!.replace(/\\n/g, '').trim();
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com').replace(/\\n/g, '').trim().replace(/\/$/, '');
const SMTP_USER = process.env.SMTP_USER?.replace(/\\n/g, '').trim();
const SMTP_PASS = process.env.SMTP_PASS?.replace(/\\n/g, '').trim();

// ─── Prospects ────────────────────────────────────────────────
// Add/edit here. placeId drives the personalized audit URL.
const PROSPECTS: { name: string; placeId: string; rating: number; reviews: number; phone: string }[] = [
  { name: '3 Campos Almuerzos Regionales', placeId: 'ChIJ30pIeLm_K4QRpbEMyqpUNRk', rating: 4.1, reviews: 287, phone: '524775208324' },
  { name: 'Mendozzinos Pizza', placeId: 'ChIJc2coYNm-K4QRa8zjE_XfiS4', rating: 3.8, reviews: 513, phone: '524774333585' },
  { name: 'Vancouver Wings León', placeId: 'ChIJR8bxY02-K4QR_DBOrbwkHXU', rating: 3.9, reviews: 1150, phone: '524777112551' },
  { name: 'Don Carbón León', placeId: 'ChIJNRcD11G_K4QRlOGA4pHOn_g', rating: 4.0, reviews: 1656, phone: '524778304295' },
  { name: 'Restaurant Martin', placeId: 'ChIJxVr-253AK4QRD6kqlPZWjtY', rating: 4.3, reviews: 2449, phone: '524777626373' },
  { name: 'Las Fabulosas Papas León', placeId: 'ChIJEbdGtq2_K4QRnFmJzJO05yw', rating: 4.3, reviews: 2505, phone: '524777709000' },
  { name: 'Lupillos', placeId: 'ChIJ15erbVC_K4QRp6TEVSFCVl4', rating: 4.3, reviews: 1238, phone: '524777176557' },
  { name: 'Factory Pizza Alitas & Bar', placeId: 'ChIJdxI8Zwu_K4QREiAJb9f578I', rating: 4.2, reviews: 1300, phone: '524777141515' },
  { name: 'KSushi León', placeId: 'ChIJE9s_OOS-K4QR33YCnDJuFZk', rating: 4.3, reviews: 1181, phone: '524777710720' },
  { name: 'Okuma Mariano Escobedo', placeId: 'ChIJwbiQs62_K4QRc_sAxxrZ8u8', rating: 4.3, reviews: 943, phone: '524773901175' },
  { name: "Wing's Army", placeId: 'ChIJRyrXNlG_K4QRnl0izmLmp_8', rating: 4.1, reviews: 839, phone: '524777173602' },
  { name: 'Green Place', placeId: 'ChIJF9bogK6_K4QRL323Kxbhl5M', rating: 4.2, reviews: 606, phone: '524773327070' },
  { name: 'Mariscos Gus', placeId: 'ChIJi7ZeDKfAK4QR4My4-5IHyPw', rating: 4.3, reviews: 569, phone: '524774708986' },
];

// ─── Google Places helpers ────────────────────────────────────
async function getWebsite(placeId: string): Promise<string | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'website',
    key: API_KEY,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  const data = await res.json() as { result?: { website?: string }; status: string };
  return data.result?.website ?? null;
}

// ─── Email scraper ────────────────────────────────────────────
async function scrapeEmail(website: string): Promise<string | null> {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractEmailFromHtml(html);
  } catch {
    return null;
  }
}

// ─── Email builder ────────────────────────────────────────────
function buildEmail(name: string, rating: number, reviews: number, auditUrl: string): string {
  const pain = rating < 4.0
    ? `Con ${rating}★ y ${reviews.toLocaleString()} reseñas, estás dejando clientes en la mesa que van directo a la competencia.`
    : `Con ${rating}★ y ${reviews.toLocaleString()} reseñas, ya tienes una base sólida — RateTap puede ayudarte a mantenerte arriba.`;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <div style="background:#0F172A;padding:24px 32px">
    <span style="color:#FBBF24;font-size:18px;font-weight:700">RateTap</span>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 16px;color:#111;font-size:16px">Hola,</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">
      Preparé un diagnóstico gratuito de <strong>${name}</strong> en Google. ${pain}
    </p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
      Ve cómo se compara con tu competencia directa:
    </p>
    <a href="${auditUrl}"
       style="display:inline-block;background:#10B981;color:#fff;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:24px">
      Ver mi diagnóstico →
    </a>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">
      Restaurantes como <strong>La Estancia</strong> (12 sucursales) ya usan RateTap para subir su calificación — sin publicidad, solo reseñas reales de sus propios clientes.
    </p>
    <p style="margin:0 0 8px;color:#374151;font-size:15px">30 días gratis. Solo el setup/NFC inicial de $1,500 MXN; la mensualidad empieza después.</p>
    <p style="margin:0;color:#6B7280;font-size:14px;line-height:1.5">
      — RateTap<br>
      <a href="https://ratetapmx.com" style="color:#6B7280">ratetapmx.com</a>
    </p>
  </div>
</div>
</body>
</html>`.trim();
}

function shouldAbortRun(error: MailerError | null): boolean {
  if (!error) return false;

  const details = [error.code, error.message, error.response, error.command]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const isSmtpFailure = error.responseCode == null
    || (error.responseCode >= 400 && error.responseCode < 600);
  const isAuthFailure = error.code === 'EAUTH'
    || /auth(?:entication|orization)?|credentials|login/.test(details);
  const isRateLimit = error.responseCode === 421
    || /rate.?limit|too many|throttl|quota/.test(details);

  return isSmtpFailure && (isAuthFailure || isRateLimit);
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  RATETAP — AUDIT EMAIL OUTREACH  ${DRY_RUN ? '(DRY RUN)' : '🚀 LIVE'}     ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  if ((!SMTP_USER || !SMTP_PASS) && !DRY_RUN) {
    console.error('❌ SMTP_USER or SMTP_PASS not set');
    process.exit(1);
  }

  const targets = PROSPECTS.slice(0, LIMIT);

  let sent = 0, skipped = 0;
  let recipients = 0;
  let lastSendStartedAt = 0;

  for (const [index, p] of targets.entries()) {
    if (recipients >= MAX_RECIPIENTS) {
      console.warn('');
      console.warn('⚠️  DAILY CAP APPLIED — recipient list truncated');
      console.warn(`⚠️  Reached ${MAX_RECIPIENTS} recipients · ${targets.length - index} prospects left unprocessed (--max=${MAX_RECIPIENTS})`);
      console.warn('');
      break;
    }

    const auditUrl = `${BASE_URL}/audit/${p.placeId}`;
    process.stdout.write(`  ${p.name} (${p.rating}★)... `);

    // Get website from Google Places
    const website = await getWebsite(p.placeId);
    if (!website) {
      console.log('no website — skip');
      skipped++;
      continue;
    }

    // Scrape email from website
    const email = await scrapeEmail(website);
    if (!email) {
      console.log(`${website} — no email found`);
      skipped++;
      continue;
    }

    const subject = `Diagnóstico de ${p.name} — ${p.rating}★ en Google`;
    const html = buildEmail(p.name, p.rating, p.reviews, auditUrl);
    recipients++;

    if (DRY_RUN) {
      console.log(`\n     📧 To: ${email}\n     Subject: ${subject}\n     Audit: ${auditUrl}`);
    } else {
      const elapsed = Date.now() - lastSendStartedAt;
      if (lastSendStartedAt && elapsed < 3_000) {
        await new Promise(r => setTimeout(r, 3_000 - elapsed));
      }
      lastSendStartedAt = Date.now();

      const result = await sendMail({
        from: FROM,
        to: email,
        subject,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:${SMTP_USER}?subject=unsubscribe>`,
        },
      });
      if (result.success === false) {
        const message = result.error?.message ?? 'SMTP is not configured';
        console.error(`[send-audit-emails] sendMail failed ${JSON.stringify({
          to: email,
          responseCode: result.error?.responseCode ?? null,
          command: result.error?.command ?? null,
          message,
        })}`);
        if (shouldAbortRun(result.error)) {
          throw new Error(`Aborting outreach after SMTP auth/rate-limit failure: ${message}`);
        }
      } else {
        console.log(`sent → ${email}`);
        sent++;
      }
    }

    // Respect Google Places rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('');
  console.log(`Done. ${DRY_RUN ? 'Dry run' : `Sent: ${sent}`} · Skipped (no email): ${skipped}`);
  if (DRY_RUN) console.log('Run with --send to actually send.');
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(closeMailer);
