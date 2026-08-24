import { db } from '@/db';
import {
  restaurants,
  reviews,
  staff,
  guests,
  guestVisits,
  quotes,
  eventLeads,
  eventCampaigns,
  campaignContacts,
  campaignBookings,
  productEvents,
  pushNotifications,
  pushSubscriptions,
} from '@/db/schema';
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  startOfTodayMexico,
  startOfWeekMexico,
  todayBirthdayKeyMexico,
} from '@/lib/mexico-tz';

/**
 * Product Analytics V1 — Phase 2: founder/owner analytics queries.
 *
 * Every metric carries an integrity tag describing how much we trust it:
 *  - 'verified'  = server-persisted fact (reviews rows, sent_to_google,
 *                  feedback text, guests/visits rows, campaign_contacts.opened_at,
 *                  quotes, product_events, push_notifications.accepted_count)
 *  - 'reported'  = a human typed it (campaign_contacts.sent_at = "marcado enviado",
 *                  campaign_bookings amounts/status, attribution_source)
 *  - 'inferred'  = derived by heuristic (time-to-view from reviewed_at, DAU from
 *                  app_open/page_view, "Google option shown" = review exists AND
 *                  the restaurant has google_review_url)
 *
 * All day/week bucketing is done in America/Mexico_City. None of these
 * functions throw on empty data — they return zeros/nulls instead.
 */

export type IntegrityTag = 'verified' | 'reported' | 'inferred';

export interface TaggedMetric<T = number> {
  value: T;
  tag: IntegrityTag;
}

export interface TrendedMetric extends TaggedMetric<number> {
  prev: number;
}

const MX_TZ = 'America/Mexico_City';

/** Literal Mexico-City timezone for SQL day bucketing. MUST be inlined as a
 *  raw literal (never a bind parameter): the same expression appears in both
 *  SELECT and GROUP BY, and parameterized occurrences get distinct $N
 *  placeholders that Postgres rejects as different expressions. */
const MX_TZ_SQL = sql.raw(`'America/Mexico_City'`);

/** sent_to_google honestly means "clicked the Google option" only for rows
 *  created on/after this date (the two-step review flow shipped then). */
export const GOOGLE_CLICK_SINCE = new Date('2026-07-08T00:00:00Z');

/* ── Pure helpers (unit-tested) ─────────────────────────────────────────── */

/** Attach an integrity tag to a value. */
export function tag<T>(value: T, integrityTag: IntegrityTag): TaggedMetric<T> {
  return { value, tag: integrityTag };
}

/** Percentage (0–100, 1 decimal). Returns 0 when the denominator is 0. */
export function pct(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Ratio part/whole, or null when the denominator is 0 (undefined rate). */
export function rateOrNull(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 1000;
}

/** Reviews per waiter (1 decimal), or null when no waiter denominator exists. */
export function reviewsPerWaiter(reviewCount: number, waiterCount: number): number | null {
  if (!Number.isFinite(reviewCount) || !Number.isFinite(waiterCount) || waiterCount <= 0) {
    return null;
  }
  return Math.round((reviewCount / waiterCount) * 10) / 10;
}

export type MetricTrendDirection = 'up' | 'down' | 'flat';

/** Comparison direction; missing values are not comparable and render flat. */
export function metricTrendDirection(
  current: number | null,
  previous: number | null,
): MetricTrendDirection {
  if (current === null || previous === null || current === previous) return 'flat';
  return current > previous ? 'up' : 'down';
}

/** Conversion % between two consecutive funnel steps; null when the previous
 *  step is 0 (conversion undefined, not 0%). */
export function funnelConversion(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return Math.round((to / from) * 1000) / 10;
}

export type AdoptionState = 'active' | 'occasional' | 'unused';

/** Feature adoption thresholds: ≥8 active days in the last 30 → active,
 *  1–7 → occasional, 0 → unused. */
export function adoptionState(activeDays30: number): AdoptionState {
  if (activeDays30 >= 8) return 'active';
  if (activeDays30 >= 1) return 'occasional';
  return 'unused';
}

/** ISO calendar day (YYYY-MM-DD) of a timestamp in Mexico City. */
export function mexicoDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: MX_TZ });
}

/* ── Internal helpers ───────────────────────────────────────────────────── */

const countSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  sql<number>(strings, ...values).mapWith(Number);

const numSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  sql<number>(strings, ...values).mapWith(Number);

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function trended(value: number, prev: number, t: IntegrityTag): TrendedMetric {
  return { value, prev, tag: t };
}

/** Rolling window: start of `days` ago (Mexico calendar) and the previous
 *  window of the same length for trends. */
function windowBounds(days: number): { start: Date; prevStart: Date } {
  const start = new Date(startOfTodayMexico());
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);
  return { start, prevStart };
}

interface OperationalLocation {
  id: number;
  name: string;
  slug: string;
}

/** Operational restaurants only — owner/regional accounts and churned
 *  subscriptions (anything not active/trialing) are excluded. */
async function getOperationalLocations(): Promise<OperationalLocation[]> {
  return db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
        inArray(restaurants.subscriptionStatus, ['active', 'trialing']),
      ),
    )
    .orderBy(asc(restaurants.name));
}

/* ── 1. Group summary ───────────────────────────────────────────────────── */

export interface GroupSummary {
  days: number;
  windowStart: Date;
  prevWindowStart: Date;
  activeLocations: TrendedMetric;
  activeUsers: TrendedMetric;
  reviewsCaptured: TrendedMetric;
  googleClicks: TrendedMetric;
  negativeFeedback: TrendedMetric;
  negativeWithText: TrendedMetric;
  pctViewed: TrendedMetric;
  pctResolved: TrendedMetric;
  guestsCaptured: TrendedMetric;
  repeatGuests: TrendedMetric;
  consentRate: TrendedMetric;
  campaignsRun: TrendedMetric;
  campaignBookings: TrendedMetric;
  bookedCount: TrendedMetric;
  mxCollected: TrendedMetric;
  mxEligible: TrendedMetric;
  caveat: string;
  reviewsByDay: { date: string; count: number }[];
}

