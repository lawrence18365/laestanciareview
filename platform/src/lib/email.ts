import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY.trim());
  return _resend;
}

/** Strip stray whitespace/newlines from env vars (Vercel CLI sometimes injects \\n). */
const clean = (v: string | undefined, fallback: string) => (v ?? fallback).replace(/\\n/g, '').trim();

const FROM = clean(process.env.EMAIL_FROM, 'RateTap <notifications@ratetapmx.com>');
const BASE_URL = clean(process.env.NEXT_PUBLIC_BASE_URL, 'https://app.ratetapmx.com');
const LOGO_URL = `${BASE_URL}/logos/ratetap_logo_transparent_background.png`;

/** Escape HTML special characters to prevent injection. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Branded email wrapper — header with logo, content area, footer. */
function emailLayout(content: string, footerNote?: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
  <style>
    :root { color-scheme: light dark; }
    body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    @media only screen and (max-width: 480px) {
      .email-container { width: 100% !important; padding: 16px 12px !important; }
      .content-card { border-radius: 12px !important; }
      .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .stat-value { font-size: 22px !important; }
    }
  </style>
</head>
<body class="body" style="margin: 0; padding: 0; background: #f5f0eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background: #f5f0eb;">
    <tr><td align="center" class="email-container" style="padding: 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px;">

        <!-- Logo Header -->
        <tr><td style="padding: 0 0 28px; text-align: center;">
          <a href="${BASE_URL}" style="text-decoration: none;">
            <img src="${LOGO_URL}" alt="RateTap" width="160" style="display: inline-block; width: 160px; height: auto; background: #ffffff; padding: 12px 16px; border-radius: 12px;" />
          </a>
        </td></tr>

        <!-- Content Card -->
        <tr><td class="content-card" style="background: #ffffff; border-radius: 16px; box-shadow: 0 1px 4px rgba(28,25,23,0.04), 0 4px 16px rgba(28,25,23,0.06);">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding: 28px 16px 0; text-align: center;">
          ${footerNote ? `<p style="margin: 0 0 8px; font-size: 12px; color: #a8a29e;">${footerNote}</p>` : ''}
          <p style="margin: 0; font-size: 11px; color: #c4c0bb;">
            <a href="${BASE_URL}" style="color: #c4c0bb; text-decoration: none;">RateTap</a> &middot; Califica. Conecta. Crece.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ────────────────────────────────────────────────────────────
// Feedback Alert
// ────────────────────────────────────────────────────────────

interface FeedbackAlertParams {
  to: string;
  restaurantName: string;
  customerName: string | null;
  customerEmail: string | null;
  rating: number;
  staffName: string | null;
  feedback: string;
}

export async function sendFeedbackAlert({
  to,
  restaurantName,
  customerName,
  customerEmail,
  rating,
  staffName,
  feedback,
}: FeedbackAlertParams) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email');
    return;
  }

  const filledStars = '★'.repeat(rating);
  const emptyStars = '☆'.repeat(5 - rating);
  const accentColor = rating >= 4 ? '#16a34a' : rating >= 3 ? '#ca8a04' : '#dc2626';
  const accentBg = rating >= 4 ? '#f0fdf4' : rating >= 3 ? '#fefce8' : '#fef2f2';
  const urgencyLabel = rating <= 2 ? 'Urgente' : rating <= 3 ? 'Atención' : 'Positivo';

  const content = `
    <!-- Colored accent bar -->
    <div style="height: 4px; background: ${accentColor}; border-radius: 16px 16px 0 0;"></div>

    <div class="content-pad" style="padding: 28px 32px 32px;">
      <!-- Rating badge -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; padding: 10px 24px; background: ${accentBg}; border-radius: 12px;">
          <span style="font-size: 24px; letter-spacing: 3px; color: ${accentColor};">${filledStars}</span><span style="font-size: 24px; letter-spacing: 3px; color: #d6d3d1;">${emptyStars}</span>
        </div>
        <p style="margin: 8px 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${accentColor};">${urgencyLabel}</p>
      </div>

      <!-- Restaurant name -->
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #1c1917; text-align: center;">${escapeHtml(restaurantName)}</h1>
      <p style="margin: 0 0 24px; font-size: 13px; color: #a8a29e; text-align: center;">Nuevo comentario de cliente</p>

      <!-- Feedback quote -->
      <div style="margin: 0 0 24px; padding: 20px 24px; background: #faf8f6; border-radius: 12px; border-left: 4px solid ${accentColor};">
        <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #1c1917; font-style: italic;">&ldquo;${escapeHtml(feedback)}&rdquo;</p>
      </div>

      <!-- Details cards -->
      ${customerName || staffName || customerEmail ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        ${customerName ? `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f5f0eb;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a8a29e;">Cliente</span><br/>
            <span style="font-size: 15px; font-weight: 500; color: #1c1917;">${escapeHtml(customerName)}</span>
          </td>
        </tr>` : ''}
        ${customerEmail ? `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f5f0eb;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a8a29e;">Email</span><br/>
            <a href="mailto:${encodeURIComponent(customerEmail)}" style="font-size: 15px; color: #b45309; text-decoration: none; font-weight: 500;">${escapeHtml(customerEmail)}</a>
          </td>
        </tr>` : ''}
        ${staffName ? `
        <tr>
          <td style="padding: 10px 0;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a8a29e;">Mesero</span><br/>
            <span style="font-size: 15px; font-weight: 500; color: #1c1917;">${escapeHtml(staffName)}</span>
          </td>
        </tr>` : ''}
      </table>` : ''}

      <!-- CTA -->
      <div style="text-align: center;">
        <a href="${BASE_URL}/inbox" style="display: inline-block; padding: 14px 36px; background: #1c1917; color: #ffffff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;">
          Ver en Buzón
        </a>
      </div>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `${rating <= 2 ? '🔴' : rating <= 3 ? '🟡' : '🟢'} Nuevo comentario de ${rating} estrellas — ${restaurantName}`,
    html: emailLayout(content),
  });
}

