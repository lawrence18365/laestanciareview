import { sendMail } from '@/lib/mailer';
import { formatStaffAnomaly, type StaffAnomaly } from '@/lib/anomalies';
import { RATING_BASELINE_NOTE } from '@/lib/rating-baseline';
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
  from?: string;
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
  from,
  replyTo,
  attachments,
  headers,
}: SendEmailOptions): Promise<{ provider: 'smtp'; data?: { id?: string } }> {
  const config = getOutreachSmtpConfig();
  if (!config) {
    throw new Error('SMTP_USER or SMTP_PASS not set');
  }

  const options: SendMailOptions = {
    from: from ?? FROM,
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

/** Editorial system face for every figure: counts, amounts, ratings, deltas. */
const FIGURE_STYLE = "font-variant-numeric: tabular-nums; font-family: 'SFMono-Regular', Consolas, Menlo, monospace;";

/**
 * Wrap a figure in the mono face so columns of numbers line up. This is for
 * figures embedded in a line of text — KPI values and table cells carry the
 * face on the element itself. Pass internal numbers or already-escaped
 * strings, never raw user input.
 */
function figure(value: string): string {
  return `<span style="${FIGURE_STYLE}">${value}</span>`;
}

/** Large display figure: Playfair, tabular numerals. */
const DISPLAY_FIGURE_STYLE = "font-variant-numeric: tabular-nums; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-weight: 700;";

/** Section label: 11px, 700, letterspaced uppercase, muted. */
const SECTION_LABEL_STYLE = 'font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;';

/** The one CTA shape in the system. */
const CTA_STYLE = 'display: inline-block; padding: 14px 36px; background: #111111; color: #ffffff; border-radius: 0; text-decoration: none; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;';

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
  <!-- Playfair Display is the display face for headings and KPI numerals.
       Apple Mail and Gmail read this link tag. The import rule at the top of
       the style block below is the fallback other clients need. Outlook
       renders with Word and drops both, falling back to Georgia, which is
       correct and fine. -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');
    :root { color-scheme: light dark; }
    body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    /* Inner rules between KPI tiles. */
    .stat-tile { border-left: 1px solid #E2E2E2; }
    .stat-tile:first-child { border-left: 0; }
    @media only screen and (max-width: 480px) {
      .email-container { width: 100% !important; padding: 16px 12px !important; }
      .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
      /* Pre-existing weekly-digest stat cells keep their mobile size. */
      .stat-value { font-size: 22px !important; }
      /* Tiles go 2x2 rather than shrinking into one squeezed row. */
      .stat-tile { display: inline-block !important; width: 50% !important; border-left: 0 !important; }
      /* Regional metric grids go 4-across to 2-across. */
      .metric-cell { display: inline-block !important; width: 50% !important; }
      /* The parents have to stop being a table too, or the engine rebuilds
         each cell as its own row and the two-across rules above do nothing. */
      .stack-table { display: block !important; width: 100% !important; }
      .stack-row   { display: block !important; width: 100% !important; }
      /* Two cells are exactly 50% wide, and the markup's whitespace between
         them adds a space on top of that, which pushes the pair past 100% and
         wraps it back to one per line. Collapsing the row's own text is
         invisible here: every string inside those cells sets its own px size. */
      .stack-row { font-size: 0 !important; }
      /* Owner briefing activity table keeps 4 of its 5 columns on phones;
         the waiter count goes, the scan delta stays. */
      .col-meseros { display: none !important; }
    }
  </style>
</head>
<body class="body" style="margin: 0; padding: 0; background: #F9F9F8; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background: #F9F9F8;">
    <tr><td align="center" class="email-container" style="padding: 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px;">

        <!-- Logo Header -->
        <tr><td style="padding: 0 0 28px; text-align: center;">
          <a href="${BASE_URL}" style="text-decoration: none;">
            <img src="${LOGO_URL}" alt="RateTap" width="160" style="display: inline-block; width: 160px; height: auto; background: #ffffff; padding: 12px 16px; border-radius: 0;" />
          </a>
        </td></tr>

        <!-- Content Card -->
        <tr><td class="content-card" style="background: #ffffff; border: 1px solid #111111; border-radius: 0;">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding: 28px 16px 0; text-align: center;">
          ${footerNote ? `<p style="margin: 0 0 8px; font-size: 12px; color: #A3A3A3;">${footerNote}</p>` : ''}
          <p style="margin: 0; font-size: 11px; color: #A3A3A3;">
            <a href="${BASE_URL}" style="color: #A3A3A3; text-decoration: none;">RateTap</a> &middot; Califica. Conecta. Crece.
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
  subjectPrefix?: string;
}

export async function sendFeedbackAlert({
  to,
  restaurantName,
  customerName,
  customerEmail,
  rating,
  staffName,
  feedback,
  subjectPrefix,
}: FeedbackAlertParams) {
  const filledStars = '★'.repeat(rating);
  const emptyStars = '☆'.repeat(5 - rating);
  const accentColor = rating >= 4 ? '#059669' : rating >= 3 ? '#D97706' : '#DC2626';
  const accentBg = rating >= 4 ? 'rgba(5,150,105,0.08)' : rating >= 3 ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)';
  const urgencyLabel = rating <= 2 ? 'Urgente' : rating <= 3 ? 'Atención' : 'Positivo';

  const content = `
    <!-- Colored accent bar -->
    <div style="height: 4px; background: ${accentColor}; border-radius: 0;"></div>

    <div class="content-pad" style="padding: 28px 32px 32px;">
      <!-- Rating badge -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; padding: 10px 24px; background: ${accentBg}; border: 1px solid #111111; border-radius: 0;">
          <span style="font-size: 24px; letter-spacing: 3px; color: ${accentColor};">${filledStars}</span><span style="font-size: 24px; letter-spacing: 3px; color: #E2E2E2;">${emptyStars}</span>
        </div>
        <p style="margin: 8px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${accentColor};">${urgencyLabel}</p>
      </div>

      <!-- Restaurant name -->
      <h1 style="margin: 0 0 4px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #111111; text-align: center;">${escapeHtml(restaurantName)}</h1>
      <p style="margin: 0 0 24px; font-size: 13px; color: #A3A3A3; text-align: center;">Nuevo comentario de cliente</p>

      <!-- Feedback quote -->
      <div style="margin: 0 0 24px; padding: 20px 24px; background: #FFFFFF; border: 1px solid #111111; border-left: 6px solid ${accentColor}; border-radius: 0;">
        <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #111111; font-style: italic;">&ldquo;${escapeHtml(feedback)}&rdquo;</p>
      </div>

      <!-- Details cards -->
      ${customerName || staffName || customerEmail ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        ${customerName ? `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #E2E2E2;">
            <span style="${SECTION_LABEL_STYLE}">Cliente</span><br/>
            <span style="font-size: 15px; font-weight: 500; color: #111111;">${escapeHtml(customerName)}</span>
          </td>
        </tr>` : ''}
        ${customerEmail ? `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #E2E2E2;">
            <span style="${SECTION_LABEL_STYLE}">Email</span><br/>
            <a href="mailto:${encodeURIComponent(customerEmail)}" style="font-size: 15px; color: #D97706; text-decoration: none; font-weight: 500;">${escapeHtml(customerEmail)}</a>
          </td>
        </tr>` : ''}
        ${staffName ? `
        <tr>
          <td style="padding: 10px 0;">
            <span style="${SECTION_LABEL_STYLE}">Mesero</span><br/>
            <span style="font-size: 15px; font-weight: 500; color: #111111;">${escapeHtml(staffName)}</span>
          </td>
        </tr>` : ''}
      </table>` : ''}

      <!-- CTA -->
      <div style="text-align: center;">
        <a href="${BASE_URL}/inbox" style="${CTA_STYLE}">
          Ver en Buzón
        </a>
      </div>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `${subjectPrefix ? `${subjectPrefix} ` : ''}${rating <= 2 ? '🔴' : rating <= 3 ? '🟡' : '🟢'} Nuevo comentario de ${rating} estrellas: ${restaurantName}`,
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
  staffAnomalies?: StaffAnomaly[];
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
  staffAnomalies = [],
  dashboardUrl,
  googleTrend,
}: WeeklyDigestParams) {
  const reviewsDelta = lastWeek.totalReviews - weekBefore.totalReviews;
  const ratingDelta = lastWeek.avgRating && weekBefore.avgRating
    ? (lastWeek.avgRating - weekBefore.avgRating).toFixed(1)
    : null;

  const delta = (d: number) => d > 0 ? `<span style="color:#059669;font-size:12px;${FIGURE_STYLE}">+${d}</span>` : d < 0 ? `<span style="color:#DC2626;font-size:12px;${FIGURE_STYLE}">${d}</span>` : '';
  const ratingD = (d: string | null) => {
    if (!d) return '';
    const n = parseFloat(d);
    if (n > 0) return `<span style="color:#059669;font-size:12px;${FIGURE_STYLE}">+${d}</span>`;
    if (n < 0) return `<span style="color:#DC2626;font-size:12px;${FIGURE_STYLE}">${d}</span>`;
    return '';
  };

  // One bordered panel with hairlines between the tiles, the same shape the
  // briefings use, rather than three tinted cells sharing rounded corners.
  const statCell = (value: string, label: string, extra: string) => `<td class="stat-tile" valign="top" style="box-sizing: border-box; padding: 16px 10px; text-align: center; width: 33%;">
      <p class="stat-value" style="margin: 0; font-size: 30px; line-height: 1; color: #111111; ${DISPLAY_FIGURE_STYLE}">${value}</p>
      <p style="margin: 6px 0 0; ${SECTION_LABEL_STYLE}">${label}</p>
      ${extra ? `<p style="margin: 4px 0 0;">${extra}</p>` : ''}
    </td>`;

  const leaderboardRows = topPerformers.length > 0
    ? topPerformers.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `<tr>
        <td style="padding: 10px 16px; border-top: 1px solid #E2E2E2; font-size: 14px;">
          ${medal} <strong>${p.staffName ?? 'Desconocido'}</strong>
        </td>
        <td style="padding: 10px 16px; border-top: 1px solid #E2E2E2; font-size: 14px; text-align: right; color: #D97706; font-weight: 600; ${FIGURE_STYLE}">
          ${p.avgRating.toFixed(1)} ★
        </td>
        <td style="padding: 10px 16px; border-top: 1px solid #E2E2E2; font-size: 13px; text-align: right; color: #666666;">
          ${figure(String(p.reviewCount))} opiniones capturadas
        </td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="3" style="padding: 16px; color: #A3A3A3; font-style: italic; font-size: 14px; text-align: center;">Sin opiniones capturadas la semana pasada</td></tr>`;

  const staffAnomalySection = staffAnomalies.length > 0 ? `
    <div style="margin: 0 28px 24px; padding: 16px; background: rgba(217,119,6,0.08); border: 1px solid #111111; border-left: 6px solid #D97706; border-radius: 0;">
      <p style="margin: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Cambios anormales esta semana</p>
      ${staffAnomalies.map((person) => `
        <p style="margin: 5px 0; font-size: 14px; color: #111111;">
          ${escapeHtml(formatStaffAnomaly(person))}
        </p>`).join('')}
      <p style="margin: 12px 0 0; font-size: 13px; color: #666666;">Confirme con el gerente si hubo cambio de turno, vacaciones o tarjeta perdida.</p>
    </div>` : '';

  const googleBanner = googleTrend && googleTrend.ratingChange !== 0 ? `
    <div style="margin: 0 28px 20px; padding: 20px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0; text-align: center;">
      <p style="margin: 0 0 8px; ${SECTION_LABEL_STYLE}">Calificacion de Google</p>
      <p style="margin: 0;">
        <span style="color: #A3A3A3; font-size: 18px; ${FIGURE_STYLE}">${googleTrend.baselineRating.toFixed(1)}</span>
        <span style="color: #E2E2E2; padding: 0 8px;">→</span>
        <span style="font-size: 32px; color: #111111; ${DISPLAY_FIGURE_STYLE}">${googleTrend.currentRating.toFixed(1)}</span>
        <span style="font-size: 20px; color: #D97706;"> ★</span>
        <span style="font-size: 16px; font-weight: 700; color: ${googleTrend.ratingChange > 0 ? '#059669' : '#DC2626'}; padding-left: 6px; ${FIGURE_STYLE}">
          ${googleTrend.ratingChange > 0 ? '+' : ''}${googleTrend.ratingChange.toFixed(1)}
        </span>
      </p>
      ${googleTrend.reviewsGained > 0 ? `<p style="margin: 6px 0 0; font-size: 12px; color: #666666;">${figure('+' + googleTrend.reviewsGained)} nuevas reseñas en Google</p>` : ''}
      <p style="margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #A3A3A3;">${RATING_BASELINE_NOTE}</p>
    </div>` : '';

  const interceptedBanner = lastWeek.intercepted > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: rgba(217,119,6,0.08); border: 1px solid #111111; border-left: 6px solid #D97706; border-radius: 0;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #D97706;">
        ${figure(String(lastWeek.intercepted))} ${lastWeek.intercepted === 1 ? 'calificación bajo el umbral sin clic registrado a Google' : 'calificaciones bajo el umbral sin clic registrado a Google'} esta semana
      </p>
      <p style="margin: 6px 0 0;"><a href="${BASE_URL}/inbox" style="font-size: 12px; color: #D97706; text-decoration: underline;">Ver detalle en Buzón →</a></p>
    </div>` : '';

  const unresolvedBanner = unresolvedCount > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: rgba(102,102,102,0.08); border: 1px solid #111111; border-left: 6px solid #A3A3A3; border-radius: 0;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111111;">
        ${figure(String(unresolvedCount))} ${unresolvedCount === 1 ? 'comentario privado todavía marcado' : 'comentarios privados todavía marcados'} como Nuevo
      </p>
    </div>` : '';

  const content = `
    <!-- Header -->
    <div style="padding: 28px 28px 4px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Resumen Semanal</p>
      <h1 style="margin: 0; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">${escapeHtml(restaurantName)}</h1>
    </div>

    ${googleBanner}

    <!-- Stats -->
    <div style="padding: 20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border: 1px solid #111111; border-radius: 0;">
        <tr>
          ${statCell(String(lastWeek.totalReviews), 'Opiniones capturadas', delta(reviewsDelta))}
          ${statCell(lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--', 'Calif. Prom.', ratingD(ratingDelta))}
          ${statCell(String(lastWeek.googleSends), 'Clics a Google', '')}
        </tr>
      </table>
    </div>

    ${interceptedBanner}
    ${unresolvedBanner}
    ${staffAnomalySection}

    <!-- Leaderboard -->
    <div style="margin: 0 28px 24px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0;">
      <p style="margin: 0; padding: 14px 16px 10px; ${SECTION_LABEL_STYLE}">Top meseros por experiencia del cliente</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${leaderboardRows}
      </table>
    </div>

    <!-- CTA -->
    <div style="padding: 0 28px 32px; text-align: center;">
      <a href="${dashboardUrl}" style="${CTA_STYLE}">
        Abrir Panel
      </a>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal: ${restaurantName}, ${lastWeek.totalReviews} opiniones capturadas, ${lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--'} prom`,
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
  topStaff: { name: string; avgRating: number; reviewCount: number }[];
  staffAnomalies: StaffAnomaly[];
  complaints: {
    received: number;
    resolvedWithin24h: number;
    overdueOpen: number;
    overdue: {
      rating: number;
      hoursOpen: number;
      feedbackPreview: string;
    }[];
  };
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
    <div style="margin: 0 28px 20px; padding: 20px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0;">
      <p style="margin: 0 0 12px; ${SECTION_LABEL_STYLE}">Cambios en Google</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${movers.map((l) => {
          const color = (l.ratingChange ?? 0) > 0 ? '#059669' : '#DC2626';
          const sign = (l.ratingChange ?? 0) > 0 ? '+' : '';
          return `<tr style="border-top: 1px solid #E2E2E2;">
            <td style="padding: 8px 0; font-size: 14px; color: #111111;">${l.name}</td>
            <td style="padding: 8px 0; font-size: 14px; text-align: right; font-weight: 600; color: #D97706; ${FIGURE_STYLE}">${l.currentRating != null ? l.currentRating.toFixed(1) + ' ★' : '--'}</td>
            <td style="padding: 8px 0; font-size: 14px; text-align: right; font-weight: 700; color: ${color}; ${FIGURE_STYLE}">${sign}${(l.ratingChange ?? 0).toFixed(1)}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>` : '';

  const interceptedBanner = totalIntercepted > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: rgba(217,119,6,0.08); border: 1px solid #111111; border-left: 6px solid #D97706; border-radius: 0;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #D97706;">
        ${figure(String(totalIntercepted))} ${totalIntercepted === 1 ? 'calificación bajo el umbral sin clic registrado a Google' : 'calificaciones bajo el umbral sin clic registrado a Google'} en todas las ubicaciones
      </p>
      <p style="margin: 6px 0 0;"><a href="${BASE_URL}/intercepted" style="font-size: 12px; color: #D97706; text-decoration: underline;">Ver detalle por ubicación →</a></p>
    </div>` : '';

  const unresolvedBanner = totalUnresolved > 0 ? `
    <div style="margin: 0 28px 16px; padding: 14px 18px; background: rgba(102,102,102,0.08); border: 1px solid #111111; border-left: 6px solid #A3A3A3; border-radius: 0;">
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111111;">
        ${figure(String(totalUnresolved))} ${totalUnresolved === 1 ? 'comentario privado todavía marcado' : 'comentarios privados todavía marcados'} como Nuevo en todas las ubicaciones
      </p>
    </div>` : '';

  const sorted = [...locations].sort((a, b) => (a.avgRating || 99) - (b.avgRating || 99));

  const locationRows = sorted.map((l) => {
    const ratingColor = l.avgRating >= 4 ? '#059669' : l.avgRating >= 3 ? '#D97706' : '#DC2626';
    const unresolvedBadge = l.unresolved > 0
      ? `<span style="display:inline-block;padding:2px 7px;border:1px solid #111111;border-radius:0;font-size:11px;font-weight:700;background:rgba(102,102,102,0.08);color:#666666;margin-left:6px;">${figure(String(l.unresolved))} con estado Nuevo</span>`
      : '';
    const topStaffLine = l.topStaff.length > 0
      ? `<div style="margin-top:4px;font-size:11px;font-weight:400;color:#666666;">Top: ${l.topStaff.map((person) => `${escapeHtml(person.name)} (${person.avgRating.toFixed(1)}★, ${person.reviewCount})`).join(', ')}</div>`
      : '';
    const staffAnomalyLine = l.staffAnomalies.length > 0
      ? `<div style="margin-top:3px;font-size:11px;font-weight:600;color:#D97706;">Cambios anormales: ${l.staffAnomalies.map((person) => escapeHtml(formatStaffAnomaly(person))).join(' ')}</div>`
      : '';
    const resolvedPercent = l.complaints.received > 0
      ? Math.round((l.complaints.resolvedWithin24h / l.complaints.received) * 100)
      : 0;
    const complaintLine = `<div style="margin-top:5px;font-size:11px;font-weight:600;color:${l.complaints.overdueOpen > 0 ? '#D97706' : '#666666'};">Quejas: ${figure(String(l.complaints.received))} recibidas, ${figure(String(resolvedPercent) + '%')} atendidas en menos de 24 h, ${figure(String(l.complaints.overdueOpen))} vencidas</div>`;
    const overdueLines = l.complaints.overdue.length > 0
      ? `<div style="margin-top:4px;font-size:11px;font-weight:400;color:#D97706;">${l.complaints.overdue.slice(0, 3).map((complaint) => `${figure(String(complaint.rating))} ${complaint.rating === 1 ? 'estrella' : 'estrellas'}, ${figure(String(complaint.hoursOpen))} h abierta: &ldquo;${escapeHtml(complaint.feedbackPreview)}&rdquo;`).join('<br/>')}</div>`
      : '';
    return `<tr style="border-top: 1px solid #E2E2E2;">
      <td style="padding: 10px 14px; font-size: 14px; font-weight: 500; color: #111111;">${escapeHtml(l.name)}${unresolvedBadge}${topStaffLine}${staffAnomalyLine}${complaintLine}${overdueLines}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #111111; ${FIGURE_STYLE}">${l.reviews}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: ${ratingColor}; font-weight: 700; ${FIGURE_STYLE}">${l.avgRating ? l.avgRating.toFixed(1) + ' ★' : '--'}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #666666; ${FIGURE_STYLE}">${l.googleSends}</td>
      <td style="padding: 10px 14px; font-size: 14px; text-align: right; color: #D97706; font-weight: 600; ${FIGURE_STYLE}">${l.intercepted > 0 ? l.intercepted : '-'}</td>
    </tr>`;
  }).join('');

  const content = `
    <!-- Header -->
    <div style="padding: 28px 28px 4px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Resumen del Propietario</p>
      <h1 style="margin: 0; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">${locations.length} Ubicaciones</h1>
    </div>

    <!-- Totals -->
    <div style="padding: 20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack-table" style="background: #ffffff; border: 1px solid #111111; border-radius: 0;">
        <tr class="stack-row">
          ${statTile('Opiniones capturadas', String(totalReviews))}
          ${statTile('Calif. Prom.', overallAvg)}
          ${statTile('Ubicaciones', String(locations.length))}
        </tr>
      </table>
    </div>

    ${googleMoversBanner}
    ${interceptedBanner}
    ${unresolvedBanner}

    <!-- Locations Table -->
    <div style="margin: 0 28px 24px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr>
            <th style="padding: 12px 14px; text-align: left; ${SECTION_LABEL_STYLE}">Ubicacion</th>
            <th style="padding: 12px 14px; text-align: right; ${SECTION_LABEL_STYLE}">Opiniones capturadas</th>
            <th style="padding: 12px 14px; text-align: right; ${SECTION_LABEL_STYLE}">Prom</th>
            <th style="padding: 12px 14px; text-align: right; ${SECTION_LABEL_STYLE}">Clics a Google</th>
            <th style="padding: 12px 14px; text-align: right; ${SECTION_LABEL_STYLE}">Bajo umbral sin clic</th>
          </tr>
        </thead>
        <tbody>
          ${locationRows}
        </tbody>
      </table>
    </div>

    <!-- CTA -->
    <div style="padding: 0 28px 32px; text-align: center;">
      <a href="${dashboardUrl}" style="${CTA_STYLE}">
        Abrir Resumen
      </a>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📊 Resumen Semanal: ${totalReviews} opiniones capturadas, ${overallAvg} prom en ${locations.length} ubicaciones`,
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
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Seguridad</p>
      <h1 style="margin: 0 0 20px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">Restablecer Contraseña</h1>

      <p style="margin: 0 0 6px; font-size: 15px; line-height: 1.6; color: #111111;">
        Recibimos una solicitud para restablecer la contraseña de <strong>${escapeHtml(restaurantName)}</strong>.
      </p>
      <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #111111;">
        Haz clic en el boton de abajo para crear una nueva contraseña.
      </p>

      <div style="text-align: center; margin: 0 0 28px;">
        <a href="${resetUrl}" style="${CTA_STYLE}">
          Restablecer Contraseña
        </a>
      </div>

      <div style="padding: 16px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0;">
        <p style="margin: 0; font-size: 13px; color: #666666; line-height: 1.5;">
          Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, puedes ignorar este correo. Tu contraseña no sera modificada.
        </p>
      </div>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `🔐 Restablecer contraseña: ${restaurantName}`,
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
      <div style="width: 56px; height: 56px; margin: 0 auto 20px; background: rgba(5,150,105,0.08); border: 1px solid #111111; border-radius: 0; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 28px; color: #059669;">✓</span>
      </div>
      <h1 style="margin: 0 0 8px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">Email Configurado</h1>
      <p style="margin: 0; font-size: 15px; color: #111111; line-height: 1.5;">
        La integracion con SMTP esta funcionando correctamente. Los emails de RateTap se enviaran desde esta direccion.
      </p>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: '✅ RateTap: Email configurado correctamente',
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
        <span style="display: inline-block; padding: 4px 12px; border: 1px solid #111111; border-radius: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; background: rgba(37,99,235,0.08); color: #2563EB;">
          Nueva Funcion
        </span>
      </div>

      <h1 style="margin: 0 0 8px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">
        Notificaciones Push en tu Celular
      </h1>
      <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #111111;">
        Hola! Ahora <strong>${escapeHtml(restaurantName)}</strong> puede recibir alertas instantaneas cuando un cliente deje una resena negativa, directo en tu iPhone, como un mensaje de WhatsApp.
      </p>

      <div style="padding: 20px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0; margin-bottom: 24px;">
        <p style="margin: 0 0 12px; ${SECTION_LABEL_STYLE}">Como funciona</p>

        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 0; background: #111111; color: #ffffff; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0; ${FIGURE_STYLE}">1</span>
          <p style="margin: 0; font-size: 14px; color: #111111; line-height: 1.5;">Abre tu panel de RateTap en Safari en tu iPhone</p>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 0; background: #111111; color: #ffffff; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0; ${FIGURE_STYLE}">2</span>
          <p style="margin: 0; font-size: 14px; color: #111111; line-height: 1.5;">Agrega RateTap a tu pantalla de inicio (Compartir → Agregar a pantalla de inicio)</p>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <span style="display: inline-block; width: 24px; height: 24px; border-radius: 0; background: #111111; color: #ffffff; text-align: center; line-height: 24px; font-size: 13px; font-weight: 700; flex-shrink: 0; ${FIGURE_STYLE}">3</span>
          <p style="margin: 0; font-size: 14px; color: #111111; line-height: 1.5;">Abre RateTap desde la pantalla de inicio y toca <strong>"Activar Notificaciones"</strong></p>
        </div>
      </div>

      <div style="padding: 16px 20px; background: rgba(217,119,6,0.08); border: 1px solid #111111; border-left: 6px solid #D97706; border-radius: 0; margin-bottom: 28px;">
        <p style="margin: 0; font-size: 14px; color: #D97706; line-height: 1.5;">
          Cuando un cliente deje una resena de 3 estrellas o menos, recibiras una notificacion al instante en tu celular, para que puedas actuar de inmediato.
        </p>
      </div>

      <div style="text-align: center;">
        <a href="${BASE_URL}/dashboard" style="${CTA_STYLE}">
          Abrir Mi Panel
        </a>
      </div>
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `📱 Nuevo: Notificaciones push en tu celular (${restaurantName})`,
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
  bug: { bg: 'rgba(220,38,38,0.08)', text: '#DC2626', border: '#DC2626' },
  feature: { bg: 'rgba(217,119,6,0.08)', text: '#D97706', border: '#D97706' },
  feedback: { bg: 'rgba(5,150,105,0.08)', text: '#059669', border: '#059669' },
  question: { bg: 'rgba(37,99,235,0.08)', text: '#2563EB', border: '#2563EB' },
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
        <span style="display: inline-block; padding: 4px 12px; border: 1px solid #111111; border-radius: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; background: ${colors.bg}; color: ${colors.text};">
          ${label}
        </span>
      </div>

      <h1 style="margin: 0 0 6px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #111111;">${escapeHtml(subject || 'Sin asunto')}</h1>
      <p style="margin: 0 0 20px; color: #666666; font-size: 13px;">
        De <strong>${escapeHtml(restaurantName)}</strong> (${escapeHtml(restaurantSlug)})
      </p>

      <div style="padding: 20px; background: #FFFFFF; border: 1px solid #111111; border-left: 6px solid ${colors.border}; border-radius: 0;">
        <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #111111; white-space: pre-wrap;">${escapeHtml(message)}</p>
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 700; color: #111111;">¡Bienvenido a RateTap! 🎉</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, tu prueba gratis de ${trialDays} días ya está activa hasta el <strong>${escapeHtml(trialEndStr)}</strong>.
      </p>

      <div style="text-align: center; padding: 24px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0; margin: 0 0 20px;">
        <img src="${qrDataUrl}" alt="QR de ${escapeHtml(restaurantName)}" width="220" style="display: block; margin: 0 auto 12px; width: 220px; height: 220px; background: #fff; border: 1px solid #111111; border-radius: 0; padding: 8px;" />
        <p style="margin: 0 0 6px; ${SECTION_LABEL_STYLE}">Tu enlace personalizado:</p>
        <p style="margin: 0; font-size: 13px; font-weight: 600; color: #111111; word-break: break-all;">
          <a href="${reviewUrl}" style="color: #111111;">${escapeHtml(reviewUrl)}</a>
        </p>
      </div>

      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        ${pilot
          ? 'Imprime este QR y colócalo en tus mesas hoy mismo. Si decides continuar después del piloto, te enviaremos tus tarjetas NFC físicas.'
          : 'Imprime este QR y colócalo en tus mesas hoy mismo. En cuanto confirmes tu pago el día 15, te enviaremos tus tarjetas NFC físicas.'}
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #111111; border-radius: 0;">
          <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: 0.02em;">
            Entrar a mi panel
          </a>
        </td></tr>
      </table>

      <p style="margin: 24px 0 0; font-size: 13px; color: #A3A3A3; text-align: center; line-height: 1.5;">
        Tu página de reseñas: <a href="${reviewUrl}" style="color: #666666;">${escapeHtml(reviewUrl)}</a>
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">Tu prueba termina en ${daysLeft} días</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, en ${daysLeft} días cobraremos <strong style="${FIGURE_STYLE}">${mxnFmt(amountMxn)}</strong> a la tarjeta que registraste y seguirás usando RateTap sin interrupciones.
      </p>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        Si no quieres continuar, puedes cancelar desde tu panel antes de esa fecha y no se cobrará nada.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #111111; border-radius: 0;">
          <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: 0.02em;">
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #111111;">Pago confirmado ✓</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        Gracias, <strong>${escapeHtml(restaurantName)}</strong>. Recibimos tu pago de <strong style="${FIGURE_STYLE}">${mxnFmt(amountMxn)}</strong>.
      </p>
      <div style="padding: 16px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0; margin: 0 0 20px;">
        <p style="margin: 0; font-size: 14px; color: #666666;">Próximo cobro: <strong style="color: #111111;">${escapeHtml(nextStr)}</strong></p>
      </div>
      ${invoiceUrl ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #111111; border-radius: 0;">
          <a href="${invoiceUrl}" style="display: inline-block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; letter-spacing: 0.02em;">
            Ver recibo
          </a>
        </td></tr>
      </table>` : ''}
    </div>`;

  const result = await sendMail({
    from: FROM,
    to,
    subject: `Recibo de RateTap: ${mxnFmt(amountMxn)}`,
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #DC2626;">No pudimos procesar tu pago</h1>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
        Hola <strong>${escapeHtml(restaurantName)}</strong>, intentamos cobrar <strong style="${FIGURE_STYLE}">${mxnFmt(amountMxn)}</strong> a tu tarjeta pero fue rechazada. Actualiza tu método de pago para seguir usando RateTap.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr><td style="background: #111111; border-radius: 0;">
          <a href="${updatePaymentUrl}" style="display: inline-block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: 0.02em;">
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #111111;">Nuevo lead comercial</h1>
      <p style="margin: 0 0 18px; color: #666666; line-height: 1.5;">
        ${p.nextAction ? escapeHtml(p.nextAction) : 'Contactar este lead hoy.'}
      </p>
      <table cellpadding="6" cellspacing="0" style="width: 100%; font-size: 14px; color: #111111;">
        <tr><td style="${SECTION_LABEL_STYLE}">Negocio</td><td><strong>${escapeHtml(p.businessName)}</strong></td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Contacto</td><td>${contactLine}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Ciudad</td><td>${escapeHtml(p.city ?? 'Sin ciudad')}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Fuente</td><td>${escapeHtml(sourceLine)}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Landing</td><td><code>${escapeHtml(p.landingPath ?? 'unknown')}</code></td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Lead</td><td>${figure('#' + p.leadId)}</td></tr>
      </table>
      <p style="margin: 20px 0 0;">
        <a href="${BASE_URL}/commercial-leads" style="${CTA_STYLE}">
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #111111;">🎉 Nuevo signup</h1>
      <table cellpadding="6" cellspacing="0" style="width: 100%; font-size: 14px; color: #111111;">
        <tr><td style="${SECTION_LABEL_STYLE}">Negocio</td><td><strong>${escapeHtml(p.restaurantName)}</strong></td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Contacto</td><td>${escapeHtml(p.contactName)}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Email</td><td><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Teléfono</td><td>${escapeHtml(p.phone)}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Ciudad</td><td>${escapeHtml(p.city)}</td></tr>
        <tr><td style="${SECTION_LABEL_STYLE}">Slug</td><td><code>${escapeHtml(p.slug)}</code></td></tr>
        ${p.googlePlaceId ? `<tr><td style="${SECTION_LABEL_STYLE}">Place ID</td><td><code>${escapeHtml(p.googlePlaceId)}</code></td></tr>` : ''}
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #059669;">💰 Conversión: enviar tarjetas NFC</h1>
      <p style="margin: 0 0 16px; font-size: 15px; color: #111111;">
        <strong>${escapeHtml(p.restaurantName)}</strong> pagó <strong style="${FIGURE_STYLE}">${mxnFmt(p.amountMxn)}</strong>. Enviar tarjetas NFC físicas a:
      </p>
      <div style="padding: 16px; background: #FFFFFF; border: 1px solid #111111; border-radius: 0; margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #111111;">
        <strong>${escapeHtml(p.contactName)}</strong><br>
        ${addressLines}
      </div>
      <p style="margin: 0; font-size: 13px; color: #666666;">
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
      <h1 style="margin: 0 0 12px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #666666;">😞 Prueba expirada sin pago</h1>
      <p style="margin: 0 0 8px; font-size: 15px; color: #111111;">
        <strong>${escapeHtml(p.restaurantName)}</strong> no convirtió. Cuenta desactivada.
      </p>
      ${p.contactName ? `<p style="margin: 0; font-size: 13px; color: #666666;">Contacto: ${escapeHtml(p.contactName)}${p.email ? ` · <a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : ''}</p>` : ''}
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

// ────────────────────────────────────────────────────────────
// Weekly briefings — owner and regional
// ────────────────────────────────────────────────────────────
//
// Framed on guests, not reviews. The owner evaluates the business on real
// growth, growth vs Proforma, and guest growth; a review counter speaks to none
// of those, while guest capture and return rate speak to all three.
//
// Three rules hold in both emails, and they are load-bearing:
//   1. A location is never called inactive from scan volume alone. The signal
//      comes from lib/location-signal.ts, which crosses volume with how many
//      waiters actually captured anything.
//   2. No complaint-resolution counts. That metric measures an event that
//      essentially never happens, and it does not go in front of the owner
//      until the workflow fix lands.
//   3. Nothing here that we cannot defend in a room. Every number is a direct
//      count; where there is no baseline, the email says so instead of
//      inventing a comparison.

export interface BriefingLocation {
  name: string;
  /** Club VIP members on file, all time. */
  totalGuests: number;
  newGuestsThisWeek: number;
  /** Members with 2+ recorded visits. */
  returningGuests: number;
  courtesiesThisWeek: number;
  scansThisWeek: number;
  scansLastWeek: number;
  staffAskingThisWeek: number;
  staffAskingLastWeek: number;
  gmActiveDays: number;
  /** Reviews with feedback and a rating of 3 or less filed during the week. */
  complaintsThisWeek: number;
  /** Urgent complaints still open past the resolve target. */
  overdueComplaints: number;
  currentRating: number | null;
  baselineRating: number | null;
  /** From classifyLocation(): plain sentence, safe to show the owner. */
  signalSummary: string;
  signalLabel: string;
  /** True only when the numbers genuinely warrant a call. */
  actionable: boolean;
}

export interface BirthdayEntry {
  locationName: string;
  guestName: string;
  /** "DD/MM" */
  birthday: string;
}

function briefingWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  const f = (d: Date) => `${d.getDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()]}`;
  return `${f(weekStart)} – ${f(end)}`;
}

function statTile(label: string, value: string, note?: string): string {
  return `
    <td class="stat-tile" valign="top" style="box-sizing: border-box; padding: 18px 12px; text-align: center; vertical-align: top;">
      <div style="font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 30px; font-weight: 700; color: #111111; line-height: 1; font-variant-numeric: tabular-nums;">${value}</div>
      <div style="margin-top: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #666666;">${escapeHtml(label)}</div>
      ${note ? `<div style="margin-top: 5px; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 11px; color: #A3A3A3;">${escapeHtml(note)}</div>` : ''}
    </td>`;
}

/**
 * Numbered section heading: a large gold ordinal sitting to the left of the
 * uppercase section label, so the four blocks read as countable.
 */
function sectionHeading(ordinal: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 12px;">
      <tr>
        <td valign="bottom" style="padding: 0 10px 0 0; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; line-height: 0.9; color: #D97706;">${ordinal}</td>
        <td valign="bottom" style="padding-bottom: 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">${label}</td>
      </tr>
    </table>`;
}

/**
 * Owner briefing. One screen: what needs a decision, activity per location,
 * service load, the Club VIP guest book, and reputation.
 */
export async function sendOwnerBriefing({
  to,
  weekStart,
  locations,
  dashboardUrl,
}: {
  to: string;
  weekStart: Date;
  locations: BriefingLocation[];
  dashboardUrl: string;
}) {
  const activeCount = locations.filter((l) => l.scansThisWeek > 0).length;
  const scans = locations.reduce((s, l) => s + l.scansThisWeek, 0);
  const complaints = locations.reduce((s, l) => s + l.complaintsThisWeek, 0);
  const returning = locations.reduce((s, l) => s + l.returningGuests, 0);

  // Requiere decisión — silent locations first, then the rest of the alerts.
  const decisions = locations.filter((l) => l.actionable);
  const inactive = locations.filter((l) => l.signalLabel === 'Sin actividad');
  const otherDecisions = locations.filter((l) => l.actionable && l.signalLabel !== 'Sin actividad');
  const decisionBlock = decisions.length === 0
    ? `<div style="margin: 0 28px 10px; padding: 16px 18px; background: #ffffff; border: 1px solid #111111; border-left: 6px solid #059669; border-radius: 0;">
         <p style="margin: 0; font-size: 14px; color: #059669;">Las ${locations.length} ubicaciones registraron actividad esta semana.</p>
       </div>`
    : `
      ${inactive.length > 0 ? `
        <div style="margin: 0 28px 10px; padding: 16px 18px; background: #ffffff; border: 1px solid #111111; border-left: 6px solid #DC2626; border-radius: 0;">
          <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #DC2626;">${inactive.length} ${inactive.length === 1 ? 'ubicación' : 'ubicaciones'} sin actividad registrada en 14 días</p>
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #111111;">${inactive.map((l) => escapeHtml(l.name)).join(', ')}</p>
        </div>` : ''}
      ${otherDecisions.map((l) => `
        <div style="margin: 0 28px 10px; padding: 16px 18px; background: #ffffff; border: 1px solid #111111; border-left: 6px solid #D97706; border-radius: 0;">
          <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #111111;">${escapeHtml(l.name)}</p>
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #666666;">${escapeHtml(l.signalSummary)}</p>
        </div>`).join('')}`;

  // Block 1 — activity per location. Silent locations first, then alerts, then volume.
  const activityRank = (l: BriefingLocation) =>
    l.signalLabel === 'Sin actividad' ? 0 : l.actionable ? 1 : 2;
  const activityRows = [...locations]
    .sort((a, b) => activityRank(a) - activityRank(b) || b.scansThisWeek - a.scansThisWeek)
    .map((l) => {
      const delta = l.scansLastWeek > 0
        ? Math.round(((l.scansThisWeek - l.scansLastWeek) / l.scansLastWeek) * 100)
        : null;
      const deltaColor = delta == null ? '#A3A3A3' : delta >= 0 ? '#059669' : delta <= -25 ? '#DC2626' : '#D97706';
      const deltaText = delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta}%`;
      return `
        <tr style="border-top: 1px solid #E2E2E2;">
          <td style="padding: 9px 0; font-size: 14px; color: #111111;">${escapeHtml(l.name)}</td>
          <td style="padding: 9px 0; font-size: 14px; text-align: right; color: #111111; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${l.scansThisWeek}</td>
          <td style="padding: 9px 0; font-size: 13px; text-align: right; font-weight: 600; color: ${deltaColor}; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${deltaText}</td>
          <td class="col-meseros" style="padding: 9px 0; font-size: 13px; text-align: right; color: #666666; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${l.staffAskingThisWeek}</td>
          <td style="padding: 9px 0; font-size: 13px; text-align: right; font-weight: 600; color: ${l.signalLabel === 'Sin actividad' ? '#DC2626' : '#666666'};">${escapeHtml(l.signalLabel)}</td>
        </tr>`;
    }).join('');

  // Block 2 — service load. Only locations with something to show.
  const service = locations.filter((l) => l.complaintsThisWeek > 0 || l.overdueComplaints > 0);
  const serviceBlock = service.length === 0
    ? `<p style="margin: 0; font-size: 14px; color: #666666;">Sin quejas registradas esta semana.</p>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Ubicación</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Quejas (semana)</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Sin resolver +24h</td>
        </tr>
        ${service.map((l) => `
          <tr style="border-top: 1px solid #E2E2E2;">
            <td style="padding: 9px 0; font-size: 14px; color: #111111;">${escapeHtml(l.name)}</td>
            <td style="padding: 9px 0; font-size: 14px; text-align: right; color: #111111; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${l.complaintsThisWeek}</td>
            <td style="padding: 9px 0; font-size: 13px; text-align: right; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums; ${l.overdueComplaints > 0 ? 'font-weight: 700; color: #DC2626;' : 'color: #666666;'}">${l.overdueComplaints}</td>
          </tr>`).join('')}
      </table>`;

  // Block 3 — Club VIP guest book.
  const capturing = locations.filter((l) => l.totalGuests > 0);
  const guestRows = capturing.length === 0
    ? `<tr><td colspan="3" style="padding: 12px 0; font-size: 14px; color: #666666;">Ninguna ubicación tiene captura de invitados activa todavía.</td></tr>`
    : [...capturing]
        .sort((a, b) => b.totalGuests - a.totalGuests)
        .map((l) => `
          <tr style="border-top: 1px solid #E2E2E2;">
            <td style="padding: 9px 0; font-size: 14px; color: #111111;">${escapeHtml(l.name)}</td>
            <td style="padding: 9px 0; font-size: 14px; text-align: right; font-weight: 600; color: #111111; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${l.totalGuests}</td>
            <td style="padding: 9px 0; font-size: 14px; text-align: right; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums; color: ${l.newGuestsThisWeek > 0 ? '#059669' : '#A3A3A3'};">${l.newGuestsThisWeek > 0 ? '+' + l.newGuestsThisWeek : '—'}</td>
          </tr>`).join('');

  // Block 4 — reputation. Only locations with a real baseline to compare.
  const rated = locations.filter((l) => l.currentRating != null && l.baselineRating != null);
  const ratingRows = rated.length === 0
    ? `<tr><td colspan="4" style="padding: 12px 0; font-size: 14px; color: #666666;">Sin historial de Google suficiente para comparar todavía.</td></tr>`
    : rated.map((l) => {
        const delta = (l.currentRating ?? 0) - (l.baselineRating ?? 0);
        const color = delta > 0 ? '#059669' : delta < 0 ? '#DC2626' : '#666666';
        const sign = delta > 0 ? '+' : '';
        return `
          <tr style="border-top: 1px solid #E2E2E2;">
            <td style="padding: 9px 0; font-size: 14px; color: #111111;">${escapeHtml(l.name)}</td>
            <td style="padding: 9px 0; font-size: 14px; text-align: right; color: #666666; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${(l.baselineRating ?? 0).toFixed(2)}</td>
            <td style="padding: 9px 0; font-size: 14px; text-align: right; font-weight: 600; color: #111111; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${(l.currentRating ?? 0).toFixed(2)}</td>
            <td style="padding: 9px 0; font-size: 13px; text-align: right; font-weight: 700; color: ${color}; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${delta === 0 ? '—' : sign + delta.toFixed(2)}</td>
          </tr>`;
      }).join('');

  const content = `
    <div style="padding: 28px 28px 8px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Resumen semanal · ${escapeHtml(briefingWeekLabel(weekStart))}</p>
      <h1 style="margin: 0 0 4px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; color: #111111;">Grupo Estancia</h1>
      <p style="margin: 0; font-size: 14px; color: #666666;">${locations.length} ubicaciones</p>
    </div>

    <div style="padding: 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack-table" style="margin: 8px 0 20px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
        <tr class="stack-row">
          ${statTile('Ubicaciones activas', `${activeCount} de ${locations.length}`)}
          ${statTile('Escaneos', String(scans))}
          ${statTile('Quejas', String(complaints))}
          ${statTile('Socios VIP que regresaron', String(returning))}
        </tr>
      </table>
    </div>

    <div style="margin: 0 0 6px;">
      <p style="margin: 0 28px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Requiere decisión</p>
      ${decisionBlock}
    </div>

    <div style="margin: 0 28px 22px; padding: 18px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
      ${sectionHeading('1', 'Actividad por ubicación')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Ubicación</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Escaneos</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">vs sem.</td>
          <td class="col-meseros" style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Meseros</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Estado</td>
        </tr>
        ${activityRows}
      </table>
    </div>

    <div style="margin: 0 28px 22px; padding: 18px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
      ${sectionHeading('2', 'Quejas y servicio')}
      ${serviceBlock}
    </div>

    <div style="margin: 0 28px 22px; padding: 18px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
      ${sectionHeading('3', 'Socios del Club VIP')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Ubicación</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Total</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Esta semana</td>
        </tr>
        ${guestRows}
      </table>
      <div style="margin-top: 14px; padding: 14px 16px; background: rgba(5,150,105,0.08); border-left: 6px solid #059669; border-radius: 0;">
        <p style="margin: 0 0 4px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 30px; font-weight: 700; color: #059669; line-height: 1; font-variant-numeric: tabular-nums;">${returning}</p>
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #059669;">
          Socios del Club VIP identificados con visitas en dos o más días distintos. Es la parte identificada del tráfico que regresa, no el total de comensales que vuelven.
        </p>
      </div>
    </div>

    <div style="margin: 0 28px 22px; padding: 18px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
      ${sectionHeading('4', 'Reputación en Google')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Ubicación</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Inicio</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Hoy</td>
          <td style="padding: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; text-align: right;">Δ</td>
        </tr>
        ${ratingRows}
      </table>
      <p style="margin: 12px 0 0; font-size: 11px; line-height: 1.5; color: #A3A3A3;">${RATING_BASELINE_NOTE}</p>
    </div>

    <div style="text-align: center; margin: 24px 0 30px;">
      <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 36px; background: #111111; color: #ffffff; border-radius: 0; text-decoration: none; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;">Abrir panel</a>
    </div>`;

  return sendMail({
    from: FROM,
    to,
    subject: `Grupo Estancia · ${activeCount} de ${locations.length} ubicaciones activas, ${complaints} quejas esta semana`,
    html: emailLayout(content),
  });
}

