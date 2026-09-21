/**
 * Complaint SLA tracking and escalation.
 *
 * This module owns EVERY upward escalation path. `dispatchFeedbackAlerts`
 * notifies only the location's own account; the owner and the regional manager
 * are reached from here, and only once the location has had its own window to
 * act on the review:
 *
 *   - URGENT_ESCALATION_HOURS (2 h)     — severity 'urgent' (rating <= 2)
 *   - ACTIONABLE_ESCALATION_HOURS (8 h) — every other actionable review, i.e.
 *     the ones classifyReview() flags as needing a human
 *   - RESOLVE_TARGET_HOURS (24 h)       — the pre-existing SLA rule, preserved:
 *     still overdue whether or not anyone opened the review
 *
 * Candidates are picked by ACTIONABILITY, not by the star count: a 5-star
 * review whose text is a real complaint is actionable and must reach someone,
 * even though `rating < threshold` can never be true for it.
 *
 * Sweeps run fire-and-forget from the guest feedback request path (see
 * /api/reviews/feedback) and from the daily /api/cron/complaint-sla cron. The
 * cron alone cannot enforce a 2 h window — Vercel Hobby only permits daily
 * crons — so it is the backstop, and the request path is what makes the short
 * windows real. Two sweeps can therefore overlap, which is why every candidate
 * is claimed with a conditional `escalated_at` update before anything is sent.
 */
import { after } from 'next/server';
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '@/db';
import { restaurants, reviews } from '@/db/schema';
import { sendFeedbackAlert } from '@/lib/email';
import { sendPushToRestaurant } from '@/lib/push';
import { inboxLinkFor } from '@/lib/review-recovery';
import {
  classifyReview,
  escalationPushTitle,
  previewFeedback,
  pushKindFor,
  type ReviewClassification,
  type ReviewSeverity,
} from '@/lib/review-classification';
import type { AlertChannelMap, AlertChannelResult } from '@/lib/feedback-alerts';

export const REVIEW_TARGET_HOURS = 2;
export const RESOLVE_TARGET_HOURS = 24;
/**
 * Window for an urgent (rating <= 2) review nobody has acted on yet. Short on
 * purpose: this is the only alarm that reaches leadership before the guest's
 * complaint is a day old.
 */
export const URGENT_ESCALATION_HOURS = 2;
/**
 * Window for every other actionable review — a good rating carrying a real
 * complaint. Longer than the urgent window because the review itself is not
 * alarming, but short enough that the GM's own view of it arrives first.
 */
export const ACTIONABLE_ESCALATION_HOURS = 8;
export const URGENT_MAX_RATING = 2;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface ComplaintSlaStats {
  received: number;
  reviewedWithin2h: number;
  resolvedWithin24h: number;
  overdueOpen: number;
  avgHoursToReview: number | null;
  avgHoursToResolve: number | null;
}

export interface OverdueComplaintPreview {
  rating: number;
  hoursOpen: number;
  feedbackPreview: string;
}

export interface ComplaintEscalationDetail {
  complaintId: number;
  restaurantId: number;
  locationName: string;
  hoursOpen: number;
  targeted: boolean;
  channels: AlertChannelMap;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(
  channels: AlertChannelMap,
  key: string,
  result: AlertChannelResult,
) {
  channels[key] = result;
}

function hoursOpen(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / HOUR_MS));
}