export async function getGroupSummary(days: 7 | 30 = 30): Promise<GroupSummary> {
  const { start, prevStart } = windowBounds(days);

  const locations = await getOperationalLocations();
  const ids = locations.map((l) => l.id);

  const empty: GroupSummary = {
    days,
    windowStart: start,
    prevWindowStart: prevStart,
    activeLocations: trended(0, 0, 'verified'),
    activeUsers: trended(0, 0, 'inferred'),
    reviewsCaptured: trended(0, 0, 'verified'),
    googleClicks: trended(0, 0, 'verified'),
    negativeFeedback: trended(0, 0, 'verified'),
    negativeWithText: trended(0, 0, 'verified'),
    pctViewed: trended(0, 0, 'verified'),
    pctResolved: trended(0, 0, 'verified'),
    guestsCaptured: trended(0, 0, 'verified'),
    repeatGuests: trended(0, 0, 'verified'),
    consentRate: trended(0, 0, 'verified'),
    campaignsRun: trended(0, 0, 'verified'),
    campaignBookings: trended(0, 0, 'reported'),
    bookedCount: trended(0, 0, 'reported'),
    mxCollected: trended(0, 0, 'reported'),
    mxEligible: trended(0, 0, 'reported'),
    caveat: '',
    reviewsByDay: [],
  };
  if (ids.length === 0) return empty;

  // Active users: distinct restaurant_id+role pairs with an app_open or
  // page_view in the window. Inferred — event capture starts at deploy.
  const activePairs = db
    .selectDistinct({
      restaurantId: productEvents.restaurantId,
      role: productEvents.role,
      isCurrent: sql<boolean>`${productEvents.createdAt} >= ${start}`.as('is_current'),
    })
    .from(productEvents)
    .where(
      and(
        inArray(productEvents.eventName, ['app_open', 'page_view']),
        gte(productEvents.createdAt, prevStart),
        sql`${productEvents.restaurantId} is not null`,
        sql`${productEvents.role} is not null`,
      ),
    )
    .as('active_pairs');

  // Guests with a visit in the current vs previous window (repeat = ≥2
  // guest_visits all-time), computed as a grouped subquery.
  const guestWindowVisits = db
    .select({
      guestId: guestVisits.guestId,
      visitedCurrent: sql<boolean>`bool_or(${guestVisits.visitDate} >= ${start})`.as('visited_current'),
      visitedPrev: sql<boolean>`bool_or(${guestVisits.visitDate} < ${start})`.as('visited_prev'),
    })
    .from(guestVisits)
    .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, prevStart)))
    .groupBy(guestVisits.guestId)
    .as('guest_window_visits');

  const [reviewAgg, reviewDays, userAgg, guestAgg, repeatAgg, campaignAgg, bookingAgg] =
    await Promise.all([
      // Reviews: current + previous window in one pass over the wide window.
      db
        .select({
          total: countSql`count(*) filter (where ${reviews.createdAt} >= ${start})`,
          totalPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start})`,
          google: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.sentToGoogle} = true)`,
          googlePrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start} and ${reviews.sentToGoogle} = true)`,
          neg: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3)`,
          negPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start} and ${reviews.rating} <= 3)`,
          negText: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null)`,
          negTextPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null)`,
          negViewed: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null and (${reviews.status} <> 'new' or ${reviews.reviewedAt} is not null))`,
          negViewedPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null and (${reviews.status} <> 'new' or ${reviews.reviewedAt} is not null))`,
          negResolved: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null and (${reviews.resolvedAt} is not null or ${reviews.status} = 'resolved'))`,
          negResolvedPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null and (${reviews.resolvedAt} is not null or ${reviews.status} = 'resolved'))`,
          locs: countSql`count(distinct ${reviews.restaurantId}) filter (where ${reviews.createdAt} >= ${start})`,
          locsPrev: countSql`count(distinct ${reviews.restaurantId}) filter (where ${reviews.createdAt} < ${start})`,
        })
        .from(reviews)
        .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, prevStart))),

      // Reviews per Mexico calendar day (for the trend chart).
      db
        .select({
          date: sql<string>`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date::text`,
          count: countSql`count(*)`,
        })
        .from(reviews)
        .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, start)))
        .groupBy(sql`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date`)
        .orderBy(sql`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date`),

      // Active users: distinct restaurant_id+role pairs with an app_open or
      // page_view in the window. Inferred — event capture starts at deploy.
      db
        .select({
          cur: countSql`count(*) filter (where ${activePairs.isCurrent})`,
          prev: countSql`count(*) filter (where not ${activePairs.isCurrent})`,
        })
        .from(activePairs),

      // Guests captured + consent in the window.
      db
        .select({
          captured: countSql`count(*) filter (where ${guests.capturedAt} >= ${start})`,
          capturedPrev: countSql`count(*) filter (where ${guests.capturedAt} < ${start})`,
          consented: countSql`count(*) filter (where ${guests.capturedAt} >= ${start} and ${guests.marketingConsent} = true)`,
          consentedPrev: countSql`count(*) filter (where ${guests.capturedAt} < ${start} and ${guests.marketingConsent} = true)`,
        })
        .from(guests)
        .where(and(inArray(guests.restaurantId, ids), gte(guests.capturedAt, prevStart))),

      // Repeat guests: ≥2 guest_visits all-time AND ≥1 visit in the window.
      db
        .select({
          cur: countSql`count(*) filter (where ${guestWindowVisits.visitedCurrent})`,
          prev: countSql`count(*) filter (where ${guestWindowVisits.visitedPrev})`,
        })
        .from(guestWindowVisits)
        .where(
          sql`(select count(*) from ${guestVisits} all_v where all_v.guest_id = ${guestWindowVisits.guestId}) >= 2`,
        ),

      // Campaigns launched or created in the window.
      db
        .select({
          cur: countSql`count(*) filter (where coalesce(${eventCampaigns.launchedAt}, ${eventCampaigns.createdAt}) >= ${start})`,
          prev: countSql`count(*) filter (where coalesce(${eventCampaigns.launchedAt}, ${eventCampaigns.createdAt}) < ${start})`,
        })
        .from(eventCampaigns)
        .where(
          and(
            inArray(eventCampaigns.restaurantId, ids),
            sql`coalesce(${eventCampaigns.launchedAt}, ${eventCampaigns.createdAt}) >= ${prevStart}`,
          ),
        ),

      // Campaign bookings (self-reported by the manager).
      db
        .select({
          cur: countSql`count(*) filter (where ${campaignBookings.createdAt} >= ${start})`,
          prev: countSql`count(*) filter (where ${campaignBookings.createdAt} < ${start})`,
          booked: countSql`count(*) filter (where ${campaignBookings.createdAt} >= ${start} and ${campaignBookings.status} in ('booked', 'attended'))`,
          bookedPrev: countSql`count(*) filter (where ${campaignBookings.createdAt} < ${start} and ${campaignBookings.status} in ('booked', 'attended'))`,
          collected: numSql`coalesce(sum(${campaignBookings.collectedAmount}) filter (where ${campaignBookings.createdAt} >= ${start}), 0)`,
          collectedPrev: numSql`coalesce(sum(${campaignBookings.collectedAmount}) filter (where ${campaignBookings.createdAt} < ${start}), 0)`,
          eligible: numSql`coalesce(sum(${campaignBookings.eligibleRevenue}) filter (where ${campaignBookings.createdAt} >= ${start}), 0)`,
          eligiblePrev: numSql`coalesce(sum(${campaignBookings.eligibleRevenue}) filter (where ${campaignBookings.createdAt} < ${start}), 0)`,
        })
        .from(campaignBookings)
        .where(
          and(
            inArray(campaignBookings.restaurantId, ids),
            gte(campaignBookings.createdAt, prevStart),
          ),
        ),
    ]);

  const r = reviewAgg[0];
  const g = guestAgg[0];
  const c = campaignAgg[0];
  const b = bookingAgg[0];
  const repeat = repeatAgg[0];
  const users = userAgg[0];

  const negText = num(r?.negText);
  const negTextPrev = num(r?.negTextPrev);
  const captured = num(g?.captured);
  const capturedPrev = num(g?.capturedPrev);

  return {
    days,
    windowStart: start,
    prevWindowStart: prevStart,
    activeLocations: trended(num(r?.locs), num(r?.locsPrev), 'verified'),
    activeUsers: trended(num(users?.cur), num(users?.prev), 'inferred'),
    reviewsCaptured: trended(num(r?.total), num(r?.totalPrev), 'verified'),
    googleClicks: trended(num(r?.google), num(r?.googlePrev), 'verified'),
    negativeFeedback: trended(num(r?.neg), num(r?.negPrev), 'verified'),
    negativeWithText: trended(negText, negTextPrev, 'verified'),
    pctViewed: trended(
      pct(num(r?.negViewed), negText),
      pct(num(r?.negViewedPrev), negTextPrev),
      'verified',
    ),
    pctResolved: trended(
      pct(num(r?.negResolved), negText),
      pct(num(r?.negResolvedPrev), negTextPrev),
      'verified',
    ),
    guestsCaptured: trended(captured, capturedPrev, 'verified'),
    repeatGuests: trended(num(repeat?.cur), num(repeat?.prev), 'verified'),
    consentRate: trended(
      pct(num(g?.consented), captured),
      pct(num(g?.consentedPrev), capturedPrev),
      'verified',
    ),
    campaignsRun: trended(num(c?.cur), num(c?.prev), 'verified'),
    campaignBookings: trended(num(b?.cur), num(b?.prev), 'reported'),
    bookedCount: trended(num(b?.booked), num(b?.bookedPrev), 'reported'),
    mxCollected: trended(num(b?.collected), num(b?.collectedPrev), 'reported'),
    mxEligible: trended(num(b?.eligible), num(b?.eligiblePrev), 'reported'),
    caveat:
      'sent_to_google significa «clic en la opción de Google» solo para reseñas creadas desde el 8 jul 2026; antes de esa fecha el campo no distingue la intención.',
    reviewsByDay: reviewDays.map((d) => ({ date: d.date, count: num(d.count) })),
  };
}

/* ── 2. Location comparison ─────────────────────────────────────────────── */

export interface LocationComparisonRow {
  restaurantId: number;
  slug: string;
  name: string;
  activeUsers: number; // distinct roles with app_open/page_view (inferred)
  lastActiveAt: Date | null; // max product_events.created_at for gm/owner/regional
  reviews: number;
  reviewsPrev: number;
  reviewsPerRegisteredWaiter: number | null; // verified: reviews / active staff rows
  reviewsPerRegisteredWaiterPrev: number | null;
  reviewsPerActiveWaiter: number | null; // verified: reviews / staff with reviews
  reviewsPerActiveWaiterPrev: number | null;
  googleClickPct: number | null; // since 2026-07-08 only
  lowCount: number;
  lowPct: number;
  lowWithText: number;
  resolutionPct: number | null; // touched share of low-with-text
  medianHoursToView: number | null; // inferred (reviewed_at exists only from deploy)
  medianHoursToResolve: number | null;
  staffActive: number;
  staffWithReviews: number;
  unknownCodePct: number | null; // staff_id null share of window reviews
  guestsCaptured: number;
  guestsConsented: number;
  repeatGuests: number;
  vipGuests: number;
  lapsed60: number;
  birthdaysThisMonth: number;
  campaignBookings: number; // reported
  mxCollected: number; // reported
  quotesCreated: number;
  quotesSent: number;
  pushSubscriptions: number;
  pushClicks: number;
  lastReviewAt: Date | null;
  pwaStandaloneOpens: number;
  reviewsByDay: { date: string; count: number }[];
}

export async function getLocationComparison(days: 7 | 30 = 30): Promise<LocationComparisonRow[]> {
  const { start, prevStart } = windowBounds(days);
  const locations = await getOperationalLocations();
  if (locations.length === 0) return [];
  const ids = locations.map((l) => l.id);

  const since60 = new Date(Date.now() - 60 * 86_400_000);

  const currentMonthMm = todayBirthdayKeyMexico().slice(3); // 'MM' from 'DD/MM'

  const [
    reviewAgg,
    reviewDaysRows,
    eventAgg,
    staffAgg,
    guestAgg,
    repeatRows,
    vipRows,
    lapsedRows,
    birthdayRows,
    bookingAgg,
    quoteAgg,
    pushSubRows,
    medianRows,
  ] = await Promise.all([
    // Per-location review counts, current + previous window.
    db
      .select({
        restaurantId: reviews.restaurantId,
        total: countSql`count(*) filter (where ${reviews.createdAt} >= ${start})`,
        totalPrev: countSql`count(*) filter (where ${reviews.createdAt} < ${start})`,
        google: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.createdAt} >= ${GOOGLE_CLICK_SINCE} and ${reviews.sentToGoogle} = true)`,
        googleBase: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.createdAt} >= ${GOOGLE_CLICK_SINCE})`,
        low: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3)`,
        lowText: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null)`,
        lowTouched: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3 and ${reviews.feedback} is not null and (${reviews.status} <> 'new' or ${reviews.reviewedAt} is not null or ${reviews.resolvedAt} is not null))`,
        staffWithReviews: countSql`count(distinct ${reviews.staffId}) filter (where ${reviews.createdAt} >= ${start} and ${reviews.staffId} is not null)`,
        staffWithReviewsPrev: countSql`count(distinct ${reviews.staffId}) filter (where ${reviews.createdAt} < ${start} and ${reviews.staffId} is not null)`,
        unknownCode: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.staffId} is null)`,
        lastReviewAt: sql<Date | null>`max(${reviews.createdAt}) filter (where ${reviews.createdAt} >= ${start})`,
      })
      .from(reviews)
      .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, prevStart)))
      .groupBy(reviews.restaurantId),

    // Per-location reviews per Mexico day (trend sparklines).
    db
      .select({
        restaurantId: reviews.restaurantId,
        date: sql<string>`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date::text`,
        count: countSql`count(*)`,
      })
      .from(reviews)
      .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, start)))
      .groupBy(reviews.restaurantId, sql`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date`),

    // Per-location product events: active roles, last activity, push clicks,
    // PWA standalone opens.
    db
      .select({
        restaurantId: productEvents.restaurantId,
        activeRoles: countSql`count(distinct ${productEvents.role}) filter (where ${productEvents.eventName} in ('app_open', 'page_view') and ${productEvents.role} is not null)`,
        lastActiveAt: sql<Date | null>`max(${productEvents.createdAt}) filter (where ${productEvents.eventName} in ('app_open', 'page_view') and ${productEvents.role} in ('gm', 'owner', 'regional'))`,
        pushClicks: countSql`count(*) filter (where ${productEvents.eventName} = 'push_notification_click')`,
        pwaOpens: countSql`count(*) filter (where ${productEvents.eventName} = 'app_open' and ${productEvents.displayMode} = 'standalone')`,
      })
      .from(productEvents)
      .where(and(inArray(productEvents.restaurantId, ids), gte(productEvents.createdAt, start)))
      .groupBy(productEvents.restaurantId),

    // Staff roster size.
    db
      .select({
        restaurantId: staff.restaurantId,
        active: countSql`count(*) filter (where ${staff.active} = true)`,
      })
      .from(staff)
      .where(inArray(staff.restaurantId, ids))
      .groupBy(staff.restaurantId),

    // Guests captured/consented in the window (by capture restaurant).
    db
      .select({
        restaurantId: guests.restaurantId,
        captured: countSql`count(*)`,
        consented: countSql`count(*) filter (where ${guests.marketingConsent} = true)`,
      })
      .from(guests)
      .where(and(inArray(guests.restaurantId, ids), gte(guests.capturedAt, start)))
      .groupBy(guests.restaurantId),

    // Repeat guests (≥2 visits all-time, visited in window) per location.
    db
      .select({
        restaurantId: guestVisits.restaurantId,
        count: countSql`count(distinct ${guestVisits.guestId})`,
      })
      .from(guestVisits)
      .where(
        and(
          inArray(guestVisits.restaurantId, ids),
          gte(guestVisits.visitDate, start),
          sql`(select count(*) from ${guestVisits} all_v where all_v.guest_id = ${guestVisits.guestId}) >= 2`,
        ),
      )
      .groupBy(guestVisits.restaurantId),

    // VIP guests (≥5 visits all-time, visited in window) per location.
    db
      .select({
        restaurantId: guestVisits.restaurantId,
        count: countSql`count(distinct ${guestVisits.guestId})`,
      })
      .from(guestVisits)
      .where(
        and(
          inArray(guestVisits.restaurantId, ids),
          gte(guestVisits.visitDate, start),
          sql`(select count(*) from ${guestVisits} all_v where all_v.guest_id = ${guestVisits.guestId}) >= 5`,
        ),
      )
      .groupBy(guestVisits.restaurantId),

    // Lapsed guests: ≥1 visit all-time, last visit more than 60 days ago.
    db
      .select({
        restaurantId: guests.restaurantId,
        count: countSql`count(*)`,
      })
      .from(guests)
      .where(
        and(
          inArray(guests.restaurantId, ids),
          sql`(select count(*) from ${guestVisits} v where v.guest_id = ${guests.id}) >= 1`,
          sql`(select max(v2.visit_date) from ${guestVisits} v2 where v2.guest_id = ${guests.id}) < ${since60}`,
        ),
      )
      .groupBy(guests.restaurantId),

    // Birthdays in the current Mexico month (birthday_mmdd is 'DD/MM').
    db
      .select({
        restaurantId: guests.restaurantId,
        count: countSql`count(*)`,
      })
      .from(guests)
      .where(
        and(
          inArray(guests.restaurantId, ids),
          sql`substring(${guests.birthdayMmdd} from 4 for 2) = ${currentMonthMm}`,
        ),
      )
      .groupBy(guests.restaurantId),

    // Campaign bookings + collected revenue (self-reported).
    db
      .select({
        restaurantId: campaignBookings.restaurantId,
        bookings: countSql`count(*)`,
        collected: numSql`coalesce(sum(${campaignBookings.collectedAmount}), 0)`,
      })
      .from(campaignBookings)
      .where(
        and(
          inArray(campaignBookings.restaurantId, ids),
          gte(campaignBookings.createdAt, start),
        ),
      )
      .groupBy(campaignBookings.restaurantId),

    // Quotes created / sent in the window.
    db
      .select({
        restaurantId: quotes.restaurantId,
        created: countSql`count(*) filter (where ${quotes.createdAt} >= ${start})`,
        sent: countSql`count(*) filter (where ${quotes.sentAt} is not null and ${quotes.sentAt} >= ${start})`,
      })
      .from(quotes)
      .where(
        and(
          inArray(quotes.restaurantId, ids),
          sql`(${quotes.createdAt} >= ${start} or ${quotes.sentAt} >= ${start})`,
        ),
      )
      .groupBy(quotes.restaurantId),

    // Active push subscription counts (all-time presence, not windowed).
    db
      .select({
        restaurantId: pushSubscriptions.restaurantId,
        count: countSql`count(*)`,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.restaurantId, ids),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .groupBy(pushSubscriptions.restaurantId),

    // Median hours to view / resolve (inferred from reviewed_at/resolved_at,
    // which exist only from the deploy — null when no data).
    db
      .select({
        restaurantId: reviews.restaurantId,
        medianViewHours: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${reviews.reviewedAt} - ${reviews.createdAt})) / 3600.0) filter (where ${reviews.reviewedAt} is not null)`.mapWith((v) => (v === null ? null : Number(v))),
        medianResolveHours: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${reviews.resolvedAt} - ${reviews.createdAt})) / 3600.0) filter (where ${reviews.resolvedAt} is not null)`.mapWith((v) => (v === null ? null : Number(v))),
      })
      .from(reviews)
      .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, start)))
      .groupBy(reviews.restaurantId),
  ]);

  const byId = <T extends { restaurantId: number | null }>(rows: T[]) => {
    const m = new Map<number, T>();
    for (const row of rows) if (row.restaurantId !== null) m.set(row.restaurantId, row);
    return m;
  };

  const reviewMap = byId(reviewAgg);
  const eventMap = byId(eventAgg);
  const staffMap = byId(staffAgg);
  const guestMap = byId(guestAgg);
  const repeatMap = byId(repeatRows);
  const vipMap = byId(vipRows);
  const lapsedMap = byId(lapsedRows);
  const birthdayMap = byId(birthdayRows);
  const bookingMap = byId(bookingAgg);
  const quoteMap = byId(quoteAgg);
  const pushSubMap = byId(pushSubRows);
  const medianMap = byId(medianRows);

  const daysByRestaurant = new Map<number, { date: string; count: number }[]>();
  for (const row of reviewDaysRows) {
    if (row.restaurantId === null) continue;
    const list = daysByRestaurant.get(row.restaurantId) ?? [];
    list.push({ date: row.date, count: num(row.count) });
    daysByRestaurant.set(row.restaurantId, list);
  }
  for (const list of daysByRestaurant.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  return locations.map((loc) => {
    const r = reviewMap.get(loc.id);
    const e = eventMap.get(loc.id);
    const g = guestMap.get(loc.id);
    const b = bookingMap.get(loc.id);
    const m = medianMap.get(loc.id);

    const total = num(r?.total);
    const totalPrev = num(r?.totalPrev);
    const low = num(r?.low);
    const lowText = num(r?.lowText);
    const googleBase = num(r?.googleBase);
    const registeredWaiters = num(staffMap.get(loc.id)?.active);
    const activeWaiters = num(r?.staffWithReviews);
    const activeWaitersPrev = num(r?.staffWithReviewsPrev);

    return {
      restaurantId: loc.id,
      slug: loc.slug,
      name: loc.name,
      activeUsers: num(e?.activeRoles),
      lastActiveAt: e?.lastActiveAt ?? null,
      reviews: total,
      reviewsPrev: totalPrev,
      reviewsPerRegisteredWaiter: reviewsPerWaiter(total, registeredWaiters),
      reviewsPerRegisteredWaiterPrev: reviewsPerWaiter(totalPrev, registeredWaiters),
      reviewsPerActiveWaiter: reviewsPerWaiter(total, activeWaiters),
      reviewsPerActiveWaiterPrev: reviewsPerWaiter(totalPrev, activeWaitersPrev),
      googleClickPct: googleBase > 0 ? pct(num(r?.google), googleBase) : null,
      lowCount: low,
      lowPct: pct(low, total),
      lowWithText: lowText,
      resolutionPct: lowText > 0 ? pct(num(r?.lowTouched), lowText) : null,
      medianHoursToView: m?.medianViewHours ?? null,
      medianHoursToResolve: m?.medianResolveHours ?? null,
      staffActive: registeredWaiters,
      staffWithReviews: activeWaiters,
      unknownCodePct: total > 0 ? pct(num(r?.unknownCode), total) : null,
      guestsCaptured: num(g?.captured),
      guestsConsented: num(g?.consented),
      repeatGuests: num(repeatMap.get(loc.id)?.count),
      vipGuests: num(vipMap.get(loc.id)?.count),
      lapsed60: num(lapsedMap.get(loc.id)?.count),
      birthdaysThisMonth: num(birthdayMap.get(loc.id)?.count),
      campaignBookings: num(b?.bookings),
      mxCollected: num(b?.collected),
      quotesCreated: num(quoteMap.get(loc.id)?.created),
      quotesSent: num(quoteMap.get(loc.id)?.sent),
      pushSubscriptions: num(pushSubMap.get(loc.id)?.count),
      pushClicks: num(e?.pushClicks),
      lastReviewAt: r?.lastReviewAt ?? null,
      pwaStandaloneOpens: num(e?.pwaOpens),
      reviewsByDay: daysByRestaurant.get(loc.id) ?? [],
    };
  });
}

/* ── 3. Feature adoption matrix ─────────────────────────────────────────── */

/**
 * Feature usage signal map. Each feature maps to the persisted signal(s) that
 * count as "usage"; a location is `active` on a feature when it has ≥8
 * distinct Mexico-City days with a signal in the last 30 days, `occasional`
 * with 1–7, and `unused` with 0. Exported for the UI legend/tooltips.
 */
export const FEATURE_SOURCES = {
  reviews: {
    label: 'Reseñas',
    source: 'Filas de reseñas creadas',
    tag: 'verified',
  },
  feedback_inbox: {
    label: 'Bandeja de feedback',
    source: 'page_view en /inbox',
    tag: 'verified',
  },
  resolution: {
    label: 'Resolución',
    source: 'reviews.reviewed_at / resolved_at (existen solo desde el despliegue)',
    tag: 'verified',
  },
  staff_leaderboard: {
    label: 'Tablero de staff',
    source: 'page_view en /live, /staff o /analytics, o staff_scoreboard_open',
    tag: 'verified',
  },
  guest_crm: {
    label: 'CRM de invitados',
    source: 'page_view en /guests o guest_profile_opened',
    tag: 'verified',
  },
  guest_validation: {
    label: 'Validación',
    source: 'guests.validated_at o guest_visits.visit_date',
    tag: 'verified',
  },
  birthday_view: {
    label: 'Vista cumpleaños',
    source: 'guest_filter_changed (today/birthdays) o page_view con filter=today/birthdays',
    tag: 'verified',
  },
  lapsed_view: {
    label: 'Vista ausentes 60d',
    source: 'guest_filter_changed (absent60)',
    tag: 'verified',
  },
  campaigns: {
    label: 'Campañas',
    source: 'page_view en /campaigns o campaign_contacts.last_action_at',
    tag: 'verified',
  },
  bookings: {
    label: 'Reservas',
    source: 'campaign_bookings creadas/actualizadas',
    tag: 'reported',
  },
  quotes: {
    label: 'Cotizaciones',
    source: 'quotes creadas/actualizadas o page_view en /quotes',
    tag: 'verified',
  },
  leads: {
    label: 'Leads de eventos',
    source: 'event_leads creados/reclamados o page_view en /leads',
    tag: 'verified',
  },
  pwa: {
    label: 'PWA instalada',
    source: "app_open con display_mode 'standalone'",
    tag: 'verified',
  },
  push: {
    label: 'Push',
    source: 'push_notification_click (clics) y presencia de suscripción',
    tag: 'verified',
  },
  csv_export: {
    label: 'Exportar CSV',
    source: 'Eventos csv_export',
    tag: 'verified',
  },
} as const satisfies Record<string, { label: string; source: string; tag: IntegrityTag }>;

export type FeatureKey = keyof typeof FEATURE_SOURCES;

export interface FeatureAdoptionCell {
  days7: number;
  days30: number;
  activeDays30: number;
  state: AdoptionState;
}

export interface FeatureAdoptionMatrix {
  locations: { restaurantId: number; slug: string; name: string }[];
  features: FeatureKey[];
  cells: Record<number, Record<FeatureKey, FeatureAdoptionCell>>;
  /** Owner/regional usage is group-level, not per-location. */
  multiViewUsage: {
    owner: { days7: number; days30: number };
    regional: { days7: number; days30: number };
  };
}

interface DailyRow {
  restaurantId: number | null;
  day: string;
  n: number;
}

/** Merge daily-count rows from one or more sources into per-location usage. */
function buildUsage(sets: DailyRow[][], cutoffDay7: string): Map<number, FeatureAdoptionCell> {
  const acc = new Map<number, { days7: number; days30: number; days: Set<string> }>();
  for (const rows of sets) {
    for (const r of rows) {
      if (r.restaurantId === null) continue;
      const e = acc.get(r.restaurantId) ?? { days7: 0, days30: 0, days: new Set<string>() };
      const n = num(r.n);
      e.days30 += n;
      if (r.day >= cutoffDay7) e.days7 += n;
      e.days.add(r.day);
      acc.set(r.restaurantId, e);
    }
  }
  const out = new Map<number, FeatureAdoptionCell>();
  for (const [id, e] of acc) {
    out.set(id, {
      days7: e.days7,
      days30: e.days30,
      activeDays30: e.days.size,
      state: adoptionState(e.days.size),
    });
  }
  return out;
}

function emptyCell(): FeatureAdoptionCell {
  return { days7: 0, days30: 0, activeDays30: 0, state: 'unused' };
}

export async function getFeatureAdoptionMatrix(): Promise<FeatureAdoptionMatrix> {
  const locations = await getOperationalLocations();
  const featureKeys = Object.keys(FEATURE_SOURCES) as FeatureKey[];
  const base: FeatureAdoptionMatrix = {
    locations: locations.map((l) => ({ restaurantId: l.id, slug: l.slug, name: l.name })),
    features: featureKeys,
    cells: {},
    multiViewUsage: { owner: { days7: 0, days30: 0 }, regional: { days7: 0, days30: 0 } },
  };
  if (locations.length === 0) return base;
  const ids = locations.map((l) => l.id);

  const w30 = windowBounds(30).start;
  const w7 = windowBounds(7).start;
  const cutoffDay7 = mexicoDay(w7);

  // Daily signal counts per location, bucketed by Mexico calendar day.
  const eventDaily = (cond: ReturnType<typeof sql>) =>
    db
      .select({
        restaurantId: productEvents.restaurantId,
        day: sql<string>`(${productEvents.createdAt} at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(productEvents)
      .where(
        and(
          inArray(productEvents.restaurantId, ids),
          gte(productEvents.createdAt, w30),
          cond,
        ),
      )
      .groupBy(
        productEvents.restaurantId,
        sql`(${productEvents.createdAt} at time zone ${MX_TZ_SQL})::date`,
      );

  const pageView = (pathCond: ReturnType<typeof sql>) =>
    sql`${productEvents.eventName} = 'page_view' and ${pathCond}`;

  const [
    reviewRows,
    inboxRows,
    resolutionRows,
    leaderboardRows,
    guestCrmRows,
    validationGuestRows,
    validationVisitRows,
    birthdayRows,
    lapsedRows,
    campaignPageRows,
    campaignActionRows,
    bookingRows,
    quoteRows,
    quotePageRows,
    leadRows,
    leadPageRows,
    pwaRows,
    pushClickRows,
    pushSubRows,
    multiViewRows,
  ] = await Promise.all([
    // reviews → reviews rows
    db
      .select({
        restaurantId: reviews.restaurantId,
        day: sql<string>`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(reviews)
      .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, w30)))
      .groupBy(reviews.restaurantId, sql`(${reviews.createdAt} at time zone ${MX_TZ_SQL})::date`),

    // feedback_inbox → page_view /inbox
    eventDaily(pageView(sql`${productEvents.path} ilike '/inbox%'`)),

    // resolution → reviews.reviewed_at / resolved_at (from this deploy onward)
    db
      .select({
        restaurantId: reviews.restaurantId,
        day: sql<string>`(coalesce(${reviews.resolvedAt}, ${reviews.reviewedAt}) at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(reviews)
      .where(
        and(
          inArray(reviews.restaurantId, ids),
          sql`coalesce(${reviews.resolvedAt}, ${reviews.reviewedAt}) is not null`,
          sql`coalesce(${reviews.resolvedAt}, ${reviews.reviewedAt}) >= ${w30}`,
        ),
      )
      .groupBy(
        reviews.restaurantId,
        sql`(coalesce(${reviews.resolvedAt}, ${reviews.reviewedAt}) at time zone ${MX_TZ_SQL})::date`,
      ),

    // staff_leaderboard → /live, /staff, /analytics page views or scoreboard open
    eventDaily(
      sql`(${pageView(sql`(${productEvents.path} ilike '/live%' or ${productEvents.path} ilike '/staff%' or ${productEvents.path} ilike '/analytics%')`)}) or ${productEvents.eventName} = 'staff_scoreboard_open'`,
    ),

    // guest_crm → /guests page views or guest_profile_opened
    eventDaily(
      sql`(${pageView(sql`${productEvents.path} ilike '/guests%'`)}) or ${productEvents.eventName} = 'guest_profile_opened'`,
    ),

    // guest_validation → guests.validated_at …
    db
      .select({
        restaurantId: guests.restaurantId,
        day: sql<string>`(${guests.validatedAt} at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(guests)
      .where(
        and(
          inArray(guests.restaurantId, ids),
          sql`${guests.validatedAt} is not null`,
          gte(guests.validatedAt, w30),
        ),
      )
      .groupBy(guests.restaurantId, sql`(${guests.validatedAt} at time zone ${MX_TZ_SQL})::date`),

    // … or guest_visits.visit_date
    db
      .select({
        restaurantId: guestVisits.restaurantId,
        day: sql<string>`(${guestVisits.visitDate} at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(guestVisits)
      .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, w30)))
      .groupBy(guestVisits.restaurantId, sql`(${guestVisits.visitDate} at time zone ${MX_TZ_SQL})::date`),

    // birthday_view → filter today/birthdays
    eventDaily(
      sql`(${productEvents.eventName} = 'guest_filter_changed' and ${productEvents.properties}->>'filter' in ('today', 'birthdays'))
          or (${pageView(sql`(${productEvents.path} ilike '%filter=today%' or ${productEvents.path} ilike '%filter=birthdays%')`)})`,
    ),

    // lapsed_view → filter absent60
    eventDaily(
      sql`${productEvents.eventName} = 'guest_filter_changed' and ${productEvents.properties}->>'filter' = 'absent60'`,
    ),

    // campaigns → /campaigns page views …
    eventDaily(pageView(sql`${productEvents.path} ilike '/campaigns%'`)),

    // … or campaign_contacts.last_action_at
    db
      .select({
        restaurantId: campaignContacts.restaurantId,
        day: sql<string>`(${campaignContacts.lastActionAt} at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(campaignContacts)
      .where(
        and(
          inArray(campaignContacts.restaurantId, ids),
          sql`${campaignContacts.lastActionAt} is not null`,
          gte(campaignContacts.lastActionAt, w30),
        ),
      )
      .groupBy(campaignContacts.restaurantId, sql`(${campaignContacts.lastActionAt} at time zone ${MX_TZ_SQL})::date`),

    // bookings → campaign_bookings created/updated (self-reported)
    db
      .select({
        restaurantId: campaignBookings.restaurantId,
        day: sql<string>`(greatest(${campaignBookings.createdAt}, ${campaignBookings.updatedAt}) at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(campaignBookings)
      .where(
        and(
          inArray(campaignBookings.restaurantId, ids),
          sql`greatest(${campaignBookings.createdAt}, ${campaignBookings.updatedAt}) >= ${w30}`,
        ),
      )
      .groupBy(
        campaignBookings.restaurantId,
        sql`(greatest(${campaignBookings.createdAt}, ${campaignBookings.updatedAt}) at time zone ${MX_TZ_SQL})::date`,
      ),

    // quotes → quotes created/updated …
    db
      .select({
        restaurantId: quotes.restaurantId,
        day: sql<string>`(greatest(${quotes.createdAt}, ${quotes.updatedAt}) at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(quotes)
      .where(
        and(
          inArray(quotes.restaurantId, ids),
          sql`greatest(${quotes.createdAt}, ${quotes.updatedAt}) >= ${w30}`,
        ),
      )
      .groupBy(
        quotes.restaurantId,
        sql`(greatest(${quotes.createdAt}, ${quotes.updatedAt}) at time zone ${MX_TZ_SQL})::date`,
      ),

    // … or page_view /quotes
    eventDaily(pageView(sql`${productEvents.path} ilike '/quotes%'`)),

    // leads → event_leads created/claimed …
    db
      .select({
        restaurantId: eventLeads.restaurantId,
        day: sql<string>`(coalesce(${eventLeads.claimedAt}, ${eventLeads.createdAt}) at time zone ${MX_TZ_SQL})::date::text`,
        n: countSql`count(*)`,
      })
      .from(eventLeads)
      .where(
        and(
          inArray(eventLeads.restaurantId, ids),
          sql`coalesce(${eventLeads.claimedAt}, ${eventLeads.createdAt}) >= ${w30}`,
        ),
      )
      .groupBy(
        eventLeads.restaurantId,
        sql`(coalesce(${eventLeads.claimedAt}, ${eventLeads.createdAt}) at time zone ${MX_TZ_SQL})::date`,
      ),

    // … or page_view /leads
    eventDaily(pageView(sql`${productEvents.path} ilike '/leads%'`)),

    // pwa → app_open with display_mode standalone
    eventDaily(
      sql`${productEvents.eventName} = 'app_open' and ${productEvents.displayMode} = 'standalone'`,
    ),

    // push → push_notification_click …
    eventDaily(sql`${productEvents.eventName} = 'push_notification_click'`),

    // … plus subscription presence (count > 0 ⇒ at least occasional usage)
    db
      .select({
        restaurantId: pushSubscriptions.restaurantId,
        n: countSql`count(*)`,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.restaurantId, ids),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .groupBy(pushSubscriptions.restaurantId),

    // Owner/regional group-level usage
    db
      .select({
        role: productEvents.role,
        d7: countSql`count(*) filter (where ${productEvents.createdAt} >= ${w7})`,
        d30: countSql`count(*)`,
      })
      .from(productEvents)
      .where(
        and(
          inArray(productEvents.eventName, ['app_open', 'page_view']),
          inArray(productEvents.role, ['owner', 'regional']),
          gte(productEvents.createdAt, w30),
        ),
      )
      .groupBy(productEvents.role),
  ]);

  const usageByFeature: Record<FeatureKey, Map<number, FeatureAdoptionCell>> = {
    reviews: buildUsage([reviewRows], cutoffDay7),
    feedback_inbox: buildUsage([inboxRows], cutoffDay7),
    resolution: buildUsage([resolutionRows], cutoffDay7),
    staff_leaderboard: buildUsage([leaderboardRows], cutoffDay7),
    guest_crm: buildUsage([guestCrmRows], cutoffDay7),
    guest_validation: buildUsage([validationGuestRows, validationVisitRows], cutoffDay7),
    birthday_view: buildUsage([birthdayRows], cutoffDay7),
    lapsed_view: buildUsage([lapsedRows], cutoffDay7),
    campaigns: buildUsage([campaignPageRows, campaignActionRows], cutoffDay7),
    bookings: buildUsage([bookingRows], cutoffDay7),
    quotes: buildUsage([quoteRows, quotePageRows], cutoffDay7),
    leads: buildUsage([leadRows, leadPageRows], cutoffDay7),
    pwa: buildUsage([pwaRows], cutoffDay7),
    push: buildUsage([pushClickRows], cutoffDay7),
    csv_export: buildUsage([], cutoffDay7),
  };

  // csv_export events (kept out of the big Promise.all for readability).
  const csvRows = await eventDaily(sql`${productEvents.eventName} = 'csv_export'`);
  usageByFeature.csv_export = buildUsage([csvRows], cutoffDay7);

  // Push presence: a location with ≥1 subscription but no clicks still counts
  // as occasional (presence signal).
  for (const row of pushSubRows) {
    if (row.restaurantId === null || num(row.n) <= 0) continue;
    const cell = usageByFeature.push.get(row.restaurantId) ?? emptyCell();
    if (cell.activeDays30 === 0) {
      cell.activeDays30 = 1;
      cell.state = 'occasional';
    }
    usageByFeature.push.set(row.restaurantId, cell);
  }

  const cells: Record<number, Record<FeatureKey, FeatureAdoptionCell>> = {};
  for (const loc of base.locations) {
    const row = {} as Record<FeatureKey, FeatureAdoptionCell>;
    for (const key of featureKeys) {
      row[key] = usageByFeature[key].get(loc.restaurantId) ?? emptyCell();
    }
    cells[loc.restaurantId] = row;
  }

  const multiViewUsage = {
    owner: { days7: 0, days30: 0 },
    regional: { days7: 0, days30: 0 },
  };
  for (const row of multiViewRows) {
    if (row.role === 'owner' || row.role === 'regional') {
      multiViewUsage[row.role] = { days7: num(row.d7), days30: num(row.d30) };
    }
  }

  return { ...base, cells, multiViewUsage };
}

/* ── 4. Review funnel ───────────────────────────────────────────────────── */

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  tag: IntegrityTag;
}

export interface StaffFunnelRow {
  staffId: number | null;
  staffName: string;
  staffCode: string | null;
  reviews: number;
  fiveStar: number;
  low: number;
  googleClickPct: number | null;
  trend7: number;
  trendPrev7: number;
}

export interface ReviewFunnel {
  steps: FunnelStep[];
  /** Conversion % between consecutive steps; null when previous step is 0. */
  conversions: (number | null)[];
  alertErrors: number;
  /** Rows whose alert_error mentions an sms-channel failure ('sms: ...'). */
  smsErrors: number;
  /** Present only when restaurantId was given. */
  staffTable: StaffFunnelRow[] | null;
}

export async function getReviewFunnel(
  days: 7 | 30 = 30,
  restaurantId?: number,
): Promise<ReviewFunnel> {
  const { start } = windowBounds(days);
  const w7 = windowBounds(7).start;
  const w14 = windowBounds(14).start;

  let scopeIds: number[] = [];
  if (restaurantId !== undefined) {
    scopeIds = [restaurantId];
  } else {
    scopeIds = (await getOperationalLocations()).map((l) => l.id);
  }

  const emptySteps: FunnelStep[] = [
    { key: 'pageOpens', label: 'Aperturas de página', count: 0, tag: 'verified' },
    { key: 'ratingsCompleted', label: 'Calificaciones completadas', count: 0, tag: 'verified' },
    { key: 'googleOptionShown', label: 'Opción de Google mostrada', count: 0, tag: 'inferred' },
    { key: 'googleClicked', label: 'Clic en Google', count: 0, tag: 'verified' },
    { key: 'privateFeedbackSubmitted', label: 'Feedback privado enviado', count: 0, tag: 'verified' },
    { key: 'managerAlerted', label: 'Gerente alertado', count: 0, tag: 'inferred' },
    { key: 'managerViewed', label: 'Gerente lo vio', count: 0, tag: 'inferred' },
    { key: 'resolved', label: 'Resuelto', count: 0, tag: 'verified' },
  ];
  const emptyResult: ReviewFunnel = {
    steps: emptySteps,
    conversions: emptySteps.map(() => null),
    alertErrors: 0,
    smsErrors: 0,
    staffTable: restaurantId !== undefined ? [] : null,
  };
  if (scopeIds.length === 0) return emptyResult;

  // Restaurants that have a Google review URL configured ("Google option shown").
  const withGoogle = db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(sql`${restaurants.googleReviewUrl} is not null`)
    .as('with_google');

  const [pageOpenAgg, reviewAgg, staffRows] = await Promise.all([
    // review_page_open events (exist only from the deploy).
    db
      .select({ count: countSql`count(*)` })
      .from(productEvents)
      .where(
        and(
          inArray(productEvents.restaurantId, scopeIds),
          eq(productEvents.eventName, 'review_page_open'),
          gte(productEvents.createdAt, start),
        ),
      ),

    db
      .select({
        total: countSql`count(*)`,
        googleOption: countSql`count(*) filter (where ${withGoogle.id} is not null)`,
        googleClicked: countSql`count(*) filter (where ${reviews.sentToGoogle} = true and ${reviews.createdAt} >= ${GOOGLE_CLICK_SINCE})`,
        feedback: countSql`count(*) filter (where ${reviews.feedback} is not null)`,
        // "Alerted" = feedback exists AND at least the email channel did not
        // fail. alert_error is a '; '-joined list of per-channel failures
        // ('sms: 401 ...', 'email SMTP 535: ...', 'push: ...', ...), so an
        // error that does NOT mention email still means the manager was
        // reached by email.
        alerted: countSql`count(*) filter (where ${reviews.feedback} is not null and (${reviews.alertSentAt} is not null or (${reviews.alertError} is not null and ${reviews.alertError} not like '%email%')))`,
        alertErrors: countSql`count(*) filter (where ${reviews.alertError} is not null)`,
        smsErrors: countSql`count(*) filter (where ${reviews.alertError} like '%sms:%')`,
        viewed: countSql`count(*) filter (where ${reviews.reviewedAt} is not null or ${reviews.status} <> 'new')`,
        resolved: countSql`count(*) filter (where ${reviews.resolvedAt} is not null or ${reviews.status} = 'resolved')`,
      })
      .from(reviews)
      .leftJoin(withGoogle, eq(reviews.restaurantId, withGoogle.id))
      .where(and(inArray(reviews.restaurantId, scopeIds), gte(reviews.createdAt, start))),

    restaurantId !== undefined
      ? db
          .select({
            staffId: reviews.staffId,
            staffName: reviews.staffName,
            staffCode: reviews.staffCode,
            total: countSql`count(*) filter (where ${reviews.createdAt} >= ${start})`,
            fiveStar: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} = 5)`,
            low: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.rating} <= 3)`,
            google: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.createdAt} >= ${GOOGLE_CLICK_SINCE} and ${reviews.sentToGoogle} = true)`,
            googleBase: countSql`count(*) filter (where ${reviews.createdAt} >= ${start} and ${reviews.createdAt} >= ${GOOGLE_CLICK_SINCE})`,
            trend7: countSql`count(*) filter (where ${reviews.createdAt} >= ${w7})`,
            trendPrev7: countSql`count(*) filter (where ${reviews.createdAt} < ${w7})`,
          })
          .from(reviews)
          .where(and(eq(reviews.restaurantId, restaurantId), gte(reviews.createdAt, w14)))
          .groupBy(reviews.staffId, reviews.staffName, reviews.staffCode)
      : Promise.resolve(null),
  ]);

  const r = reviewAgg[0];
  const steps: FunnelStep[] = [
    { ...emptySteps[0], count: num(pageOpenAgg[0]?.count) },
    { ...emptySteps[1], count: num(r?.total) },
    { ...emptySteps[2], count: num(r?.googleOption) },
    { ...emptySteps[3], count: num(r?.googleClicked) },
    { ...emptySteps[4], count: num(r?.feedback) },
    { ...emptySteps[5], count: num(r?.alerted) },
    { ...emptySteps[6], count: num(r?.viewed) },
    { ...emptySteps[7], count: num(r?.resolved) },
  ];

  const conversions = steps.map((s, i) =>
    i === 0 ? null : funnelConversion(steps[i - 1].count, s.count),
  );

  const staffTable: StaffFunnelRow[] | null =
    staffRows === null
      ? null
      : staffRows
          .map((s) => {
            const total = num(s.total);
            const googleBase = num(s.googleBase);
            return {
              staffId: s.staffId,
              staffName: s.staffName ?? 'Sin asignar',
              staffCode: s.staffCode,
              reviews: total,
              fiveStar: num(s.fiveStar),
              low: num(s.low),
              googleClickPct: googleBase > 0 ? pct(num(s.google), googleBase) : null,
              trend7: num(s.trend7),
              trendPrev7: num(s.trendPrev7),
            };
          })
          .sort((a, b) => b.reviews - a.reviews);

  return { steps, conversions, alertErrors: num(r?.alertErrors), smsErrors: num(r?.smsErrors), staffTable };
}

/* ── 5. Guest funnel ────────────────────────────────────────────────────── */

export interface GuestFunnelLocation {
  slug: string;
  name: string;
  captured: number;
  newGuests: number;
  consented: number;
  repeat: number;
  weekly: { weekStart: string; count: number }[];
}

export interface GuestFunnel {
  steps: FunnelStep[];
  conversions: (number | null)[];
  lapsed60: TaggedMetric<number>;
  birthdaysToday: TaggedMetric<number>;
  visitsPerGuest: TaggedMetric<number>;
  byLocation: GuestFunnelLocation[];
  /** Group-level guest_visits per week, last 12 weeks. */
  weeklyTrend: { weekStart: string; count: number }[];
}

const GUEST_FUNNEL_STEPS: { key: string; label: string; tag: IntegrityTag }[] = [
  { key: 'capturePageOpens', label: 'Aperturas de captura', tag: 'verified' },
  { key: 'captured', label: 'Visitas capturadas', tag: 'verified' },
  { key: 'newGuests', label: 'Invitados nuevos', tag: 'verified' },
  { key: 'consented', label: 'Con consentimiento', tag: 'verified' },
  { key: 'validated', label: 'Validados', tag: 'verified' },
  { key: 'repeat', label: 'Repetidores (2+ visitas)', tag: 'verified' },
  { key: 'vip', label: 'VIP (5+ visitas)', tag: 'verified' },
];

export async function getGuestFunnel(days: 7 | 30 = 30): Promise<GuestFunnel> {
  const { start } = windowBounds(days);
  const w84 = windowBounds(84).start; // 12 weeks
  const weekZero = startOfWeekMexico();
  const birthdayKey = todayBirthdayKeyMexico();

  const locations = await getOperationalLocations();
  const base: GuestFunnel = {
    steps: GUEST_FUNNEL_STEPS.map((s) => ({ ...s, count: 0 })),
    conversions: GUEST_FUNNEL_STEPS.map(() => null),
    lapsed60: tag(0, 'verified'),
    birthdaysToday: tag(0, 'verified'),
    visitsPerGuest: tag(0, 'verified'),
    byLocation: [],
    weeklyTrend: [],
  };
  if (locations.length === 0) return base;
  const ids = locations.map((l) => l.id);

  // All-time visit totals per guest (for repeat detection per location).
  const guestVisitTotals = db
    .select({
      guestId: guestVisits.guestId,
      totalVisits: countSql`count(*)`.as('total_visits'),
    })
    .from(guestVisits)
    .groupBy(guestVisits.guestId)
    .as('guest_visit_totals');

  const [pageOpenAgg, visitAgg, guestAgg, validatedAgg, repeatVipAgg, lapsedAgg, birthdayAgg, perLocationRows, weeklyRows] =
    await Promise.all([
      // guest_capture_page_open events (from deploy onward).
      db
        .select({ count: countSql`count(*)` })
        .from(productEvents)
        .where(
          and(
            inArray(productEvents.restaurantId, ids),
            eq(productEvents.eventName, 'guest_capture_page_open'),
            gte(productEvents.createdAt, start),
          ),
        ),

      // Visits in the window (captures/recaptures) + distinct guests.
      db
        .select({
          visits: countSql`count(*)`,
          distinctGuests: countSql`count(distinct ${guestVisits.guestId})`,
        })
        .from(guestVisits)
        .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, start))),

      // New guests + consent in the window.
      db
        .select({
          captured: countSql`count(*)`,
          consented: countSql`count(*) filter (where ${guests.marketingConsent} = true)`,
        })
        .from(guests)
        .where(and(inArray(guests.restaurantId, ids), gte(guests.capturedAt, start))),

      // Validated in the window.
      db
        .select({ count: countSql`count(*)` })
        .from(guests)
        .where(
          and(
            inArray(guests.restaurantId, ids),
            sql`${guests.validatedAt} is not null`,
            gte(guests.validatedAt, start),
          ),
        ),

      // Repeat (≥2 visits) and VIP (≥5 visits) among guests visited in window.
      db
        .select({
          repeat: countSql`count(*) filter (where visit_count >= 2)`,
          vip: countSql`count(*) filter (where visit_count >= 5)`,
        })
        .from(
          db
            .select({
              guestId: guestVisits.guestId,
              visitCount: sql<number>`(select count(*) from ${guestVisits} all_v where all_v.guest_id = ${guestVisits.guestId})`.as('visit_count'),
            })
            .from(guestVisits)
            .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, start)))
            .groupBy(guestVisits.guestId)
            .as('window_guests'),
        ),

      // Lapsed: ≥1 visit all-time, last visit > 60 days ago.
      db
        .select({ count: countSql`count(*)` })
        .from(guests)
        .where(
          and(
            inArray(guests.restaurantId, ids),
            sql`(select count(*) from ${guestVisits} v where v.guest_id = ${guests.id}) >= 1`,
            sql`(select max(v2.visit_date) from ${guestVisits} v2 where v2.guest_id = ${guests.id}) < ${new Date(Date.now() - 60 * 86_400_000)}`,
          ),
        ),

      // Birthdays today (Mexico City), birthday_mmdd is 'DD/MM'.
      db
        .select({ count: countSql`count(*)` })
        .from(guests)
        .where(and(inArray(guests.restaurantId, ids), eq(guests.birthdayMmdd, birthdayKey))),

      // Per-location: visits in window + repeat guests (≥2 visits all-time).
      db
        .select({
          restaurantId: guestVisits.restaurantId,
          visits: countSql`count(*)`,
          repeat: countSql`count(distinct ${guestVisits.guestId}) filter (where ${guestVisitTotals.totalVisits} >= 2)`,
        })
        .from(guestVisits)
        .innerJoin(guestVisitTotals, eq(guestVisits.guestId, guestVisitTotals.guestId))
        .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, start)))
        .groupBy(guestVisits.restaurantId),

      // Weekly visit counts per location for the last 12 weeks (Mexico weeks).
      db
        .select({
          restaurantId: guestVisits.restaurantId,
          weekStart: sql<string>`to_char(date_trunc('week', ${guestVisits.visitDate} at time zone ${MX_TZ_SQL}), 'YYYY-MM-DD')`,
          count: countSql`count(*)`,
        })
        .from(guestVisits)
        .where(and(inArray(guestVisits.restaurantId, ids), gte(guestVisits.visitDate, w84)))
        .groupBy(
          guestVisits.restaurantId,
          sql`date_trunc('week', ${guestVisits.visitDate} at time zone ${MX_TZ_SQL})`,
        ),
    ]);

  const visits = num(visitAgg[0]?.visits);
  const distinctGuests = num(visitAgg[0]?.distinctGuests);

  const steps: FunnelStep[] = GUEST_FUNNEL_STEPS.map((s) => ({ ...s, count: 0 }));
  steps[0].count = num(pageOpenAgg[0]?.count);
  steps[1].count = visits;
  steps[2].count = num(guestAgg[0]?.captured);
  steps[3].count = num(guestAgg[0]?.consented);
  steps[4].count = num(validatedAgg[0]?.count);
  steps[5].count = num(repeatVipAgg[0]?.repeat);
  steps[6].count = num(repeatVipAgg[0]?.vip);

  const conversions = steps.map((s, i) =>
    i === 0 ? null : funnelConversion(steps[i - 1].count, s.count),
  );

  // Build the 12-week grid (Mexico Mondays, oldest first).
  const weekKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(weekZero);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekKeys.push(mexicoDay(d));
  }

  const weeklyByLocation = new Map<number, Map<string, number>>();
  const groupWeekly = new Map<string, number>();
  for (const row of weeklyRows) {
    if (row.restaurantId === null) continue;
    const perLoc = weeklyByLocation.get(row.restaurantId) ?? new Map<string, number>();
    perLoc.set(row.weekStart, num(row.count));
    weeklyByLocation.set(row.restaurantId, perLoc);
    groupWeekly.set(row.weekStart, (groupWeekly.get(row.weekStart) ?? 0) + num(row.count));
  }

  const perLocationVisits = new Map(perLocationRows.map((r) => [r.restaurantId, r]));
  const newGuestsByLocation = new Map<number, { captured: number; consented: number }>();
  const perLocationGuests = await db
    .select({
      restaurantId: guests.restaurantId,
      captured: countSql`count(*)`,
      consented: countSql`count(*) filter (where ${guests.marketingConsent} = true)`,
    })
    .from(guests)
    .where(and(inArray(guests.restaurantId, ids), gte(guests.capturedAt, start)))
    .groupBy(guests.restaurantId);
  for (const row of perLocationGuests) {
    newGuestsByLocation.set(row.restaurantId, {
      captured: num(row.captured),
      consented: num(row.consented),
    });
  }

  const byLocation: GuestFunnelLocation[] = locations.map((loc) => {
    const v = perLocationVisits.get(loc.id);
    const ng = newGuestsByLocation.get(loc.id);
    const perLocWeekly = weeklyByLocation.get(loc.id);
    return {
      slug: loc.slug,
      name: loc.name,
      captured: num(v?.visits),
      newGuests: num(ng?.captured),
      consented: num(ng?.consented),
      repeat: num(v?.repeat),
      weekly: weekKeys.map((w) => ({ weekStart: w, count: perLocWeekly?.get(w) ?? 0 })),
    };
  });

  return {
    steps,
    conversions,
    lapsed60: tag(num(lapsedAgg[0]?.count), 'verified'),
    birthdaysToday: tag(num(birthdayAgg[0]?.count), 'verified'),
    visitsPerGuest: tag(distinctGuests > 0 ? Math.round((visits / distinctGuests) * 100) / 100 : 0, 'verified'),
    byLocation,
    weeklyTrend: weekKeys.map((w) => ({ weekStart: w, count: groupWeekly.get(w) ?? 0 })),
  };
}