/**
 * Regional briefing. Same discipline, scoped to one region, plus the week's
 * birthdays so the manager can push the Club VIP courtesy.
 */
export async function sendRegionalBriefing({
  to,
  regionName,
  weekStart,
  locations,
  birthdays,
  dashboardUrl,
}: {
  to: string;
  regionName: string;
  weekStart: Date;
  locations: BriefingLocation[];
  birthdays: BirthdayEntry[];
  dashboardUrl: string;
}) {
  const newGuests = locations.reduce((s, l) => s + l.newGuestsThisWeek, 0);
  const courtesies = locations.reduce((s, l) => s + l.courtesiesThisWeek, 0);
  const scans = locations.reduce((s, l) => s + l.scansThisWeek, 0);

  // Each location is a stacked block: Playfair name, its signal label under it,
  // then the seven metrics as label/value pairs, four across on desktop and two
  // across under the 480px media query. No table here exceeds four columns.
  const locationRows = locations.map((l) => {
    const delta = l.scansLastWeek > 0
      ? Math.round(((l.scansThisWeek - l.scansLastWeek) / l.scansLastWeek) * 100)
      : null;
    const deltaColor = delta == null ? '#A3A3A3' : delta >= 0 ? '#059669' : delta <= -25 ? '#DC2626' : '#D97706';
    const deltaText = delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta}%`;
    const metric = (label: string, value: string, color = '#111111') => `
            <td class="metric-cell" width="25%" valign="top" style="box-sizing: border-box; padding: 10px 12px 10px 0; border-top: 1px solid #E2E2E2; vertical-align: top;">
              <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">${label}</div>
              <div style="margin-top: 3px; font-size: 14px; color: ${color}; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${value}</div>
            </td>`;
    return `
      <div style="padding: 16px 0 6px; border-top: 1px solid #E2E2E2;">
        <div style="font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: 700; color: #111111;">${escapeHtml(l.name)}</div>
        <div style="margin-top: 3px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${l.signalLabel === 'Sin actividad' ? '#DC2626' : '#666666'};">${escapeHtml(l.signalLabel)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack-table" style="margin-top: 8px;">
          <tr class="stack-row">
            ${metric('Escaneos', String(l.scansThisWeek))}
            ${metric('vs sem.', deltaText, deltaColor)}
            ${metric('Google', l.currentRating != null ? l.currentRating.toFixed(2) : '—', l.currentRating != null ? '#111111' : '#A3A3A3')}
            ${metric('Socios', String(l.newGuestsThisWeek))}
          </tr>
          <tr class="stack-row">
            ${metric('Cort.', String(l.courtesiesThisWeek))}
            ${metric('Quejas', String(l.complaintsThisWeek))}
            ${metric('Gte.', `${l.gmActiveDays}d`, l.gmActiveDays > 1 ? '#059669' : '#A3A3A3')}
            <td class="metric-cell" width="25%" style="box-sizing: border-box; border-top: 1px solid #E2E2E2;"></td>
          </tr>
        </table>
      </div>`;
  }).join('');

  const pushBlock = locations
    .filter((l) => l.actionable || l.signalLabel === 'Menos volumen')
    .map((l) => `
      <div style="margin: 0 28px 10px; padding: 14px 18px; background: ${l.actionable ? 'rgba(217,119,6,0.08)' : '#ffffff'}; border: 1px solid #111111; border-left: 6px solid ${l.actionable ? '#D97706' : '#A3A3A3'}; border-radius: 0;">
        <p style="margin: 0 0 3px; font-size: 14px; font-weight: 700; color: #111111;">${escapeHtml(l.name)}</p>
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #666666;">${escapeHtml(l.signalSummary)}</p>
      </div>`).join('');

  const noPush = `
    <div style="margin: 0 28px 10px; padding: 14px 18px; background: rgba(5,150,105,0.08); border: 1px solid #111111; border-left: 6px solid #059669; border-radius: 0;">
      <p style="margin: 0; font-size: 14px; color: #059669;">Sin focos esta semana en tus ubicaciones.</p>
    </div>`;

  const birthdayBlock = birthdays.length === 0
    ? `<p style="margin: 0 28px 8px; font-size: 14px; color: #666666;">Sin cumpleaños en los próximos días.</p>`
    // Outlook renders with Word, which does not support calc(). Inset with a
    // wrapper table's padding instead of a computed width.
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding: 0 28px;">
        ${birthdays.map((b) => `
          <tr style="border-top: 1px solid #E2E2E2;">
            <td style="padding: 8px 0; font-size: 14px; color: #111111;">${escapeHtml(b.guestName)}</td>
            <td style="padding: 8px 0; font-size: 13px; color: #666666;">${escapeHtml(b.locationName)}</td>
            <td style="padding: 8px 0; font-size: 13px; text-align: right; font-weight: 600; color: #D97706; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-variant-numeric: tabular-nums;">${escapeHtml(b.birthday)}</td>
          </tr>`).join('')}
      </table>`;

  const content = `
    <div style="padding: 28px 28px 8px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #D97706;">Resumen semanal · ${escapeHtml(briefingWeekLabel(weekStart))}</p>
      <h1 style="margin: 0 0 4px; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; color: #111111;">${escapeHtml(regionName)}</h1>
      <p style="margin: 0; font-size: 14px; color: #666666;">${locations.length} ${locations.length === 1 ? 'ubicación' : 'ubicaciones'}</p>
    </div>

    <div style="padding: 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack-table" style="margin: 8px 0 20px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
        <tr class="stack-row">
          ${statTile('Escaneos', String(scans))}
          ${statTile('Socios nuevos', newGuests > 0 ? '+' + newGuests : '0')}
          ${statTile('Cortesías', String(courtesies))}
        </tr>
      </table>
    </div>

    <div style="margin: 0 28px 22px; padding: 18px; background: #ffffff; border: 1px solid #111111; border-radius: 0;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Tus ubicaciones</p>
      ${locationRows}
      <p style="margin: 12px 0 0; font-size: 11px; line-height: 1.5; color: #A3A3A3;">
        "Gte." son los días que el gerente abrió la app. Es contexto, no calificación: un gerente puede estar entrenando al piso todos los días sin abrirla.
      </p>
    </div>

    <p style="margin: 0 28px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Dónde empujar y por qué</p>
    ${pushBlock || noPush}

    <p style="margin: 22px 28px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666666;">Cumpleaños de la semana</p>
    ${birthdayBlock}

    <div style="text-align: center; margin: 24px 0 30px;">
      <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 36px; background: #111111; color: #ffffff; border-radius: 0; text-decoration: none; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;">Abrir panel</a>
    </div>`;

  return sendMail({
    from: FROM,
    to,
    subject: `${regionName} · ${scans} escaneos, ${birthdays.length} cumpleaños esta semana`,
    html: emailLayout(content),
  });
}
