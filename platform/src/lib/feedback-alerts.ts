import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { sendWhatsAppAlert } from '@/lib/whatsapp';
import { sendPushToRestaurant } from '@/lib/push';
import { inboxLinkFor } from '@/lib/review-recovery';
import {
  classifyReview,
  gmPushTitle,
  previewFeedback,
  pushKindFor,
  type ReviewClassification,
} from '@/lib/review-classification';

/**
 * Per-channel dispatch of feedback alerts — GM-first.
 *
 * This function notifies ONLY the location's own account (the GM). Owner and
 * regional recipients used to be alerted here, in the same pass as the GM,
 * which meant a Director of Operations could reach a GM's own restaurant's
 * problem before the GM had seen it. Upward escalation now lives exclusively
 * in complaint-sla.ts (escalateOverdueComplaints) and only fires when the GM
 * did not act inside the severity's own window. The handoff is still recorded
 * on the row as `escalation: { ok: false, skipped: 'deferred_to_sla' }` so the
 * audit trail shows what happened instead of a silent absence.
 *
 * Routing is driven by ACTIONABILITY, not by the star count alone. A 5-star
 * review whose text is a real complaint is actionable, and a restaurant whose
 * googleThreshold is 5 would otherwise filter it out with `rating < 5` and
 * never tell the one person who can fix it — the same defect as the 4-star
 * incident (see review-classification.ts), one layer down.
 *
 * Every channel records its own outcome ({ ok, error?, skipped? }) so one
 * broken channel (e.g. Telnyx SMS returning 401) can never hide another
 * channel's success. The aggregate is written back to the review row:
 * alert_channels = the full record, alert_sent_at = now when ANY channel
 * succeeded, alert_error = only the genuinely failed channels (skips are
 * not failures).
 *
 * Severity is classified exactly once per review, by classifyReview(), and the
 * same ReviewClassification drives every channel here. Before that was true,
 * the GM branch inferred sentiment from the star count while the escalation
 * branch hardcoded the warning wording, so a 4-star complaint reached the GM as
 * "Comentario positivo" and leadership as a warning on the same row.
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
  /** The one classification every channel in this dispatch was rendered from. */
  classification: ReviewClassification;
}

/**
 * Whether one location account should be told about this review.
 *
 * The `actionable` override comes second, deliberately after the 'off' check:
 * it exists to defeat *implicit* star-count rules, never an explicit decision.
 * 'off' means this account asked to receive nothing, and overriding it would
 * both spam someone who opted out and make the setting meaningless — whereas
 * 'low' / 'threshold' only look like filters, and their whole failure mode is
 * that a real complaint carrying a good rating never reaches the GM.
 *
 * Ordering note: everything that used to send still sends. This is strictly
 * additive, because `actionable` is false for praise, and for praise the old
 * three branches are evaluated unchanged.
 */
function shouldSendFor(
  pref: string,
  rating: number,
  threshold: number,
  actionable: boolean,
): boolean {
  if (pref === 'off') return false;
  if (actionable) return true; // a complaint always reaches its own GM
  if (pref === 'all') return true;
  if (pref === 'low') return rating <= 2;
  if (pref === 'threshold') return rating < threshold;
  return false;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Record a channel outcome. A recorded success always wins over a later
 * failure/skip for the same key, so the aggregate never downgrades a delivered
 * alert.
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
  const feedbackPreview = previewFeedback(feedback, 100);

  // Classified once, here. Every channel below reads from this object, which is
  // what guarantees the GM and the escalated recipients cannot be told
  // different things about the same review.
  const classification: ReviewClassification = classifyReview({
    rating: review.rating,
    feedback,
  });

  // ── GM channels (location account only) ─────────────────────────────────
  const pref = restaurant.alertPreference ?? 'all';
  if (
    shouldSendFor(
      pref,
      review.rating,
      restaurant.googleThreshold,
      classification.actionable,
    )
  ) {
    const attempts: Promise<void>[] = [];

    if (restaurant.managerEmail) {
      attempts.push(
        sendFeedbackAlert({
          to: restaurant.managerEmail,
          reviewId: review.id,
          restaurantName: restaurant.name,
          customerName: review.customerName,
          customerEmail: review.customerEmail,
          rating: review.rating,
          staffName: review.staffName,
          feedback,
          severity: classification.severity,
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
        title: gmPushTitle(classification.severity, review.rating),
        body: feedbackPreview,
        url: inboxLinkFor(review.id),
        rid: review.id,
        tag: `review-${review.id}`,
      }, {
        kind: pushKindFor(classification.severity),
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

  // ── Escalation handoff ──────────────────────────────────────────────────
  // Deliberately NOT a send. Owner and regional recipients are reached by
  // complaint-sla.ts, and only after this location's own account has been given
  // its window (URGENT_ESCALATION_HOURS for urgent, ACTIONABLE_ESCALATION_HOURS
  // for every other actionable review) without acting. Alerting them here would
  // let leadership see a GM's restaurant before the GM does. The entry below
  // keeps the row honest about which path owns the escalation.
  record(channels, 'escalation', { ok: false, skipped: 'deferred_to_sla' });

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

  return { channels, anySuccess, classification };
}
