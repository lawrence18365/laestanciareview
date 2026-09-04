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
import type { AlertChannelMap, AlertChannelResult } from '@/lib/feedback-alerts';

export const REVIEW_TARGET_HOURS = 2;
export const RESOLVE_TARGET_HOURS = 24;
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

function preview(text: string, maxLength: number): string {
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
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

export async function getOverdueComplaints(now: Date) {
  const overdueCutoff = new Date(now.getTime() - RESOLVE_TARGET_HOURS * HOUR_MS);
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
        lte(reviews.rating, URGENT_MAX_RATING),
        ne(reviews.status, 'resolved'),
        lt(reviews.createdAt, overdueCutoff),
        isNull(reviews.escalatedAt),
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    )
    .orderBy(asc(reviews.createdAt));

  // Keep the same safeguards in application code. This also protects callers
  // that substitute the database layer in tests or local tooling.
  return rows.filter((row) => (
    row.feedback !== null
    && row.rating <= URGENT_MAX_RATING
    && row.status !== 'resolved'
    && row.createdAt.getTime() < overdueCutoff.getTime()
    && row.escalatedAt === null
    && !row.restaurantIsOwner
    && !row.restaurantIsRegional
  ));
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
    feedbackPreview: (row.feedback ?? '').slice(0, 60),
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
    const channels: AlertChannelMap = {};
    const openHours = hoursOpen(complaint.createdAt, now);
    const body = preview(complaint.feedback ?? '', 100);
    const recipients = accounts.filter((account) => (
      account.isOwner
      || (account.isRegional && complaint.region !== null && account.region === complaint.region)
    ));
    let wasTargeted = false;

    try {
      const result = await sendPushToRestaurant(complaint.restaurantId, {
        title: `Queja de ${complaint.rating} ${complaint.rating === 1 ? 'estrella' : 'estrellas'} sin atender desde hace ${openHours} h`,
        body,
        url: '/inbox',
        tag: `overdue-${complaint.id}`,
      }, {
        kind: 'complaint_overdue',
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
          title: `${complaint.restaurantName}: queja sin atender ${openHours} h`,
          body,
          url: '/intercepted',
          tag: `overdue-${complaint.id}`,
        }, {
          kind: 'complaint_escalation',
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
          restaurantName: complaint.restaurantName,
          customerName: complaint.customerName,
          customerEmail: complaint.customerEmail,
          rating: complaint.rating,
          staffName: complaint.staffName,
          feedback: complaint.feedback ?? '',
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
        .set({
          alertChannels: escalationChannels,
          escalatedAt: now,
        })
        .where(and(eq(reviews.id, complaint.id), isNull(reviews.escalatedAt)));
      escalated++;
    } else {
      await db
        .update(reviews)
        .set({ alertChannels: escalationChannels })
        .where(and(eq(reviews.id, complaint.id), isNull(reviews.escalatedAt)));
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
