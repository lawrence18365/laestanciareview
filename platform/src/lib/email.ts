import { sendMail } from '@/lib/mailer';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';

/** Strip stray whitespace/newlines from env vars (Vercel CLI sometimes injects \\n). */
const clean = (v: string | undefined, fallback: string) => (v ?? fallback).replace(/\\n/g, '').trim();

const FROM = clean(process.env.EMAIL_FROM, 'RateTap <notifications@ratetapmx.com>');
const BASE_URL = clean(process.env.NEXT_PUBLIC_BASE_URL, 'https://app.ratetapmx.com');
const LOGO_URL = `${BASE_URL}/logos/ratetap_logo_transparent_background.png`;

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: {
    filename?: string;
    content?: Buffer | string;
    path?: string;
    cid?: string;
    contentType?: string;
  }[];
  headers?: Record<string, string>;
}

interface OutreachSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

let outreachTransport: Transporter | null = null;

function getOutreachSmtpConfig(): OutreachSmtpConfig | null {
  const host = clean(process.env.SMTP_HOST, 'mail.spacemail.com');
  const user = clean(process.env.SMTP_USER, '');
  const pass = clean(process.env.SMTP_PASS, '');
  if (!user || !pass) return null;

  const parsedPort = Number.parseInt(clean(process.env.SMTP_PORT, '465'), 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 465;
  return { host, port, secure: port === 465, auth: { user, pass } };
}

function getOutreachTransport(config: OutreachSmtpConfig): Transporter {
  if (!outreachTransport) {
    outreachTransport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      tls: { rejectUnauthorized: true },
    });
  }
  return outreachTransport;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, text) => {
      const cleanText = String(text).replace(/<[^>]+>/g, '').trim();
      return cleanText ? `${cleanText} (${url})` : url;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Outreach send path. It requires SMTP, sends multipart mail, and appends the
 * exact RFC822 payload to the provider's Sent folder on a best-effort basis.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text: textOverride,
  replyTo,
  attachments,
  headers,
}: SendEmailOptions): Promise<{ provider: 'smtp'; data?: { id?: string } }> {
  const config = getOutreachSmtpConfig();
  if (!config) {
    throw new Error('SMTP_USER or SMTP_PASS not set');
  }

  const options: SendMailOptions = {
    from: FROM,
    to,
    subject,
    text: textOverride ?? htmlToText(html),
    html,
    replyTo,
    attachments,
    headers,
  };
  const { default: MailComposer } = await import('nodemailer/lib/mail-composer');
  const rawMessage = await new MailComposer(options).compile().build();
  const result = await getOutreachTransport(config).sendMail({ ...options, raw: rawMessage });

  appendOutreachToSent(rawMessage, config).catch((error: unknown) => {
    console.warn(
      '[email] IMAP Sent append failed:',
      error instanceof Error ? error.message : String(error),
    );
  });

  return {
    provider: 'smtp',
    data: result.messageId ? { id: result.messageId } : undefined,
  };
}

async function appendOutreachToSent(rawMessage: Buffer, config: OutreachSmtpConfig) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: config.host,
    port: 993,
    secure: true,
    auth: config.auth,
    logger: false as unknown as undefined,
  });

  try {
    await client.connect();
    const boxes = await client.list();
    const sent = boxes.find((box) => box.specialUse === '\\Sent')
      ?? boxes.find((box) => ['sent', 'inbox.sent', 'sent items', 'inbox.sent items']
        .includes(box.path.toLowerCase()));
    let sentPath = sent?.path;
    if (!sentPath) {
      try {
        await client.mailboxCreate('Sent');
        sentPath = 'Sent';
      } catch {
        console.warn('[email] IMAP Sent folder not found');
        return;
      }
    }
    await client.append(sentPath, rawMessage, ['\\Seen']);
  } finally {
    await client.logout();
  }
}