// ────────────────────────────────────────────────────────────
// Weekly Digest
// ────────────────────────────────────────────────────────────

interface DigestStaffEntry {
  staffName: string | null;
  staffCode: string | null;
  avgRating: number;
  reviewCount: number;
}

interface GoogleTrendDigest {
  baselineRating: number;
  currentRating: number;
  ratingChange: number;
  reviewsGained: number;
}

interface WeeklyDigestParams {
  to: string;
  restaurantName: string;
  lastWeek: { totalReviews: number; avgRating: number; googleSends: number; intercepted: number };
  weekBefore: { totalReviews: number; avgRating: number; googleSends: number; intercepted: number };
  unresolvedCount: number;
  topPerformers: DigestStaffEntry[];
  dashboardUrl: string;
  googleTrend?: GoogleTrendDigest | null;
}

export async function sendWeeklyDigest({
  to,
  restaurantName,
  lastWeek,
  weekBefore,
  unresolvedCount,
  topPerformers,
  dashboardUrl,
  googleTrend,
}: WeeklyDigestParams) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping weekly digest');
    return;
  }

  const reviewsDelta = lastWeek.totalReviews - weekBefore.totalReviews;
  const ratingDelta = lastWeek.avgRating && weekBefore.avgRating
    ? (lastWeek.avgRating - weekBefore.avgRating).toFixed(1)
    : null;

  const delta = (d: number) => d > 0 ? `<span style="color:#16a34a;font-size:12px;">+${d}</span>` : d < 0 ? `<span style="color:#dc2626;font-size:12px;">${d}</span>` : '';
  const ratingD = (d: string | null) => {
    if (!d) return '';
    const n = parseFloat(d);
    if (n > 0) return `<span style="color:#16a34a;font-size:12px;">+${d}</span>`;
    if (n < 0) return `<span style="color:#dc2626;font-size:12px;">${d}</span>`;
    return '';
  };

  const statCell = (value: string, label: string, extra: string, position: 'left' | 'mid' | 'right') => {
    const radius = position === 'left' ? '12px 0 0 12px' : position === 'right' ? '0 12px 12px 0' : '0';
    const border = position !== 'right' ? 'border-right: 1px solid #f0ece7;' : '';
    return `<td style="padding: 16px 8px; background: #faf8f6; border-radius: ${radius}; text-align: center; width: 33%; ${border}">
      <p class="stat-value" style="margin: 0; font-size: 26px; font-weight: 700; color: #1c1917;">${value}</p>
      <p style="margin: 4px 0 0; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">${label}</p>
      ${extra ? `<p style="margin: 4px 0 0;">${extra}</p>` : ''}
    </td>`;
  };

  const leaderboardRows = topPerformers.length > 0
    ? topPerformers.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `<tr>
        <td style="padding: 10px 16px; border-top: 1px solid #f0ece7; font-size: 14px;">
          ${medal} <strong>${p.staffName ?? 'Desconocido'}</strong>
        </td>
        <td style="padding: 10px 16px; border-top: 1px solid #f0ece7; font-size: 14px; text-align: right; color: #b45309; font-weight: 600;">
          ${p.avgRating.toFixed(1)} ★
        </td>
        <td style="padding: 10px 16px; border-top: 1px solid #f0ece7; font-size: 13px; text-align: right; color: #78716c;">
          ${p.reviewCount} reseñas
        </td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="3" style="padding: 16px; color: #a8a29e; font-style: italic; font-size: 14px; text-align: center;">Sin reseñas la semana pasada</td></tr>`;

  const googleBanner = googleTrend && googleTrend.ratingChange !== 0 ? `
    <div style="margin: 0 28px 20px; padding: 20px; background: #faf8f6; border-radius: 12px; text-align: center;">
      <p style="margin: 0 0 8px; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Calificacion de Google</p>
      <p style="margin: 0;">
        <span style="color: #a8a29e; font-size: 18px;">${googleTrend.baselineRating.toFixed(1)}</span>
        <span style="color: #d6d3d1; padding: 0 8px;">→</span>
        <span style="font-size: 32px; font-weight: 800; color: #1c1917;">${googleTrend.currentRating.toFixed(1)}</span>
        <span style="font-size: 20px; color: #b45309;"> ★</span>
        <span style="font-size: 16px; font-weight: 700; color: ${googleTrend.ratingChange > 0 ? '#16a34a' : '#dc2626'}; padding-left: 6px;">
          ${googleTrend.ratingChange > 0 ? '+' : ''}${googleTrend.ratingChange.toFixed(1)}
        </span>
      </p>
      ${googleTrend.reviewsGained > 0 ? `<p style="margin: 6px 0 0; font-size: 12px; color: #78716c;">+${googleTrend.reviewsGained} nuevas reseñas en Google</p>` : ''}
    </div>` : '';

  const interceptedBanner = lastWeek.intercepted > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: #fffbeb; border-radius: 10px; border-left: 4px solid #f59e0b;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #92400e;">
        🛡️ ${lastWeek.intercepted} ${lastWeek.intercepted === 1 ? 'reseña negativa captada' : 'reseñas negativas captadas'} en privado esta semana
      </p>
      <p style="margin: 6px 0 0;"><a href="${BASE_URL}/inbox" style="font-size: 12px; color: #b45309; text-decoration: underline;">Ver detalle en Buzón →</a></p>
    </div>` : '';

  const unresolvedBanner = unresolvedCount > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: #fef2f2; border-radius: 10px; border-left: 4px solid #dc2626;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #991b1b;">
        ${unresolvedCount} ${unresolvedCount === 1 ? 'comentario sin resolver' : 'comentarios sin resolver'} necesitan atencion
      </p>
    </div>` : '';

  const content = `
    <!-- Header -->
    <div style="padding: 28px 28px 4px;">
      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #b45309;">Resumen Semanal</p>
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1c1917;">${escapeHtml(restaurantName)}</h1>
    </div>

    ${googleBanner}

    <!-- Stats -->
    <div style="padding: 20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; border-spacing: 0;">
        <tr>
          ${statCell(String(lastWeek.totalReviews), 'Reseñas', delta(reviewsDelta), 'left')}
          ${statCell(lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--', 'Calif. Prom.', ratingD(ratingDelta), 'mid')}
          ${statCell(String(lastWeek.googleSends), 'Envios a Google', '', 'right')}
        </tr>
      </table>
    </div>

    ${interceptedBanner}
    ${unresolvedBanner}

    <!-- Leaderboard -->
    <div style="margin: 0 28px 24px; background: #faf8f6; border-radius: 12px; overflow: hidden;">
      <p style="margin: 0; padding: 14px 16px 10px; font-size: 12px; font-weight: 700; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Mejores Desempeños</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${leaderboardRows}
      </table>
    </div>

    <!-- CTA -->
    <div style="padding: 0 28px 32px; text-align: center;">
      <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background: #1c1917; color: #ffffff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
        Abrir Panel
      </a>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal — ${restaurantName} — ${lastWeek.totalReviews} reseñas, ${lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--'} prom`,
    html: emailLayout(content, 'Enviado cada lunes por RateTap'),
  });
}