/* ── 6. Campaign analytics ──────────────────────────────────────────────── */

export interface CampaignAnalyticsRow {
  campaignId: number;
  name: string;
  slug: string;
  restaurantName: string;
  status: string;
  audience: number;
  /** Real click on the tracked WhatsApp link (verified). */
  whatsappOpened: number;
  /** Manager marked the contact as sent (REPORTED — human-entered). */
  markedSent: number;
  replied: number;
  optedOut: number;
  bookingsEntered: number; // reported
  booked: number; // reported
  attended: number; // reported
  cancelledOrRefunded: number; // reported
  depositMx: number; // reported
  collectedMx: number; // reported
  bookingRate: number | null; // booked / audience
  revenuePerContact: number | null; // collected / audience
  revenuePerConfirmedSend: number | null; // collected / markedSent
  /** Active campaign where nobody opened the WhatsApp link. */
  untouched: boolean;
}

export async function getCampaignAnalytics(): Promise<CampaignAnalyticsRow[]> {
  const locations = await getOperationalLocations();
  if (locations.length === 0) return [];
  const ids = locations.map((l) => l.id);

  const [campaignRows, contactAgg, bookingAgg] = await Promise.all([
    db
      .select({
        id: eventCampaigns.id,
        name: eventCampaigns.name,
        slug: eventCampaigns.slug,
        status: eventCampaigns.status,
        restaurantId: eventCampaigns.restaurantId,
        restaurantName: restaurants.name,
      })
      .from(eventCampaigns)
      .innerJoin(restaurants, eq(eventCampaigns.restaurantId, restaurants.id))
      .where(inArray(eventCampaigns.restaurantId, ids))
      .orderBy(asc(eventCampaigns.createdAt)),

    db
      .select({
        campaignId: campaignContacts.campaignId,
        audience: countSql`count(*)`,
        opened: countSql`count(*) filter (where ${campaignContacts.openedAt} is not null)`,
        markedSent: countSql`count(*) filter (where ${campaignContacts.sentAt} is not null)`,
        replied: countSql`count(*) filter (where ${campaignContacts.repliedAt} is not null)`,
        optedOut: countSql`count(*) filter (where ${campaignContacts.optedOutAt} is not null)`,
      })
      .from(campaignContacts)
      .where(inArray(campaignContacts.restaurantId, ids))
      .groupBy(campaignContacts.campaignId),

    db
      .select({
        campaignId: campaignBookings.campaignId,
        entered: countSql`count(*)`,
        booked: countSql`count(*) filter (where ${campaignBookings.status} in ('booked', 'attended'))`,
        attended: countSql`count(*) filter (where ${campaignBookings.status} = 'attended')`,
        cancelledOrRefunded: countSql`count(*) filter (where ${campaignBookings.status} in ('cancelled', 'refunded'))`,
        depositMx: numSql`coalesce(sum(${campaignBookings.depositAmount}), 0)`,
        collectedMx: numSql`coalesce(sum(${campaignBookings.collectedAmount}), 0)`,
      })
      .from(campaignBookings)
      .where(inArray(campaignBookings.restaurantId, ids))
      .groupBy(campaignBookings.campaignId),
  ]);

  const contactMap = new Map(contactAgg.map((r) => [r.campaignId, r]));
  const bookingMap = new Map(bookingAgg.map((r) => [r.campaignId, r]));

  return campaignRows.map((c) => {
    const contacts = contactMap.get(c.id);
    const bookings = bookingMap.get(c.id);
    const audience = num(contacts?.audience);
    const markedSent = num(contacts?.markedSent);
    const booked = num(bookings?.booked);
    const collectedMx = num(bookings?.collectedMx);

    return {
      campaignId: c.id,
      name: c.name,
      slug: c.slug,
      restaurantName: c.restaurantName,
      status: c.status,
      audience,
      whatsappOpened: num(contacts?.opened),
      markedSent,
      replied: num(contacts?.replied),
      optedOut: num(contacts?.optedOut),
      bookingsEntered: num(bookings?.entered),
      booked,
      attended: num(bookings?.attended),
      cancelledOrRefunded: num(bookings?.cancelledOrRefunded),
      depositMx: num(bookings?.depositMx),
      collectedMx,
      bookingRate: rateOrNull(booked, audience),
      revenuePerContact: rateOrNull(collectedMx, audience),
      revenuePerConfirmedSend: rateOrNull(collectedMx, markedSent),
      untouched: c.status === 'active' && num(contacts?.opened) === 0,
    };
  });
}