/** Escape HTML special characters to prevent injection. */
export function escapeHtml(str: string): string {
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

  const result = await sendMail({
    from: FROM,
    to,
    subject: `${rating <= 2 ? '🔴' : rating <= 3 ? '🟡' : '🟢'} Nuevo comentario de ${rating} estrellas — ${restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendFeedbackAlert] failed to ${to}: ${reason}`);
  }
  return result;
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

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal — ${restaurantName} — ${lastWeek.totalReviews} reseñas, ${lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--'} prom`,
    html: emailLayout(content, 'Enviado cada lunes por RateTap'),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendWeeklyDigest] failed to ${to}: ${reason}`);
  }
  return result;
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

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal — ${totalReviews} reseñas, ${overallAvg} prom en ${locations.length} ubicaciones`,
    html: emailLayout(content, 'Enviado cada lunes por RateTap'),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendOwnerDigest] failed to ${to}: ${reason}`);
  }
  return result;
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

  const result = await sendMail({
    from: FROM,
    to,
    subject: `🔐 Restablecer contraseña — ${restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendPasswordResetEmail] failed to ${to}: ${reason}`);
  }
}

// ────────────────────────────────────────────────────────────
// Test Email
// ────────────────────────────────────────────────────────────

export async function sendTestEmail(to: string) {
  const content = `
    <div style="padding: 32px 28px; text-align: center;">
      <div style="width: 56px; height: 56px; margin: 0 auto 20px; background: #f0fdf4; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 28px;">✓</span>
      </div>
      <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1c1917;">Email Configurado</h1>
      <p style="margin: 0; font-size: 15px; color: #44403c; line-height: 1.5;">
        La integracion con SMTP esta funcionando correctamente. Los emails de RateTap se enviaran desde esta direccion.
      </p>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: '✅ RateTap — Email configurado correctamente',
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendTestEmail] failed to ${to}: ${reason}`);
    return { success: false, error: reason };
  }

  return { success: true, id: result.messageId ?? undefined };
}

// ────────────────────────────────────────────────────────────
// Feature Announcement
// ────────────────────────────────────────────────────────────

interface FeatureAnnouncementParams {
  to: string;
  restaurantName: string;
}

export async function sendFeatureAnnouncement({
  to,
  restaurantName,
}: FeatureAnnouncementParams) {
  const content = `
    <div style="padding: 32px 28px;">
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #eff6ff; color: #2563eb;">
          Nueva Funcion
        </span>
      </div>

      <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1c1917;">
        Notificaciones Push en tu Celular
      </h1>
      <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #44403c;">
        Hola! Ahora <strong>${escapeHtml(restaurantName)}</strong> puede recibir alertas instantaneas cuando un cliente deje una resena negativa — directo en tu iPhone, como un mensaje de WhatsApp.
      </p>

      <div style="padding: 20px; background: #faf8f6; border-radius: 12px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em;">Como funciona</p>

        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #2563eb; color: white; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0;">1</span>
          <p style="margin: 0; font-size: 14px; color: #44403c; line-height: 1.5;">Abre tu panel de RateTap en Safari en tu iPhone</p>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #2563eb; color: white; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0;">2</span>
          <p style="margin: 0; font-size: 14px; color: #44403c; line-height: 1.5;">Agrega RateTap a tu pantalla de inicio (Compartir → Agregar a pantalla de inicio)</p>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #2563eb; color: white; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0;">3</span>
          <p style="margin: 0; font-size: 14px; color: #44403c; line-height: 1.5;">Abre RateTap desde la pantalla de inicio y toca <strong>"Activar Notificaciones"</strong></p>
        </div>
      </div>

      <div style="padding: 16px 20px; background: #fffbeb; border-radius: 10px; border-left: 4px solid #f59e0b; margin-bottom: 28px;">
        <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.5;">
          Cuando un cliente deje una resena de 3 estrellas o menos, recibiras una notificacion al instante en tu celular — para que puedas actuar de inmediato.
        </p>
      </div>

      <div style="text-align: center;">
        <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 14px 36px; background: #1c1917; color: #ffffff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
          Abrir Mi Panel
        </a>
      </div>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📱 Nuevo: Notificaciones push en tu celular — ${restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendFeatureAnnouncement] failed to ${to}: ${reason}`);
  }
  return result;
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

  const result = await sendMail({
    from: FROM,
    to: adminEmail,
    subject: `[GM ${label}] ${subject || restaurantName}`,
    replyTo: adminEmail,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendGMFeedback] failed to ${adminEmail}: ${reason}`);
  }
}

// ────────────────────────────────────────────────────────────
// Self-serve signup + Stripe trial emails
// ────────────────────────────────────────────────────────────

const OWNER_NOTIFICATION_EMAIL =
  clean(process.env.OWNER_NOTIFICATION_EMAIL, '') || clean(process.env.ADMIN_EMAIL, '');

function mxnFmt(amount: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }).format(amount);
}

interface WelcomeEmailParams {
  to: string;
  restaurantName: string;
  slug: string;
  qrDataUrl: string;
  reviewUrl: string;
  trialEndsAt: Date;
  trialDays?: number;
  pilot?: boolean;
}