// ────────────────────────────────────────────────────────────
// Owner Digest
// ────────────────────────────────────────────────────────────

interface OwnerLocationSummary {
  name: string;
  reviews: number;
  avgRating: number;
  googleSends: number;
  intercepted: number;
  unresolved: number;
  ratingChange: number | null;
  currentRating: number | null;
}

interface OwnerDigestParams {
  to: string;
  locations: OwnerLocationSummary[];
  dashboardUrl: string;
}

export async function sendOwnerDigest({ to, locations, dashboardUrl }: OwnerDigestParams) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping owner digest');
    return;
  }

  const totalReviews = locations.reduce((s, l) => s + l.reviews, 0);
  const totalUnresolved = locations.reduce((s, l) => s + l.unresolved, 0);
  const totalIntercepted = locations.reduce((s, l) => s + l.intercepted, 0);
  const weightedAvg = locations.reduce((s, l) => s + l.avgRating * l.reviews, 0);
  const avgDenom = locations.reduce((s, l) => s + (l.avgRating ? l.reviews : 0), 0);
  const overallAvg = avgDenom > 0 ? (weightedAvg / avgDenom).toFixed(1) : '--';

  const movers = locations
    .filter((l) => l.ratingChange != null && l.ratingChange !== 0)
    .sort((a, b) => (b.ratingChange ?? 0) - (a.ratingChange ?? 0));

  const googleMoversBanner = movers.length > 0 ? `
    <div style="margin: 0 28px 20px; padding: 20px; background: #faf8f6; border-radius: 12px;">
      <p style="margin: 0 0 12px; font-size: 12px; font-weight: 700; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Cambios en Google</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${movers.map((l) => {
          const color = (l.ratingChange ?? 0) > 0 ? '#16a34a' : '#dc2626';
          const sign = (l.ratingChange ?? 0) > 0 ? '+' : '';
          return `<tr style="border-top: 1px solid #ebe7e2;">
            <td style="padding: 8px 0; font-size: 14px; color: #1c1917;">${l.name}</td>
            <td style="padding: 8px 0; font-size: 14px; text-align: right; font-weight: 600; color: #b45309;">${l.currentRating != null ? l.currentRating.toFixed(1) + ' ★' : '--'}</td>
            <td style="padding: 8px 0; font-size: 14px; text-align: right; font-weight: 700; color: ${color};">${sign}${(l.ratingChange ?? 0).toFixed(1)}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>` : '';

  const interceptedBanner = totalIntercepted > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: #fffbeb; border-radius: 10px; border-left: 4px solid #f59e0b;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #92400e;">
        🛡️ ${totalIntercepted} ${totalIntercepted === 1 ? 'reseña negativa captada' : 'reseñas negativas captadas'} en privado en todas las ubicaciones
      </p>
      <p style="margin: 6px 0 0;"><a href="${BASE_URL}/intercepted" style="font-size: 12px; color: #b45309; text-decoration: underline;">Ver detalle por ubicación →</a></p>
    </div>` : '';

  const unresolvedBanner = totalUnresolved > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: #fef2f2; border-radius: 10px; border-left: 4px solid #dc2626;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #991b1b;">
        ${totalUnresolved} ${totalUnresolved === 1 ? 'comentario sin resolver' : 'comentarios sin resolver'} en todas las ubicaciones
      </p>
    </div>` : '';

  const sorted = [...locations].sort((a, b) => (a.avgRating || 99) - (b.avgRating || 99));

  const locationRows = sorted.map((l) => {
    const ratingColor = l.avgRating >= 4 ? '#16a34a' : l.avgRating >= 3 ? '#eab308' : '#dc2626';
    const unresolvedBadge = l.unresolved > 0
      ? `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626;margin-left:6px;">${l.unresolved}</span>`
      : '';
    return `<tr style="border-top: 1px solid #f0ece7;">
      <td style="padding: 10px 14px; font-size: 14px; font-weight: 500; color: #1c1917;">${l.name}${unresolvedBadge}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #44403c;">${l.reviews}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: ${ratingColor}; font-weight: 700;">${l.avgRating ? l.avgRating.toFixed(1) + ' ★' : '--'}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #78716c;">${l.googleSends}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #92400e; font-weight: 600;">${l.intercepted > 0 ? l.intercepted : '-'}</td>
    </tr>`;
  }).join('');

  const content = `
    <!-- Header -->
    <div style="padding: 28px 28px 4px;">
      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #b45309;">Resumen del Propietario</p>
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1c1917;">${locations.length} Ubicaciones</h1>
    </div>

    <!-- Totals -->
    <div style="padding: 20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; border-spacing: 0;">
        <tr>
          <td style="padding: 18px 12px; background: #faf8f6; border-radius: 12px 0 0 12px; text-align: center; width: 33%; border-right: 1px solid #f0ece7;">
            <p style="margin: 0; font-size: 28px; font-weight: 700; color: #1c1917;">${totalReviews}</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Total Reseñas</p>
          </td>
          <td style="padding: 18px 12px; background: #faf8f6; text-align: center; width: 33%; border-right: 1px solid #f0ece7;">
            <p style="margin: 0; font-size: 28px; font-weight: 700; color: #1c1917;">${overallAvg}</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Calif. Prom.</p>
          </td>
          <td style="padding: 18px 12px; background: #faf8f6; border-radius: 0 12px 12px 0; text-align: center; width: 33%;">
            <p style="margin: 0; font-size: 28px; font-weight: 700; color: #1c1917;">${locations.length}</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Ubicaciones</p>
          </td>
        </tr>
      </table>
    </div>

    ${googleMoversBanner}
    ${interceptedBanner}
    ${unresolvedBanner}

    <!-- Locations Table -->
    <div style="margin: 0 28px 24px; background: #faf8f6; border-radius: 12px; overflow: hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr>
            <th style="padding: 12px 14px; font-size: 11px; text-align: left; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Ubicacion</th>
            <th style="padding: 12px 14px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Reseñas</th>
            <th style="padding: 12px 14px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Prom</th>
            <th style="padding: 12px 14px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Google</th>
            <th style="padding: 12px 14px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Captados</th>
          </tr>
        </thead>
        <tbody>
          ${locationRows}
        </tbody>
      </table>
    </div>

    <!-- CTA -->
    <div style="padding: 0 28px 32px; text-align: center;">
      <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background: #1c1917; color: #ffffff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
        Abrir Resumen
      </a>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal — ${totalReviews} reseñas, ${overallAvg} prom en ${locations.length} ubicaciones`,
    html: emailLayout(content, 'Enviado cada lunes por RateTap'),
  });
}

