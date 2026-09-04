import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { restaurants, reviews } from '@/db/schema';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { sendWhatsAppAlert } from '@/lib/whatsapp';
import { sendPushToRestaurant } from '@/lib/push';
import { isPositiveRating } from '@/lib/feedback';

/**
 * Per-channel dispatch of feedback alerts.
 *
 * Every channel records its own outcome ({ ok, error?, skipped? }) so one
 * broken channel (e.g. Telnyx SMS returning 401) can never hide another
 * channel's success. The aggregate is written back to the review row:
 * alert_channels = the full record, alert_sent_at = now when ANY channel
 * succeeded, alert_error = only the genuinely failed channels (skips are
 * not failures).
 */

export interface AlertChannelResult {
  ok: boolean;
  error?: string;
  skipped?: string;
}

export type AlertChannelMap = Record<string, AlertChannelResult>;

export interface FeedbackAlertRestaurant {
  name: string;
  managerEmail: string | null;
  managerPhone: string | null;
  alertPreference: string | null;
  smsAlerts: boolean;
  whatsappAlerts: boolean;
  googleThreshold: number;
  region: string | null;
}

export type FeedbackAlertReview = typeof reviews.$inferSelect;

export interface FeedbackAlertDispatchResult {
  channels: AlertChannelMap;
  anySuccess: boolean;
}