export async function sendWelcomeEmail({
  to,
  restaurantName,
  slug,
  qrDataUrl,
  reviewUrl,
  trialEndsAt,
  trialDays = 15,
  pilot = false,
}: WelcomeEmailParams) {
  const trialEndStr = trialEndsAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

  const content = `
    <div class="content-pad" style="padding: 32px 28px;">
      <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 700; color: #1c1917;">¡Bienvenido a RateTap! 🎉</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, tu prueba gratis de ${trialDays} días ya está activa hasta el <strong>${escapeHtml(trialEndStr)}</strong>.
      </p>

      <div style="text-align: center; padding: 24px; background: #faf8f6; border-radius: 12px; margin: 0 0 20px;">
        <img src="${qrDataUrl}" alt="QR de ${escapeHtml(restaurantName)}" width="220" style="display: block; margin: 0 auto 12px; width: 220px; height: 220px; background: #fff; border-radius: 12px; padding: 8px;" />
        <p style="margin: 0 0 6px; font-size: 13px; color: #78716c;">Tu enlace personalizado:</p>
        <p style="margin: 0; font-size: 13px; font-weight: 600; color: #1c1917; word-break: break-all;">
          <a href="${reviewUrl}" style="color: #1c1917;">${escapeHtml(reviewUrl)}</a>
        </p>
      </div>

      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        ${pilot
          ? 'Imprime este QR y colócalo en tus mesas hoy mismo. Si decides continuar después del piloto, te enviaremos tus tarjetas NFC físicas.'
          : 'Imprime este QR y colócalo en tus mesas hoy mismo. En cuanto confirmes tu pago el día 15, te enviaremos tus tarjetas NFC físicas.'}
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #1c1917; border-radius: 10px;">
          <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 13px 28px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px;">
            Entrar a mi panel
          </a>
        </td></tr>
      </table>

      <p style="margin: 24px 0 0; font-size: 13px; color: #a8a29e; text-align: center; line-height: 1.5;">
        Tu página de reseñas: <a href="${reviewUrl}" style="color: #78716c;">${escapeHtml(reviewUrl)}</a>
      </p>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `Bienvenido a RateTap, ${restaurantName} 🎉`,
    html: emailLayout(content, `Tu prueba es gratis por ${trialDays} días. Puedes cancelar cuando quieras.`),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendWelcomeEmail] failed to ${to}: ${reason}`);
  }
}

interface TrialEndingEmailParams {
  to: string;
  restaurantName: string;
  daysLeft: number;
  amountMxn: number;
}

export async function sendTrialEndingEmail({ to, restaurantName, daysLeft, amountMxn }: TrialEndingEmailParams) {
  const content = `
    <div class="content-pad" style="padding: 32px 28px;">
      <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #1c1917;">Tu prueba termina en ${daysLeft} días</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, en ${daysLeft} días cobraremos <strong>${mxnFmt(amountMxn)}</strong> a la tarjeta que registraste y seguirás usando RateTap sin interrupciones.
      </p>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        Si no quieres continuar, puedes cancelar desde tu panel antes de esa fecha y no se cobrará nada.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #1c1917; border-radius: 10px;">
          <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 13px 28px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px;">
            Ir a mi panel
          </a>
        </td></tr>
      </table>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `Tu prueba de RateTap termina en ${daysLeft} días`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendTrialEndingEmail] failed to ${to}: ${reason}`);
  }
}

interface ReceiptEmailParams {
  to: string;
  restaurantName: string;
  amountMxn: number;
  periodEnd: Date;
  invoiceUrl?: string;
}

export async function sendReceiptEmail({ to, restaurantName, amountMxn, periodEnd, invoiceUrl }: ReceiptEmailParams) {
  const nextStr = periodEnd.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

  const content = `
    <div class="content-pad" style="padding: 32px 28px;">
      <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #1c1917;">Pago confirmado ✓</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        Gracias, <strong>${escapeHtml(restaurantName)}</strong>. Recibimos tu pago de <strong>${mxnFmt(amountMxn)}</strong>.
      </p>
      <div style="padding: 16px; background: #faf8f6; border-radius: 12px; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 14px; color: #57534e;">Próximo cobro: <strong style="color: #1c1917;">${escapeHtml(nextStr)}</strong></p>
      </div>
      ${invoiceUrl ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="border: 1px solid #1c1917; border-radius: 10px;">
          <a href="${invoiceUrl}" style="display: inline-block; padding: 12px 24px; color: #1c1917; text-decoration: none; font-weight: 600; font-size: 14px;">
            Ver recibo
          </a>
        </td></tr>
      </table>` : ''}
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `Recibo de RateTap — ${mxnFmt(amountMxn)}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendReceiptEmail] failed to ${to}: ${reason}`);
  }
}