// ────────────────────────────────────────────────────────────
// Password Reset
// ────────────────────────────────────────────────────────────

interface PasswordResetParams {
  to: string;
  restaurantName: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail({
  to,
  restaurantName,
  resetUrl,
}: PasswordResetParams) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping password reset email');
    return;
  }

  const content = `
    <div style="padding: 32px 28px;">
      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #b45309;">Seguridad</p>
      <h1 style="margin: 0 0 20px; font-size: 22px; font-weight: 700; color: #1c1917;">Restablecer Contraseña</h1>

      <p style="margin: 0 0 6px; font-size: 15px; line-height: 1.6; color: #44403c;">
        Recibimos una solicitud para restablecer la contraseña de <strong>${escapeHtml(restaurantName)}</strong>.
      </p>
      <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #44403c;">
        Haz clic en el boton de abajo para crear una nueva contraseña.
      </p>

      <div style="text-align: center; margin: 0 0 28px;">
        <a href="${resetUrl}" style="display: inline-block; padding: 14px 36px; background: #1c1917; color: #ffffff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
          Restablecer Contraseña
        </a>
      </div>

      <div style="padding: 16px; background: #faf8f6; border-radius: 10px;">
        <p style="margin: 0; font-size: 13px; color: #78716c; line-height: 1.5;">
          Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, puedes ignorar este correo — tu contraseña no sera modificada.
        </p>
      </div>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `🔐 Restablecer contraseña — ${restaurantName}`,
    html: emailLayout(content),
  });
}

// ────────────────────────────────────────────────────────────
// Test Email
// ────────────────────────────────────────────────────────────

export async function sendTestEmail(to: string) {
  const resend = getResend();
  if (!resend) {
    return { success: false, error: 'RESEND_API_KEY not set' };
  }

  const content = `
    <div style="padding: 32px 28px; text-align: center;">
      <div style="width: 56px; height: 56px; margin: 0 auto 20px; background: #f0fdf4; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 28px;">✓</span>
      </div>
      <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1c1917;">Email Configurado</h1>
      <p style="margin: 0; font-size: 15px; color: #44403c; line-height: 1.5;">
        La integracion con Resend esta funcionando correctamente. Los emails de RateTap se enviaran desde esta direccion.
      </p>
    </div>`;

  const result = await resend.emails.send({
    from: FROM,
    to,
    subject: '✅ RateTap — Email configurado correctamente',
    html: emailLayout(content),
  });

  return { success: true, id: result.data?.id };
}

// ────────────────────────────────────────────────────────────
// GM Feedback (to admin)
// ────────────────────────────────────────────────────────────

const categoryLabels: Record<string, string> = {
  bug: 'Reporte de Error',
  feature: 'Solicitud de Funcion',
  feedback: 'Comentario General',
  question: 'Pregunta / Ayuda',
};

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  bug: { bg: '#fef2f2', text: '#dc2626', border: '#dc2626' },
  feature: { bg: '#fefce8', text: '#ca8a04', border: '#ca8a04' },
  feedback: { bg: '#f0fdf4', text: '#16a34a', border: '#16a34a' },
  question: { bg: '#eff6ff', text: '#2563eb', border: '#2563eb' },
};

interface GMFeedbackParams {
  restaurantName: string;
  restaurantSlug: string;
  category: string;
  subject: string;
  message: string;
}

export async function sendGMFeedback({
  restaurantName,
  restaurantSlug,
  category,
  subject,
  message,
}: GMFeedbackParams) {
  const adminEmail = process.env.ADMIN_EMAIL?.replace(/\\n/g, '').trim();
  if (!adminEmail) {
    console.warn('[email] ADMIN_EMAIL not set — skipping GM feedback email');
    return;
  }
  const label = categoryLabels[category] ?? category;
  const colors = categoryColors[category] ?? categoryColors.feedback;

  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — logging GM feedback to console');
    console.log(`[GM Feedback] ${label} from ${restaurantName}: ${subject || '(no subject)'}\n${message}`);
    return;
  }

  const content = `
    <div style="padding: 32px 28px;">
      <div style="margin-bottom: 20px;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ${colors.bg}; color: ${colors.text};">
          ${label}
        </span>
      </div>

      <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #1c1917;">${escapeHtml(subject || 'Sin asunto')}</h1>
      <p style="margin: 0 0 20px; color: #78716c; font-size: 13px;">
        De <strong>${escapeHtml(restaurantName)}</strong> (${escapeHtml(restaurantSlug)})
      </p>

      <div style="padding: 20px; background: #faf8f6; border-radius: 12px; border-left: 4px solid ${colors.border};">
        <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #1c1917; white-space: pre-wrap;">${escapeHtml(message)}</p>
      </div>
    </div>`;

  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: `[GM ${label}] ${subject || restaurantName}`,
    replyTo: adminEmail,
    html: emailLayout(content),
  });
}