function shouldSendFor(pref: string, rating: number, threshold: number): boolean {
  if (pref === 'all') return true;
  if (pref === 'low') return rating <= 2;
  if (pref === 'threshold') return rating < threshold;
  return false; // 'off'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Record a channel outcome. When several escalation accounts share a channel
 * key (e.g. two owners → owner_email), a recorded success always wins over a
 * later failure/skip so the aggregate never downgrades a delivered alert.
 */
function record(channels: AlertChannelMap, key: string, result: AlertChannelResult) {
  if (channels[key]?.ok) return;
  channels[key] = result;
}

export async function dispatchFeedbackAlerts(
  review: FeedbackAlertReview,
  restaurant: FeedbackAlertRestaurant,
): Promise<FeedbackAlertDispatchResult> {
  const channels: AlertChannelMap = {};
  const feedback = review.feedback ?? '';
  const feedbackPreview = feedback.length > 100 ? `${feedback.slice(0, 99)}…` : feedback;

  // ── GM channels (location account) ──────────────────────────────────────
  const pref = restaurant.alertPreference ?? 'all';
  if (shouldSendFor(pref, review.rating, restaurant.googleThreshold)) {
    const attempts: Promise<void>[] = [];

    if (restaurant.managerEmail) {
      attempts.push(
        sendFeedbackAlert({
          to: restaurant.managerEmail,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          customerEmail: review.customerEmail,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
        }).then((result) => {
          if (result.success === false) {
            const responseCode = result.error?.responseCode != null
              ? `SMTP ${result.error.responseCode}`
              : '';
            record(channels, 'email', {
              ok: false,
              error: `${responseCode ? `${responseCode} ` : ''}${result.error?.message ?? 'send skipped'}`,
            });
          } else {
            record(channels, 'email', { ok: true });
          }
        }).catch((err) => {
          record(channels, 'email', { ok: false, error: errorMessage(err) });
        }),
      );
    } else {
      record(channels, 'email', { ok: false, skipped: 'no_email' });
    }

    // SMS stays behind a global kill switch: Telnyx currently answers 401 on
    // every call, so the channel is skipped (not failed) unless explicitly
    // re-enabled via SMS_ALERTS_ENABLED=true.
    if (!restaurant.smsAlerts) {
      record(channels, 'sms', { ok: false, skipped: 'disabled' });
    } else if (!restaurant.managerPhone) {
      record(channels, 'sms', { ok: false, skipped: 'no_phone' });
    } else if (process.env.SMS_ALERTS_ENABLED !== 'true') {
      record(channels, 'sms', { ok: false, skipped: 'disabled' });
    } else {
      attempts.push(
        sendSMSAlert({
          to: restaurant.managerPhone,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
        }).then(() => {
          record(channels, 'sms', { ok: true });
        }).catch((err) => {
          record(channels, 'sms', { ok: false, error: errorMessage(err) });
        }),
      );
    }

    if (!restaurant.whatsappAlerts || process.env.WHATSAPP_ALERTS_ENABLED !== 'true') {
      record(channels, 'whatsapp', { ok: false, skipped: 'disabled' });
    } else if (!restaurant.managerPhone) {
      record(channels, 'whatsapp', { ok: false, skipped: 'no_phone' });
    } else {
      attempts.push(
        sendWhatsAppAlert({
          to: restaurant.managerPhone,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
        }).then(() => {
          record(channels, 'whatsapp', { ok: true });
        }).catch((err) => {
          record(channels, 'whatsapp', { ok: false, error: errorMessage(err) });
        }),
      );
    }

    attempts.push(
      sendPushToRestaurant(review.restaurantId, {
        title: isPositiveRating(review.rating)
          ? `⭐ Comentario positivo de ${review.rating} estrellas`
          : `⚠️ Reseña de ${review.rating} estrella${review.rating === 1 ? '' : 's'}`,
        body: feedbackPreview,
        url: '/inbox',
        tag: `review-${review.id}`,
      }, {
        kind: review.rating < 4 ? 'low_review' : 'positive_review',
        subjectType: 'review',
        subjectId: review.id,
      }).then((result) => {
        if (result.targeted > 0) {
          record(channels, 'push', { ok: true });
        } else {
          record(channels, 'push', { ok: false, skipped: 'no_devices' });
        }
      }).catch((err) => {
        record(channels, 'push', { ok: false, error: errorMessage(err) });
      }),
    );

    await Promise.all(attempts);
  }

  // ── Owner / regional escalation ─────────────────────────────────────────
  // Complaints must reach the owner and the regional manager for this
  // location's region, not only the location GM. Each account's OWN
  // alertPreference decides whether it hears about this rating; the location
  // name is passed as restaurantName so multi-location recipients know which
  // location the feedback belongs to.
  let escalationAccounts: {
    id: number;
    isOwner: boolean;
    managerEmail: string | null;
    managerPhone: string | null;
    alertPreference: string;
    whatsappAlerts: boolean;
    googleThreshold: number;
  }[] = [];

  try {
    escalationAccounts = await db
      .select({
        id: restaurants.id,
        isOwner: restaurants.isOwner,
        managerEmail: restaurants.managerEmail,
        managerPhone: restaurants.managerPhone,
        alertPreference: restaurants.alertPreference,
        whatsappAlerts: restaurants.whatsappAlerts,
        googleThreshold: restaurants.googleThreshold,
      })
      .from(restaurants)
      .where(
        or(
          eq(restaurants.isOwner, true),
          restaurant.region
            ? and(
              eq(restaurants.isRegional, true),
              eq(restaurants.region, restaurant.region),
            )
            : undefined,
        ),
      );
  } catch (err) {
    record(channels, 'escalation', { ok: false, error: errorMessage(err) });
  }

  for (const account of escalationAccounts) {
    // Never escalate a location's alerts back to itself.
    if (account.id === review.restaurantId) continue;

    const prefix = account.isOwner ? 'owner' : 'regional';
    const accountPref = account.alertPreference ?? 'threshold';
    if (!shouldSendFor(accountPref, review.rating, account.googleThreshold)) {
      record(channels, `${prefix}_email`, { ok: false, skipped: 'preference' });
      record(channels, `${prefix}_whatsapp`, { ok: false, skipped: 'preference' });
      record(channels, `${prefix}_push`, { ok: false, skipped: 'preference' });
      continue;
    }

    try {
      const result = await sendPushToRestaurant(account.id, {
        title: `⚠️ ${restaurant.name}: ${review.rating} estrella${review.rating === 1 ? '' : 's'}`,
        body: feedbackPreview,
        url: '/overview',
        tag: `review-${review.id}`,
      }, {
        kind: 'low_review',
        subjectType: 'review',
        subjectId: review.id,
      });
      if (result.targeted > 0) {
        record(channels, `${prefix}_push`, { ok: true });
      } else {
        record(channels, `${prefix}_push`, { ok: false, skipped: 'no_devices' });
      }
    } catch (err) {
      record(channels, `${prefix}_push`, { ok: false, error: errorMessage(err) });
    }

    if (account.managerEmail) {
      try {
        const result = await sendFeedbackAlert({
          to: account.managerEmail,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          customerEmail: review.customerEmail,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
        });
        if (result.success === false) {
          record(channels, `${prefix}_email`, {
            ok: false,
            error: result.error?.message ?? 'send skipped',
          });
        } else {
          record(channels, `${prefix}_email`, { ok: true });
        }
      } catch (err) {
        record(channels, `${prefix}_email`, { ok: false, error: errorMessage(err) });
      }
    } else if (!account.managerPhone) {
      record(channels, `${prefix}_email`, { ok: false, skipped: 'no_channel' });
    }

    if (!account.whatsappAlerts || process.env.WHATSAPP_ALERTS_ENABLED !== 'true') {
      record(channels, `${prefix}_whatsapp`, { ok: false, skipped: 'disabled' });
    } else if (!account.managerPhone) {
      record(channels, `${prefix}_whatsapp`, { ok: false, skipped: 'no_phone' });
    } else {
      try {
        await sendWhatsAppAlert({
          to: account.managerPhone,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
        });
        record(channels, `${prefix}_whatsapp`, { ok: true });
      } catch (err) {
        record(channels, `${prefix}_whatsapp`, { ok: false, error: errorMessage(err) });
      }
    }
  }

  // ── Write back the per-channel truth ────────────────────────────────────
  const entries = Object.entries(channels);
  const anySuccess = entries.some(([, r]) => r.ok);
  const failures = entries.filter(([, r]) => !r.ok && !r.skipped);

  if (entries.length > 0) {
    await db.update(reviews).set({
      alertChannels: channels,
      alertSentAt: anySuccess ? new Date() : null,
      alertError: failures.length > 0
        ? failures.map(([name, r]) => `${name}: ${r.error}`).join('; ')
        : null,
    }).where(eq(reviews.id, review.id));
  }

  if (failures.length > 0) {
    console.error(
      `[alert] Review #${review.id} feedback alert errors: ${failures.map(([name, r]) => `${name}: ${r.error}`).join('; ')}`,
    );
  }

  return { channels, anySuccess };
}