export async function getComplaintSlaStats(
  restaurantId: number,
  now: Date,
  days = 30,
): Promise<ComplaintSlaStats> {
  const windowStart = new Date(now.getTime() - days * DAY_MS);
  const overdueCutoff = new Date(now.getTime() - RESOLVE_TARGET_HOURS * HOUR_MS);

  const [windowRows, overdueRows] = await Promise.all([
    db
      .select({
        received: sql<number>`count(*)::int`,
        reviewedWithin2h: sql<number>`count(*) filter (
          where ${reviews.reviewedAt} is not null
            and ${reviews.reviewedAt} <= ${reviews.createdAt} + ${REVIEW_TARGET_HOURS} * interval '1 hour'
        )::int`,
        resolvedWithin24h: sql<number>`count(*) filter (
          where ${reviews.resolvedAt} is not null
            and ${reviews.resolvedAt} <= ${reviews.createdAt} + ${RESOLVE_TARGET_HOURS} * interval '1 hour'
        )::int`,
        avgHoursToReview: sql<number | null>`avg(
          extract(epoch from (${reviews.reviewedAt} - ${reviews.createdAt})) / 3600.0
        ) filter (where ${reviews.reviewedAt} is not null)`.mapWith(Number),
        avgHoursToResolve: sql<number | null>`avg(
          extract(epoch from (${reviews.resolvedAt} - ${reviews.createdAt})) / 3600.0
        ) filter (where ${reviews.resolvedAt} is not null)`.mapWith(Number),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurantId),
          isNotNull(reviews.feedback),
          lte(reviews.rating, 3),
          sql`${reviews.createdAt} >= ${windowStart}`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurantId),
          isNotNull(reviews.feedback),
          lte(reviews.rating, URGENT_MAX_RATING),
          ne(reviews.status, 'resolved'),
          lt(reviews.createdAt, overdueCutoff),
        ),
      ),
  ]);

  const windowStats = windowRows[0];
  return {
    received: asNumber(windowStats?.received),
    reviewedWithin2h: asNumber(windowStats?.reviewedWithin2h),
    resolvedWithin24h: asNumber(windowStats?.resolvedWithin24h),
    overdueOpen: asNumber(overdueRows[0]?.count),
    avgHoursToReview: asNullableNumber(windowStats?.avgHoursToReview),
    avgHoursToResolve: asNullableNumber(windowStats?.avgHoursToResolve),
  };
}

/** Row shape selected for escalation, before classification is attached. */
export interface OverdueComplaintRow {
  id: number;
  restaurantId: number;
  rating: number;
  feedback: string | null;
  customerName: string | null;
  customerEmail: string | null;
  staffName: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: Date;
  reviewedAt: Date | null;
  resolvedAt: Date | null;
  escalatedAt: Date | null;
  restaurantName: string;
  region: string | null;
  restaurantIsOwner: boolean;
  restaurantIsRegional: boolean;
}

export interface OverdueComplaint extends OverdueComplaintRow {
  /**
   * Classified once, here, so the caller renders the escalation from the same
   * severity the GM's own alert used instead of reclassifying the same text.
   */
  classification: ReviewClassification;
}

/**
 * How long a review that nobody has acted on may sit before leadership is told.
 * Urgent reviews (rating <= 2) get the short window; a complaint carrying a
 * good rating gets the longer one, because the review itself is not the alarm.
 */
function unreviewedWindowHours(severity: ReviewSeverity): number {
  return severity === 'urgent'
    ? URGENT_ESCALATION_HOURS
    : ACTIONABLE_ESCALATION_HOURS;
}

