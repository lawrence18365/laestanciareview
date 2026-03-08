import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM = process.env.EMAIL_FROM ?? 'RateTap <notifications@ratetapmx.com>';

/** Escape HTML special characters to prevent injection. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

  await resend.emails.send({
    from: FROM,
    to,
    subject: `[RateTap] New ${rating}-star feedback at ${restaurantName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <h2 style="margin: 0 0 4px; font-size: 18px;">New Customer Feedback</h2>
          <p style="margin: 0; color: #78716c; font-size: 14px;">${restaurantName}</p>

          <div style="margin: 20px 0; padding: 16px; background: white; border-radius: 8px; border-left: 3px solid ${rating >= 4 ? '#16a34a' : rating >= 3 ? '#f59e0b' : '#dc2626'};">
            <p style="margin: 0 0 8px; font-size: 20px;">${stars}</p>
            <p style="margin: 0; font-size: 15px; line-height: 1.5;">${escapeHtml(feedback)}</p>
          </div>

          <table style="font-size: 14px; color: #44403c; width: 100%;">
            ${customerName ? `<tr><td style="padding: 4px 0; color: #78716c;">Customer</td><td style="padding: 4px 0;">${escapeHtml(customerName)}</td></tr>` : ''}
            ${customerEmail ? `<tr><td style="padding: 4px 0; color: #78716c;">Email</td><td style="padding: 4px 0;"><a href="mailto:${encodeURIComponent(customerEmail)}" style="color: #d97706;">${escapeHtml(customerEmail)}</a></td></tr>` : ''}
            ${staffName ? `<tr><td style="padding: 4px 0; color: #78716c;">Staff</td><td style="padding: 4px 0;">${escapeHtml(staffName)}</td></tr>` : ''}
          </table>
        </div>
        <p style="text-align: center; margin: 16px 0 0; font-size: 11px; color: #a8a29e;">
          Sent by RateTap &middot; <a href="${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com'}/feedback" style="color: #a8a29e;">View all feedback</a>
        </p>
      </div>
    `,
  });
}

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

  const deltaArrow = (d: number) => d > 0 ? `<span style="color:#16a34a;">↑ +${d}</span>` : d < 0 ? `<span style="color:#dc2626;">↓ ${d}</span>` : `<span style="color:#78716c;">→ 0</span>`;
  const ratingArrow = (d: string | null) => {
    if (!d) return '';
    const n = parseFloat(d);
    if (n > 0) return `<span style="color:#16a34a;">↑ +${d}</span>`;
    if (n < 0) return `<span style="color:#dc2626;">↓ ${d}</span>`;
    return `<span style="color:#78716c;">→ 0</span>`;
  };

  const leaderboardRows = topPerformers.length > 0
    ? topPerformers.map((p, i) => `
        <tr>
          <td style="padding: 6px 12px; border-top: 1px solid #e7e5e4; font-size: 14px;">
            <strong>${i + 1}.</strong> ${p.staffName ?? 'Unknown'}
          </td>
          <td style="padding: 6px 12px; border-top: 1px solid #e7e5e4; font-size: 14px; text-align: right;">
            ${p.avgRating.toFixed(1)} ★
          </td>
          <td style="padding: 6px 12px; border-top: 1px solid #e7e5e4; font-size: 14px; text-align: right; color: #78716c;">
            ${p.reviewCount} reviews
          </td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding: 12px; color: #a8a29e; font-style: italic; font-size: 14px;">No reviews last week</td></tr>`;

  const googleRatingBanner = googleTrend && googleTrend.ratingChange !== 0
    ? `<div style="margin: 16px 0; padding: 16px; background: white; border-radius: 8px; text-align: center;">
        <p style="margin: 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Google Rating</p>
        <p style="margin: 8px 0 4px;">
          <span style="color: #a8a29e; font-size: 16px;">${googleTrend.baselineRating.toFixed(1)}</span>
          <span style="color: #a8a29e;"> → </span>
          <span style="font-size: 28px; font-weight: 700;">${googleTrend.currentRating.toFixed(1)} ★</span>
          <span style="font-size: 16px; font-weight: 700; color: ${googleTrend.ratingChange > 0 ? '#16a34a' : '#dc2626'};">
            ${googleTrend.ratingChange > 0 ? '+' : ''}${googleTrend.ratingChange.toFixed(1)}
          </span>
        </p>
        ${googleTrend.reviewsGained > 0 ? `<p style="margin: 0; font-size: 12px; color: #78716c;">+${googleTrend.reviewsGained} new Google reviews</p>` : ''}
       </div>`
    : '';

  const interceptedBanner = lastWeek.intercepted > 0
    ? `<div style="margin: 0 0 16px; padding: 12px 16px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #f59e0b;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #92400e;">
          ${lastWeek.intercepted} negative ${lastWeek.intercepted === 1 ? 'review' : 'reviews'} caught privately this week
        </p>
       </div>`
    : '';

  const unresolvedBanner = unresolvedCount > 0
    ? `<div style="margin: 16px 0; padding: 12px 16px; background: #fef2f2; border-radius: 8px; border-left: 3px solid #dc2626;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #991b1b;">
          ${unresolvedCount} unresolved feedback ${unresolvedCount === 1 ? 'item' : 'items'} still need attention
        </p>
       </div>`
    : '';

  await resend.emails.send({
    from: FROM,
    to,
    subject: `[RateTap] Weekly Summary — ${restaurantName} — ${lastWeek.totalReviews} reviews, ${lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--'} avg`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <h2 style="margin: 0 0 4px; font-size: 20px;">Weekly Summary</h2>
          <p style="margin: 0; color: #78716c; font-size: 14px;">${restaurantName}</p>

          ${googleRatingBanner}

          <!-- Stats -->
          <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px; background: white; border-radius: 8px 0 0 8px; text-align: center; width: 33%;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${lastWeek.totalReviews}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Reviews</p>
                <p style="margin: 2px 0 0; font-size: 12px;">${deltaArrow(reviewsDelta)}</p>
              </td>
              <td style="padding: 12px; background: white; text-align: center; width: 33%; border-left: 1px solid #f5f5f4; border-right: 1px solid #f5f5f4;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${lastWeek.avgRating ? lastWeek.avgRating.toFixed(1) : '--'}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Avg Rating</p>
                <p style="margin: 2px 0 0; font-size: 12px;">${ratingArrow(ratingDelta)}</p>
              </td>
              <td style="padding: 12px; background: white; border-radius: 0 8px 8px 0; text-align: center; width: 33%;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${lastWeek.googleSends}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Google Sends</p>
              </td>
            </tr>
          </table>

          ${interceptedBanner}

          ${unresolvedBanner}

          <!-- Top Performers -->
          <div style="background: white; border-radius: 8px; overflow: hidden;">
            <p style="margin: 0; padding: 12px 12px 8px; font-size: 13px; font-weight: 600; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Top Performers</p>
            <table style="width: 100%; border-collapse: collapse;">
              ${leaderboardRows}
            </table>
          </div>

          <!-- CTA -->
          <div style="text-align: center; margin-top: 20px;">
            <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: #1c1917; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
              Open Dashboard
            </a>
          </div>
        </div>

        <p style="text-align: center; margin: 16px 0 0; font-size: 11px; color: #a8a29e;">
          Sent every Monday by RateTap
        </p>
      </div>
    `,
  });
}

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

  // Google rating movers
  const movers = locations
    .filter((l) => l.ratingChange != null && l.ratingChange !== 0)
    .sort((a, b) => (b.ratingChange ?? 0) - (a.ratingChange ?? 0));

  const googleMoversBanner = movers.length > 0
    ? `<div style="margin: 0 0 16px; padding: 16px; background: white; border-radius: 8px;">
        <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Google Rating Changes</p>
        <table style="width: 100%; border-collapse: collapse;">
          ${movers.map((l) => {
            const color = (l.ratingChange ?? 0) > 0 ? '#16a34a' : '#dc2626';
            const sign = (l.ratingChange ?? 0) > 0 ? '+' : '';
            return `<tr style="border-top: 1px solid #f5f5f4;">
              <td style="padding: 6px 0; font-size: 14px;">${l.name}</td>
              <td style="padding: 6px 0; font-size: 14px; text-align: right; font-weight: 600;">${l.currentRating != null ? l.currentRating.toFixed(1) + ' ★' : '--'}</td>
              <td style="padding: 6px 0; font-size: 14px; text-align: right; font-weight: 700; color: ${color};">${sign}${(l.ratingChange ?? 0).toFixed(1)}</td>
            </tr>`;
          }).join('')}
        </table>
       </div>`
    : '';

  const interceptedBanner = totalIntercepted > 0
    ? `<div style="margin: 0 0 16px; padding: 12px 16px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #f59e0b;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #92400e;">
          ${totalIntercepted} negative ${totalIntercepted === 1 ? 'review' : 'reviews'} caught privately across all locations
        </p>
       </div>`
    : '';

  // Sort by avg rating ascending so worst performers are first
  const sorted = [...locations].sort((a, b) => (a.avgRating || 99) - (b.avgRating || 99));

  const locationRows = sorted.map((l) => {
    const ratingColor = l.avgRating >= 4 ? '#16a34a' : l.avgRating >= 3 ? '#f59e0b' : '#dc2626';
    const unresolvedBadge = l.unresolved > 0
      ? `<span style="display:inline-block;padding:1px 6px;border-radius:999px;font-size:11px;font-weight:600;background:#fef2f2;color:#dc2626;margin-left:6px;">${l.unresolved}</span>`
      : '';
    return `
      <tr style="border-top: 1px solid #e7e5e4;">
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 500;">${l.name}${unresolvedBadge}</td>
        <td style="padding: 8px 12px; font-size: 14px; text-align: right;">${l.reviews}</td>
        <td style="padding: 8px 12px; font-size: 14px; text-align: right; color: ${ratingColor}; font-weight: 600;">${l.avgRating ? l.avgRating.toFixed(1) + ' ★' : '--'}</td>
        <td style="padding: 8px 12px; font-size: 14px; text-align: right; color: #78716c;">${l.googleSends}</td>
        <td style="padding: 8px 12px; font-size: 14px; text-align: right; color: #92400e; font-weight: 600;">${l.intercepted > 0 ? l.intercepted : '-'}</td>
      </tr>
    `;
  }).join('');

  const unresolvedBanner = totalUnresolved > 0
    ? `<div style="margin: 16px 0; padding: 12px 16px; background: #fef2f2; border-radius: 8px; border-left: 3px solid #dc2626;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #991b1b;">
          ${totalUnresolved} unresolved feedback ${totalUnresolved === 1 ? 'item' : 'items'} across all locations
        </p>
       </div>`
    : '';

  await resend.emails.send({
    from: FROM,
    to,
    subject: `[RateTap] Owner Weekly — ${totalReviews} reviews, ${overallAvg} avg across ${locations.length} locations`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <h2 style="margin: 0 0 4px; font-size: 20px;">Owner Weekly Summary</h2>
          <p style="margin: 0; color: #78716c; font-size: 14px;">${locations.length} locations</p>

          <!-- Totals -->
          <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px; background: white; border-radius: 8px 0 0 8px; text-align: center; width: 33%;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${totalReviews}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase;">Total Reviews</p>
              </td>
              <td style="padding: 12px; background: white; text-align: center; width: 33%; border-left: 1px solid #f5f5f4; border-right: 1px solid #f5f5f4;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${overallAvg}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase;">Avg Rating</p>
              </td>
              <td style="padding: 12px; background: white; border-radius: 0 8px 8px 0; text-align: center; width: 33%;">
                <p style="margin: 0; font-size: 24px; font-weight: 700;">${locations.length}</p>
                <p style="margin: 4px 0 0; font-size: 11px; color: #78716c; text-transform: uppercase;">Locations</p>
              </td>
            </tr>
          </table>

          ${googleMoversBanner}

          ${interceptedBanner}

          ${unresolvedBanner}

          <!-- Per-Location Table -->
          <div style="background: white; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr>
                  <th style="padding: 8px 12px; font-size: 11px; text-align: left; color: #78716c; text-transform: uppercase; letter-spacing: 0.05em;">Location</th>
                  <th style="padding: 8px 12px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Reviews</th>
                  <th style="padding: 8px 12px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Avg</th>
                  <th style="padding: 8px 12px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Google</th>
                  <th style="padding: 8px 12px; font-size: 11px; text-align: right; color: #78716c; text-transform: uppercase;">Caught</th>
                </tr>
              </thead>
              <tbody>
                ${locationRows}
              </tbody>
            </table>
          </div>

          <div style="text-align: center; margin-top: 20px;">
            <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: #1c1917; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
              Open Overview
            </a>
          </div>
        </div>
        <p style="text-align: center; margin: 16px 0 0; font-size: 11px; color: #a8a29e;">
          Sent every Monday by RateTap
        </p>
      </div>
    `,
  });
}

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

  await resend.emails.send({
    from: FROM,
    to,
    subject: `[RateTap] Restablecer contraseña — ${restaurantName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <h2 style="margin: 0 0 4px; font-size: 18px;">Restablecer Contraseña</h2>
          <p style="margin: 0 0 16px; color: #78716c; font-size: 14px;">${escapeHtml(restaurantName)}</p>

          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
            Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el boton de abajo para crear una nueva contraseña.
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 32px; background: #1c1917; color: white; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">
              Restablecer Contraseña
            </a>
          </div>

          <p style="margin: 0; font-size: 13px; color: #78716c; line-height: 1.5;">
            Este enlace expira en 1 hora. Si no solicitaste esto, puedes ignorar este correo.
          </p>
        </div>
        <p style="text-align: center; margin: 16px 0 0; font-size: 11px; color: #a8a29e;">
          Enviado por RateTap
        </p>
      </div>
    `,
  });
}

export async function sendTestEmail(to: string) {
  const resend = getResend();
  if (!resend) {
    return { success: false, error: 'RESEND_API_KEY not set' };
  }

  const result = await resend.emails.send({
    from: FROM,
    to,
    subject: '[RateTap] Email de prueba',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <h2 style="margin: 0 0 8px; font-size: 18px;">Email de Prueba</h2>
          <p style="margin: 0; font-size: 15px; color: #44403c;">
            Si puedes ver este correo, la integracion con Resend esta funcionando correctamente.
          </p>
        </div>
        <p style="text-align: center; margin: 16px 0 0; font-size: 11px; color: #a8a29e;">
          Enviado por RateTap
        </p>
      </div>
    `,
  });

  return { success: true, id: result.data?.id };
}

const categoryLabels: Record<string, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  feedback: 'General Feedback',
  question: 'Question / Help',
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
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@ratetap.com';
  const label = categoryLabels[category] ?? category;

  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — logging GM feedback to console');
    console.log(`[GM Feedback] ${label} from ${restaurantName}: ${subject || '(no subject)'}\n${message}`);
    return;
  }

  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: `[GM ${label}] ${subject || restaurantName}`,
    replyTo: adminEmail,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #1c1917;">
        <div style="padding: 24px; background: #faf6f1; border-radius: 12px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
            <span style="display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${category === 'bug' ? '#fef2f2; color: #dc2626' : category === 'feature' ? '#fefce8; color: #ca8a04' : '#f0fdf4; color: #16a34a'};">
              ${label}
            </span>
          </div>

          <h2 style="margin: 0 0 4px; font-size: 18px;">${subject || 'No subject'}</h2>
          <p style="margin: 0 0 16px; color: #78716c; font-size: 13px;">
            From <strong>${restaurantName}</strong> (${restaurantSlug})
          </p>

          <div style="padding: 16px; background: white; border-radius: 8px; border-left: 3px solid ${category === 'bug' ? '#dc2626' : category === 'feature' ? '#ca8a04' : '#16a34a'};">
            <p style="margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
          </div>
        </div>
      </div>
    `,
  });
}