/* ── 7. Push analytics ──────────────────────────────────────────────────── */

export interface PushKindBreakdown {
  kind: string;
  created: number;
  accepted: number;
  failed: number;
  clicks: number;
}

export type PushRevocationReason =
  | 'user_unsubscribe'
  | 'endpoint_invalid'
  | 'permission_revoked'
  | 'unknown';

export interface PushAnalytics {
  created: TaggedMetric<number>;
  /** "accepted" = the push SERVICE returned 2xx — it is NOT delivery. */
  accepted: TaggedMetric<number>;
  failed: TaggedMetric<number>;
  clicks: TaggedMetric<number>;
  clickRate: number | null; // clicks / created
  /** page_view events carrying properties.src='push'. */
  destinationOpened: TaggedMetric<number>;
  /** Resulting action after the push (see query comments). */
  resultingAction: TaggedMetric<number>;
  activeSubscriptions: TaggedMetric<number>;
  revokedByReason: TaggedMetric<Record<PushRevocationReason, number>>;
  /** Active subscriptions grouped by the role that most recently subscribed. */
  subscriptionsByRole: TaggedMetric<Record<string, number>>;
  byKind: PushKindBreakdown[];
  subscriptionsByLocation: { slug: string; name: string; count: number }[];
  note: string;
}