export async function getOverdueComplaints(now: Date): Promise<OverdueComplaint[]> {
  // The SQL only needs to exclude anything younger than the SHORTEST window;
  // which window actually applies depends on the severity, which is decided
  // below. Ordering the reviews is still the query's job.
  const shortestCutoff = new Date(now.getTime() - URGENT_ESCALATION_HOURS * HOUR_MS);
  const rows = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      feedback: reviews.feedback,
      customerName: reviews.customerName,
      customerEmail: reviews.customerEmail,
      staffName: reviews.staffName,
      status: reviews.status,
      createdAt: reviews.createdAt,
      reviewedAt: reviews.reviewedAt,
      resolvedAt: reviews.resolvedAt,
      escalatedAt: reviews.escalatedAt,
      restaurantName: restaurants.name,
      region: restaurants.region,
      restaurantIsOwner: restaurants.isOwner,
      restaurantIsRegional: restaurants.isRegional,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(
      and(
        isNotNull(reviews.feedback),
        ne(reviews.feedback, ''),
        ne(reviews.status, 'resolved'),
        lt(reviews.createdAt, shortestCutoff),
        isNull(reviews.escalatedAt),
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    )
    .orderBy(asc(reviews.createdAt));

  // Keep the same safeguards in application code. This also protects callers
  // that substitute the database layer in tests or local tooling.
  return rows
    .map((row) => ({
      ...row,
      classification: classifyReview({ rating: row.rating, feedback: row.feedback }),
    }))
    .filter((row) => {
      // Only reviews that need a human can be escalated. Praise never is,
      // whatever its age — that is what makes this list actionable-driven
      // instead of star-count-driven.
      if (!row.classification.actionable) return false;

      // Belt and braces for the SQL predicates above.
      if (row.feedback === null || row.feedback.trim().length === 0) return false;
      if (row.status === 'resolved') return false;
      if (row.escalatedAt !== null) return false;
      if (row.restaurantIsOwner || row.restaurantIsRegional) return false;
      if (row.createdAt.getTime() >= shortestCutoff.getTime()) return false;

      const ageHours = (now.getTime() - row.createdAt.getTime()) / HOUR_MS;

      // (a) Nobody acted: no reviewedAt, and the severity's own window is up.
      if (
        row.reviewedAt === null
        && ageHours >= unreviewedWindowHours(row.classification.severity)
      ) {
        return true;
      }

      // (b) The preserved SLA rule, unchanged: open for a full day. The
      // `status !== 'resolved'` half of it is the belt-and-braces check above.
      // Rule (a) is a superset of (b) for unreviewed rows, so this change can
      // only ever add coverage.
      return ageHours >= RESOLVE_TARGET_HOURS;
    });
}

export async function getOverdueComplaintPreviews(
  restaurantId: number,
  now: Date,
  limit = 3,
): Promise<OverdueComplaintPreview[]> {
  const overdueCutoff = new Date(now.getTime() - RESOLVE_TARGET_HOURS * HOUR_MS);
  const rows = await db
    .select({
      rating: reviews.rating,
      feedback: reviews.feedback,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        isNotNull(reviews.feedback),
        lte(reviews.rating, URGENT_MAX_RATING),
        ne(reviews.status, 'resolved'),
        lt(reviews.createdAt, overdueCutoff),
      ),
    )
    .orderBy(asc(reviews.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    rating: row.rating,
    hoursOpen: hoursOpen(row.createdAt, now),
    feedbackPreview: previewFeedback(row.feedback ?? '', 60),
  }));
}