interface PaymentFailedEmailParams {
  to: string;
  restaurantName: string;
  amountMxn: number;
  updatePaymentUrl: string;
}

export async function sendPaymentFailedEmail({ to, restaurantName, amountMxn, updatePaymentUrl }: PaymentFailedEmailParams) {
  const content = `
    <div class="content-pad" style="padding: 32px 28px;">
      <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #b91c1c;">No pudimos procesar tu pago</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #57534e;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, intentamos cobrar <strong>${mxnFmt(amountMxn)}</strong> a tu tarjeta pero fue rechazada. Actualiza tu método de pago para seguir usando RateTap.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #1c1917; border-radius: 10px;">
          <a href="${updatePaymentUrl}" style="display: inline-block; padding: 13px 28px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px;">
            Actualizar tarjeta
          </a>
        </td></tr>
      </table>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `Problema con tu pago de RateTap`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendPaymentFailedEmail] failed to ${to}: ${reason}`);
  }
}

// ── Owner (Lawrence) notifications ───────────────────────────

interface OwnerSignupParams {
  restaurantName: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  slug: string;
  googlePlaceId?: string;
}

interface OwnerLeadParams {
  leadId: number;
  businessName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  source?: string | null;
  offer?: string | null;
  landingPath?: string | null;
  nextAction?: string | null;
}

export async function sendOwnerLeadNotification(p: OwnerLeadParams) {
  if (!OWNER_NOTIFICATION_EMAIL) {
    console.error('[sendOwnerLeadNotification] skipped: missing OWNER_NOTIFICATION_EMAIL / ADMIN_EMAIL');
    return;
  }

  const sourceLine = [p.source, p.offer].filter(Boolean).join(' / ') || 'unknown';
  const contactLine = [
    p.contactName ? escapeHtml(p.contactName) : 'Sin nombre',
    p.phone ? `<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>` : 'Sin teléfono',
    p.email ? `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : 'Sin email',
  ].join('<br>');

  const content = `
    <div class="content-pad" style="padding: 28px 24px;">
      <h1 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #1c1917;">Nuevo lead comercial</h1>
      <p style="margin: 0 0 18px; color: #57534e; line-height: 1.5;">
        ${p.nextAction ? escapeHtml(p.nextAction) : 'Contactar este lead hoy.'}
      </p>
      <table cellpadding="6" cellspacing="0" style="width: 100%; font-size: 14px; color: #1c1917;">
        <tr><td style="color: #78716c;">Negocio</td><td><strong>${escapeHtml(p.businessName)}</strong></td></tr>
        <tr><td style="color: #78716c;">Contacto</td><td>${contactLine}</td></tr>
        <tr><td style="color: #78716c;">Ciudad</td><td>${escapeHtml(p.city ?? 'Sin ciudad')}</td></tr>
        <tr><td style="color: #78716c;">Fuente</td><td>${escapeHtml(sourceLine)}</td></tr>
        <tr><td style="color: #78716c;">Landing</td><td><code>${escapeHtml(p.landingPath ?? 'unknown')}</code></td></tr>
        <tr><td style="color: #78716c;">Lead</td><td>#${p.leadId}</td></tr>
      </table>
      <p style="margin: 20px 0 0;">
        <a href="${BASE_URL}/commercial-leads" style="display: inline-block; background: #1c1917; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 16px; border-radius: 8px;">
          Abrir pipeline comercial
        </a>
      </p>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to: OWNER_NOTIFICATION_EMAIL,
    subject: `Nuevo lead: ${p.businessName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendOwnerLeadNotification] failed to ${OWNER_NOTIFICATION_EMAIL}: ${reason}`);
  }
}