export async function getPushAnalytics(days: 7 | 30 = 30): Promise<PushAnalytics> {
  const { start } = windowBounds(days);
  const [locations, lifecycleAccounts] = await Promise.all([
    getOperationalLocations(),
    db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(inArray(restaurants.subscriptionStatus, ['active', 'trialing'])),
  ]);
  const ids = locations.map((l) => l.id);
  const lifecycleAccountIds = lifecycleAccounts.map((account) => account.id);

  const base: PushAnalytics = {
    created: tag(0, 'verified'),
    accepted: tag(0, 'verified'),
    failed: tag(0, 'verified'),
    clicks: tag(0, 'verified'),
    clickRate: null,
    destinationOpened: tag(0, 'verified'),
    resultingAction: tag(0, 'inferred'),
    activeSubscriptions: tag(0, 'verified'),
    revokedByReason: tag(
      {
        user_unsubscribe: 0,
        endpoint_invalid: 0,
        permission_revoked: 0,
        unknown: 0,
      },
      'verified',
    ),
    subscriptionsByRole: tag(
      { owner: 0, regional: 0, gm: 0, unknown: 0 },
      'verified',
    ),
    byKind: [],
    subscriptionsByLocation: [],
    note: '«Aceptados» significa que el servicio de push respondió 2xx — no confirma entrega ni visualización en el dispositivo.',
  };
  if (ids.length === 0) return base;

  const [
    pushAgg,
    kindRows,
    clickRows,
    destAgg,
    actionAgg,
    subRows,
    revokedReasonRows,
    subscriptionRoleRows,
  ] = await Promise.all([
    db
      .select({
        created: countSql`count(*)`,
        accepted: numSql`coalesce(sum(${pushNotifications.acceptedCount}), 0)`,
        failed: numSql`coalesce(sum(${pushNotifications.failedCount}), 0)`,
      })
      .from(pushNotifications)
      .where(and(inArray(pushNotifications.restaurantId, ids), gte(pushNotifications.createdAt, start))),

    db
      .select({
        kind: pushNotifications.kind,
        created: countSql`count(*)`,
        accepted: numSql`coalesce(sum(${pushNotifications.acceptedCount}), 0)`,
        failed: numSql`coalesce(sum(${pushNotifications.failedCount}), 0)`,
      })
      .from(pushNotifications)
      .where(and(inArray(pushNotifications.restaurantId, ids), gte(pushNotifications.createdAt, start)))
      .groupBy(pushNotifications.kind),

    // Clicks per kind, joining through the nid attribution param.
    db
      .select({
        kind: pushNotifications.kind,
        clicks: countSql`count(*)`,
      })
      .from(productEvents)
      .innerJoin(
        pushNotifications,
        sql`${pushNotifications.id} = (case when ${productEvents.properties}->>'nid' ~ '^[0-9]+$' then (${productEvents.properties}->>'nid')::int end)`,
      )
      .where(
        and(
          eq(productEvents.eventName, 'push_notification_click'),
          gte(productEvents.createdAt, start),
          sql`${productEvents.properties}->>'nid' ~ '^[0-9]+$'`,
          inArray(pushNotifications.restaurantId, ids),
        ),
      )
      .groupBy(pushNotifications.kind),

    // Destination opened: page_view with src=push attribution.
    db
      .select({ count: countSql`count(*)` })
      .from(productEvents)
      .where(
        and(
          inArray(productEvents.restaurantId, ids),
          eq(productEvents.eventName, 'page_view'),
          gte(productEvents.createdAt, start),
          sql`${productEvents.properties}->>'src' = 'push'`,
        ),
      ),

    // Resulting action: for low_review pushes, the subject review was viewed
    // or resolved after the push; for vip_validated / daily_digest, a guests
    // surface was opened with push attribution after the push.
    db
      .select({ count: countSql`count(*)` })
      .from(pushNotifications)
      .where(
        and(
          inArray(pushNotifications.restaurantId, ids),
          gte(pushNotifications.createdAt, start),
          sql`(
            (${pushNotifications.kind} = 'low_review' and exists (
              select 1 from ${reviews} r
              where r.id = ${pushNotifications.subjectId}
                and (r.reviewed_at >= ${pushNotifications.createdAt} or r.resolved_at >= ${pushNotifications.createdAt})
            ))
            or
            (${pushNotifications.kind} in ('vip_validated', 'daily_digest') and exists (
              select 1 from ${productEvents} pe
              where pe.restaurant_id = ${pushNotifications.restaurantId}
                and pe.created_at >= ${pushNotifications.createdAt}
                and pe.properties->>'src' = 'push'
                and (pe.event_name = 'guest_profile_opened'
                     or (pe.event_name = 'page_view' and pe.path ilike '/guests%'))
            ))
          )`,
        ),
      ),

    db
      .select({
        restaurantId: pushSubscriptions.restaurantId,
        count: countSql`count(*)`,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.restaurantId, ids),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .groupBy(pushSubscriptions.restaurantId),

    // Deliberately includes revoked rows and group-level account rows to expose
    // lifecycle attrition for owner/regional devices as well as GMs.
    db
      .select({
        reason: sql<string>`coalesce(${pushSubscriptions.revokedReason}, 'unknown')`,
        count: countSql`count(*)`,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.restaurantId, lifecycleAccountIds),
          isNotNull(pushSubscriptions.revokedAt),
        ),
      )
      .groupBy(sql`coalesce(${pushSubscriptions.revokedReason}, 'unknown')`),

    db
      .select({
        role: sql<string>`coalesce(${pushSubscriptions.role}, 'unknown')`,
        count: countSql`count(*)`,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.restaurantId, lifecycleAccountIds),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .groupBy(sql`coalesce(${pushSubscriptions.role}, 'unknown')`),
  ]);

  const p = pushAgg[0];
  const created = num(p?.created);
  const totalClicks = clickRows.reduce((s, r) => s + num(r.clicks), 0);
  const clicksByKind = new Map(clickRows.map((r) => [r.kind, num(r.clicks)]));
  const activeSubscriptions = subscriptionRoleRows.reduce(
    (sum, row) => sum + num(row.count),
    0,
  );
  const revokedByReason = { ...base.revokedByReason.value };
  for (const row of revokedReasonRows) {
    if (row.reason in revokedByReason) {
      revokedByReason[row.reason as PushRevocationReason] = num(row.count);
    }
  }
  const subscriptionsByRole = { ...base.subscriptionsByRole.value };
  for (const row of subscriptionRoleRows) {
    subscriptionsByRole[row.role] = num(row.count);
  }

  const locById = new Map(locations.map((l) => [l.id, l]));

  return {
    created: tag(created, 'verified'),
    accepted: tag(num(p?.accepted), 'verified'),
    failed: tag(num(p?.failed), 'verified'),
    clicks: tag(totalClicks, 'verified'),
    clickRate: rateOrNull(totalClicks, created),
    destinationOpened: tag(num(destAgg[0]?.count), 'verified'),
    resultingAction: tag(num(actionAgg[0]?.count), 'inferred'),
    activeSubscriptions: tag(activeSubscriptions, 'verified'),
    revokedByReason: tag(revokedByReason, 'verified'),
    subscriptionsByRole: tag(subscriptionsByRole, 'verified'),
    byKind: kindRows.map((k) => ({
      kind: k.kind,
      created: num(k.created),
      accepted: num(k.accepted),
      failed: num(k.failed),
      clicks: clicksByKind.get(k.kind) ?? 0,
    })),
    subscriptionsByLocation: subRows
      .map((s) => {
        const loc = locById.get(s.restaurantId);
        return { slug: loc?.slug ?? '', name: loc?.name ?? '', count: num(s.count) };
      })
      .filter((s) => s.slug !== '')
      .sort((a, b) => b.count - a.count),
    note: base.note,
  };
}

/* ── 8. Problem locations ───────────────────────────────────────────────── */

export interface ProblemLocation {
  slug: string;
  name: string;
  issues: string[];
}

export async function getProblemLocations(): Promise<ProblemLocation[]> {
  const locations = await getOperationalLocations();
  if (locations.length === 0) return [];
  const ids = locations.map((l) => l.id);

  const w7 = windowBounds(7).start;
  const w30 = windowBounds(30).start;

  const [reviewRows, gmActivityRows, unresolvedRows, pushSubRows, activeCampaignRows, campaignOpenedRows, guestRows, guestCrmRows, campaignActivityRows, codeRows, eventHistoryRows] =
    await Promise.all([
      // Reviews in the last 7 days.
      db
        .select({ restaurantId: reviews.restaurantId, count: countSql`count(*)` })
        .from(reviews)
        .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, w7)))
        .groupBy(reviews.restaurantId),

      // GM app activity in the last 7 days (inferred — data starts at deploy).
      db
        .select({ restaurantId: productEvents.restaurantId, count: countSql`count(*)` })
        .from(productEvents)
        .where(
          and(
            inArray(productEvents.restaurantId, ids),
            inArray(productEvents.eventName, ['app_open', 'page_view']),
            eq(productEvents.role, 'gm'),
            gte(productEvents.createdAt, w7),
          ),
        )
        .groupBy(productEvents.restaurantId),

      // Negative feedback with text still in status 'new' (current backlog).
      db
        .select({ restaurantId: reviews.restaurantId, count: countSql`count(*)` })
        .from(reviews)
        .where(
          and(
            inArray(reviews.restaurantId, ids),
            sql`${reviews.rating} <= 3`,
            sql`${reviews.feedback} is not null`,
            eq(reviews.status, 'new'),
          ),
        )
        .groupBy(reviews.restaurantId),

      // Push subscription presence.
      db
        .select({ restaurantId: pushSubscriptions.restaurantId, count: countSql`count(*)` })
        .from(pushSubscriptions)
        .where(
          and(
            inArray(pushSubscriptions.restaurantId, ids),
            isNull(pushSubscriptions.revokedAt),
          ),
        )
        .groupBy(pushSubscriptions.restaurantId),

      // Active campaigns.
      db
        .select({ restaurantId: eventCampaigns.restaurantId, id: eventCampaigns.id })
        .from(eventCampaigns)
        .where(and(inArray(eventCampaigns.restaurantId, ids), eq(eventCampaigns.status, 'active'))),

      // Opened contacts per campaign.
      db
        .select({
          campaignId: campaignContacts.campaignId,
          opened: countSql`count(*) filter (where ${campaignContacts.openedAt} is not null)`,
        })
        .from(campaignContacts)
        .where(inArray(campaignContacts.restaurantId, ids))
        .groupBy(campaignContacts.campaignId),

      // Guests captured in the last 30 days.
      db
        .select({ restaurantId: guests.restaurantId, count: countSql`count(*)` })
        .from(guests)
        .where(and(inArray(guests.restaurantId, ids), gte(guests.capturedAt, w30)))
        .groupBy(guests.restaurantId),

      // /guests page views in the last 30 days.
      db
        .select({ restaurantId: productEvents.restaurantId, count: countSql`count(*)` })
        .from(productEvents)
        .where(
          and(
            inArray(productEvents.restaurantId, ids),
            eq(productEvents.eventName, 'page_view'),
            sql`${productEvents.path} ilike '/guests%'`,
            gte(productEvents.createdAt, w30),
          ),
        )
        .groupBy(productEvents.restaurantId),

      // Any campaign activity (contact action) in the last 30 days.
      db
        .select({ restaurantId: campaignContacts.restaurantId, count: countSql`count(*)` })
        .from(campaignContacts)
        .where(
          and(
            inArray(campaignContacts.restaurantId, ids),
            sql`${campaignContacts.lastActionAt} is not null`,
            gte(campaignContacts.lastActionAt, w30),
          ),
        )
        .groupBy(campaignContacts.restaurantId),

      // Unknown staff-code share in the last 30 days.
      db
        .select({
          restaurantId: reviews.restaurantId,
          total: countSql`count(*)`,
          unknown: countSql`count(*) filter (where ${reviews.staffId} is null)`,
        })
        .from(reviews)
        .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, w30)))
        .groupBy(reviews.restaurantId),

      // Earliest usage event from a manager-level role. Usage-based problem
      // checks are only meaningful once product_events has ≥7 days of
      // history; before that, "no events in 7 days" says nothing.
      db
        .select({ first: sql<Date | null>`min(${productEvents.createdAt})` })
        .from(productEvents)
        .where(inArray(productEvents.role, ['gm', 'owner', 'regional'])),
    ]);

  const countBy = (rows: { restaurantId: number | null; count: number }[]) => {
    const m = new Map<number, number>();
    for (const r of rows) if (r.restaurantId !== null) m.set(r.restaurantId, num(r.count));
    return m;
  };

  const reviews7 = countBy(reviewRows);
  const gmActive = countBy(gmActivityRows);
  const unresolved = countBy(unresolvedRows);
  const pushSubs = countBy(pushSubRows);
  const guests30 = countBy(guestRows);
  const guestCrm30 = countBy(guestCrmRows);
  const campaignActivity30 = countBy(campaignActivityRows);

  const openedByCampaign = new Map(campaignOpenedRows.map((r) => [r.campaignId, num(r.opened)]));
  const hasStaleCampaign = new Set<number>();
  for (const c of activeCampaignRows) {
    if ((openedByCampaign.get(c.id) ?? 0) === 0) hasStaleCampaign.add(c.restaurantId);
  }

  const codeByRestaurant = new Map(codeRows.map((r) => [r.restaurantId, r]));

  const eventHistoryStart = eventHistoryRows[0]?.first ?? null;
  const hasEventHistory7 =
    eventHistoryStart !== null && new Date(eventHistoryStart) < w7;

  const result: ProblemLocation[] = [];
  for (const loc of locations) {
    const issues: string[] = [];

    if ((reviews7.get(loc.id) ?? 0) === 0) {
      issues.push('Sin reseñas en 7 días');
    }
    if (hasEventHistory7 && (gmActive.get(loc.id) ?? 0) === 0) {
      issues.push('Gerente sin abrir la app en 7 días (inferido: datos de uso desde el despliegue)');
    }
    const unresolvedCount = unresolved.get(loc.id) ?? 0;
    if (unresolvedCount > 0) {
      issues.push(`Feedback negativo sin resolver (${unresolvedCount})`);
    }
    if ((pushSubs.get(loc.id) ?? 0) === 0) {
      issues.push('Sin suscripción push');
    }
    if (hasStaleCampaign.has(loc.id)) {
      issues.push('Campaña activa sin actividad');
    }
    if (
      hasEventHistory7 &&
      (guests30.get(loc.id) ?? 0) > 0 &&
      (guestCrm30.get(loc.id) ?? 0) === 0 &&
      (campaignActivity30.get(loc.id) ?? 0) === 0
    ) {
      issues.push('Invitados capturados pero sin uso');
    }
    const codes = codeByRestaurant.get(loc.id);
    if (codes && num(codes.total) > 0) {
      const unknownPct = pct(num(codes.unknown), num(codes.total));
      if (unknownPct > 25) {
        issues.push(`Códigos de mesero desconocidos > 25% (${unknownPct}%)`);
      }
    }

    if (issues.length > 0) {
      result.push({ slug: loc.slug, name: loc.name, issues });
    }
  }

  return result;
}