export async function escalateOverdueComplaints(now: Date = new Date()) {
  const overdue = await getOverdueComplaints(now);
  const accounts = await db
    .select({
      id: restaurants.id,
      isOwner: restaurants.isOwner,
      isRegional: restaurants.isRegional,
      region: restaurants.region,
      managerEmail: restaurants.managerEmail,
    })
    .from(restaurants)
    .where(
      or(
        eq(restaurants.isOwner, true),
        eq(restaurants.isRegional, true),
      ),
    );

  let escalated = 0;
  let noChannel = 0;
  const details: ComplaintEscalationDetail[] = [];

  for (const complaint of overdue) {
    const classification = complaint.classification;
    const openHours = hoursOpen(complaint.createdAt, now);
    const body = previewFeedback(complaint.feedback ?? '', 100);
    // One vocabulary with the GM's own alert: the title comes from the shared
    // classification, and the "sin atender desde hace N h" fact is appended so
    // the overdue information survives the switch away from the old
    // hardcoded wording.
    const title = `${escalationPushTitle(classification.severity, complaint.rating, complaint.restaurantName)} sin atender desde hace ${openHours} h`;
    const pushKind = pushKindFor(classification.severity);

    // Claim BEFORE sending. This sweep also runs from the guest request path,
    // so two sweeps can overlap; the conditional update makes exactly one of
    // them the owner of this review. A row we failed to claim was taken by the
    // other sweep, which is already sending for it.
    const claimed = await db
      .update(reviews)
      .set({ escalatedAt: now })
      .where(and(eq(reviews.id, complaint.id), isNull(reviews.escalatedAt)))
      .returning({ id: reviews.id });

    if (claimed.length === 0) {
      console.warn(
        `[sla] Review #${complaint.id} already claimed by another sweep, skipping`,
      );
      continue;
    }

    const recipients = accounts.filter((account) => (
      account.isOwner
      || (account.isRegional && complaint.region !== null && account.region === complaint.region)
    ));
    const channels: AlertChannelMap = {};
    let wasTargeted = false;

    try {
      const result = await sendPushToRestaurant(complaint.restaurantId, {
        title,
        body,
        url: inboxLinkFor(complaint.id),
        rid: complaint.id,
        tag: `overdue-${complaint.id}`,
      }, {
        kind: pushKind,
        subjectType: 'review',
        subjectId: complaint.id,
      });
      if (result.targeted > 0) {
        wasTargeted = true;
        record(channels, 'location_push', { ok: true });
      } else {
        record(channels, 'location_push', { ok: false, skipped: 'no_devices' });
      }
    } catch (error) {
      record(channels, 'location_push', { ok: false, error: errorMessage(error) });
    }

    for (const account of recipients) {
      const role = account.isOwner ? 'owner' : 'regional';
      const key = `${role}_${account.id}_push`;
      try {
        const result = await sendPushToRestaurant(account.id, {
          title,
          body,
          url: '/intercepted',
          tag: `overdue-${complaint.id}`,
        }, {
          kind: pushKind,
          subjectType: 'review',
          subjectId: complaint.id,
        });
        if (result.targeted > 0) {
          wasTargeted = true;
          record(channels, key, { ok: true });
        } else {
          record(channels, key, { ok: false, skipped: 'no_devices' });
        }
      } catch (error) {
        record(channels, key, { ok: false, error: errorMessage(error) });
      }
    }

    for (const account of recipients) {
      const role = account.isOwner ? 'owner' : 'regional';
      const key = `${role}_${account.id}_email`;
      if (!account.managerEmail) {
        record(channels, key, { ok: false, skipped: 'no_email' });
        continue;
      }

      wasTargeted = true;
      try {
        const result = await sendFeedbackAlert({
          to: account.managerEmail,
          reviewId: complaint.id,
          restaurantName: complaint.restaurantName,
          customerName: complaint.customerName,
          customerEmail: complaint.customerEmail,
          rating: complaint.rating,
          staffName: complaint.staffName,
          feedback: complaint.feedback ?? '',
          severity: classification.severity,
          subjectPrefix: '[Escalada]',
        });
        if (result.success === false || result.skipped) {
          record(channels, key, {
            ok: false,
            error: result.error?.message ?? 'send skipped',
          });
        } else {
          record(channels, key, { ok: true });
        }
      } catch (error) {
        record(channels, key, { ok: false, error: errorMessage(error) });
      }
    }

    const escalationChannels = sql`coalesce(${reviews.alertChannels}, '{}'::jsonb)
      || jsonb_build_object(
        'complaint_escalation',
        ${JSON.stringify(channels)}::jsonb
      )`;

    if (wasTargeted) {
      await db
        .update(reviews)
        .set({ alertChannels: escalationChannels })
        .where(eq(reviews.id, complaint.id));
      escalated++;
    } else {
      // Nobody was reachable, so there is nothing to escalate yet. Release the
      // claim (escalated_at back to NULL) so a later sweep retries once an
      // account or a device exists — but keep the channel record, otherwise the
      // row would look like nothing ever tried.
      await db
        .update(reviews)
        .set({ alertChannels: escalationChannels, escalatedAt: null })
        .where(eq(reviews.id, complaint.id));
      noChannel++;
    }

    details.push({
      complaintId: complaint.id,
      restaurantId: complaint.restaurantId,
      locationName: complaint.restaurantName,
      hoursOpen: openHours,
      targeted: wasTargeted,
      channels,
    });
  }

  return { escalated, noChannel, details };
}

/**
 * Hand off to the upward escalation path once the guest's submission is done.
 *
 * dispatchFeedbackAlerts only reaches the location's own account now, so
 * complaint-sla owns everything above it — and it has to run far more often
 * than the daily cron can. Vercel Hobby only permits daily crons, so a 2 h
 * window would be a fiction without a sweep from here. This runs at most once
 * per request, after the response value is settled, and can never delay or
 * fail the guest's submission: everything is caught and only logged.
 */
export function scheduleComplaintSlaSweep() {
  const sweep = async () => {
    try {
      await escalateOverdueComplaints(new Date());
    } catch (err) {
      console.error('[reviews/feedback] complaint SLA sweep failed:', err);
    }
  };

  try {
    after(sweep);
  } catch {
    // `after()` throws outside a Next.js request scope (unit tests, scripts).
    // Run the sweep detached rather than letting the registration failure
    // reach the request path.
    void sweep();
  }
}