export async function sendOwnerSignupNotification(p: OwnerSignupParams) {
  if (!OWNER_NOTIFICATION_EMAIL) {
    console.error('[sendOwnerSignupNotification] skipped: missing OWNER_NOTIFICATION_EMAIL / ADMIN_EMAIL');
    return;
  }

  const content = `
    <div class="content-pad" style="padding: 28px 24px;">
      <h1 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #1c1917;">🎉 Nuevo signup</h1>
      <table cellpadding="6" cellspacing="0" style="width: 100%; font-size: 14px; color: #1c1917;">
        <tr><td style="color: #78716c;">Negocio</td><td><strong>${escapeHtml(p.restaurantName)}</strong></td></tr>
        <tr><td style="color: #78716c;">Contacto</td><td>${escapeHtml(p.contactName)}</td></tr>
        <tr><td style="color: #78716c;">Email</td><td><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></td></tr>
        <tr><td style="color: #78716c;">Teléfono</td><td>${escapeHtml(p.phone)}</td></tr>
        <tr><td style="color: #78716c;">Ciudad</td><td>${escapeHtml(p.city)}</td></tr>
        <tr><td style="color: #78716c;">Slug</td><td><code>${escapeHtml(p.slug)}</code></td></tr>
        ${p.googlePlaceId ? `<tr><td style="color: #78716c;">Place ID</td><td><code>${escapeHtml(p.googlePlaceId)}</code></td></tr>` : ''}
      </table>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to: OWNER_NOTIFICATION_EMAIL,
    subject: `🎉 Nuevo signup: ${p.restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendOwnerSignupNotification] failed to ${OWNER_NOTIFICATION_EMAIL}: ${reason}`);
  }
}

interface OwnerConversionParams {
  restaurantName: string;
  contactName: string;
  email: string;
  phone: string;
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    notes?: string;
  };
  amountMxn: number;
}

export async function sendOwnerConversionNotification(p: OwnerConversionParams) {
  if (!OWNER_NOTIFICATION_EMAIL) {
    console.error('[sendOwnerConversionNotification] skipped: missing OWNER_NOTIFICATION_EMAIL / ADMIN_EMAIL');
    return;
  }

  const addr = p.shippingAddress;
  const addressLines = [
    addr.line1,
    addr.line2,
    `${addr.city}, ${addr.state} ${addr.postalCode}`,
    addr.notes ? `Notas: ${addr.notes}` : null,
  ].filter(Boolean).join('<br>');

  const content = `
    <div class="content-pad" style="padding: 28px 24px;">
      <h1 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #16a34a;">💰 Conversión — enviar tarjetas NFC</h1>
      <p style="margin: 0 0 16px; font-size: 15px; color: #1c1917;">
        <strong>${escapeHtml(p.restaurantName)}</strong> pagó ${mxnFmt(p.amountMxn)}. Enviar tarjetas NFC físicas a:
      </p>
      <div style="padding: 16px; background: #faf8f6; border-radius: 10px; margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #1c1917;">
        <strong>${escapeHtml(p.contactName)}</strong><br>
        ${addressLines}
      </div>
      <p style="margin: 0; font-size: 13px; color: #78716c;">
        Contacto: <a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a> · ${escapeHtml(p.phone)}
      </p>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to: OWNER_NOTIFICATION_EMAIL,
    subject: `💰 Conversión + envío: ${p.restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendOwnerConversionNotification] failed to ${OWNER_NOTIFICATION_EMAIL}: ${reason}`);
  }
}

interface OwnerLapsedParams {
  restaurantName: string;
  contactName: string | null;
  email: string | null;
}

export async function sendOwnerTrialLapsedNotification(p: OwnerLapsedParams) {
  if (!OWNER_NOTIFICATION_EMAIL) {
    console.error('[sendOwnerTrialLapsedNotification] skipped: missing OWNER_NOTIFICATION_EMAIL / ADMIN_EMAIL');
    return;
  }

  const content = `
    <div class="content-pad" style="padding: 28px 24px;">
      <h1 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #78716c;">😞 Prueba expirada sin pago</h1>
      <p style="margin: 0 0 8px; font-size: 15px; color: #1c1917;">
        <strong>${escapeHtml(p.restaurantName)}</strong> no convirtió. Cuenta desactivada.
      </p>
      ${p.contactName ? `<p style="margin: 0; font-size: 13px; color: #78716c;">Contacto: ${escapeHtml(p.contactName)}${p.email ? ` · <a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : ''}</p>` : ''}
    </div>`;

  const result = await sendMail({
    from: FROM,
    to: OWNER_NOTIFICATION_EMAIL,
    subject: `Prueba expirada: ${p.restaurantName}`,
    html: emailLayout(content),
  });

  if (!result.success || result.skipped) {
    const reason = result.error
      ? result.error.message
      : result.skipped
        ? 'missing SMTP_USER / SMTP_PASS'
        : (result.response ?? 'unknown');
    console.error(`[sendOwnerTrialLapsedNotification] failed to ${OWNER_NOTIFICATION_EMAIL}: ${reason}`);
  }
}
