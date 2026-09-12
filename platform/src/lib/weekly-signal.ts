/**
 * Per-location weekly facts for the owner and regional briefings.
 *
 * Keeps the two numbers that must be read together in one query: scans (reviews
 * captured) week over week, and how many distinct days the GM opened the app.
 * See lib/location-signal.ts for why they are never read apart.
 *
 * Behavioural history starts 2026-08-21, when product_events shipped. For any
 * week before that, gmActiveDays is 0 because nothing was recorded, not because
 * the GM was absent — classifyLocation() would read that as 'adoption' and be
 * wrong. `gmTelemetryAvailable` marks the difference so callers can withhold a
 * judgement instead of inventing one.
 */
import { db } from '@/db';
import { restaurants, reviews, productEvents, guests, guestVisits } from '@/db/schema';
import { and, eq, gte, lt, sql, inArray, isNotNull } from 'drizzle-orm';
import { classifyLocation, type LocationSignalResult } from '@/lib/location-signal';
import { birthdayWindowKeys } from '@/lib/guest-messages';

/** product_events started recording on this date. Nothing exists before it. */
export const TELEMETRY_START = new Date('2026-08-21T00:00:00.000Z');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Monday of the last COMPLETE week, in Mexico City terms.
 *
 * Briefings must never report the week in progress. On a Wednesday the current
 * week holds three days of data, so every location shows a collapse against a
 * full prior week and the whole estate looks like it quit. Verified 2026-09-10:
 * the in-progress week showed double-digit falls at all twelve locations.
 *
 * Callers that need "the week we are reporting on" should use this, not
 * startOfWeekMexico().
 */
export function lastCompleteWeekStart(now: Date = new Date()): Date {
  const local = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }),
  );
  // Monday = 0 .. Sunday = 6
  const dayIndex = (local.getDay() + 6) % 7;
  const thisMonday = new Date(local.getFullYear(), local.getMonth(), local.getDate() - dayIndex);
  return new Date(thisMonday.getTime() - WEEK_MS);
}

/** Events that mean "a human opened the app", matching lib/product-analytics. */
const OPEN_EVENTS = ['app_open', 'page_view'] as const;

const countSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  sql<number>(strings, ...values).mapWith(Number);

export interface WeeklyLocationSignal {
  restaurantId: number;
  slug: string;
  name: string;
  region: string | null;
  scansThisWeek: number;
  scansLastWeek: number;
  staffAskingThisWeek: number;
  staffAskingLastWeek: number;
  gmActiveDays: number;
  /** False when the week predates telemetry; suppresses any GM judgement. */
  gmTelemetryAvailable: boolean;
  signal: LocationSignalResult;
}

/**
 * Weekly signal for every operational location, optionally scoped to a region.
 *
 * `weekStart` is the Monday of the week being reported; the comparison window
 * is the seven days before it.
 */
export async function getWeeklySignals(
  weekStart: Date,
  region?: string,
): Promise<WeeklyLocationSignal[]> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const where = [eq(restaurants.isOwner, false), eq(restaurants.isRegional, false)];
  if (region) where.push(eq(restaurants.region, region));

  const locations = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
      region: restaurants.region,
    })
    .from(restaurants)
    .where(and(...where));

  if (locations.length === 0) return [];
  const ids = locations.map((l) => l.id);

  const [scanRows, gmRows] = await Promise.all([
    db
      .select({
        restaurantId: reviews.restaurantId,
        thisWeek: countSql`count(*) filter (where ${reviews.createdAt} >= ${weekStart} and ${reviews.createdAt} < ${weekEnd})`,
        lastWeek: countSql`count(*) filter (where ${reviews.createdAt} >= ${priorStart} and ${reviews.createdAt} < ${weekStart})`,
        staffThisWeek: countSql`count(distinct ${reviews.staffName}) filter (where ${reviews.createdAt} >= ${weekStart} and ${reviews.createdAt} < ${weekEnd})`,
        staffLastWeek: countSql`count(distinct ${reviews.staffName}) filter (where ${reviews.createdAt} >= ${priorStart} and ${reviews.createdAt} < ${weekStart})`,
      })
      .from(reviews)
      .where(and(inArray(reviews.restaurantId, ids), gte(reviews.createdAt, priorStart), lt(reviews.createdAt, weekEnd)))
      .groupBy(reviews.restaurantId),

    db
      .select({
        restaurantId: productEvents.restaurantId,
        activeDays: countSql`count(distinct date_trunc('day', ${productEvents.createdAt} at time zone 'America/Mexico_City'))`,
      })
      .from(productEvents)
      .where(
        and(
          isNotNull(productEvents.restaurantId),
          inArray(productEvents.restaurantId, ids),
          inArray(productEvents.eventName, [...OPEN_EVENTS]),
          eq(productEvents.role, 'gm'),
          gte(productEvents.createdAt, weekStart),
          lt(productEvents.createdAt, weekEnd),
        ),
      )
      .groupBy(productEvents.restaurantId),
  ]);

  const scansById = new Map(scanRows.map((r) => [r.restaurantId, r]));
  const gmById = new Map(gmRows.map((r) => [r.restaurantId, r.activeDays]));
  const telemetryAvailable = weekStart >= TELEMETRY_START;

  return locations.map((l) => {
    const scans = scansById.get(l.id);
    const scansThisWeek = scans?.thisWeek ?? 0;
    const scansLastWeek = scans?.lastWeek ?? 0;
    const staffAskingThisWeek = scans?.staffThisWeek ?? 0;
    const staffAskingLastWeek = scans?.staffLastWeek ?? 0;
    const gmActiveDays = gmById.get(l.id) ?? 0;

    const signal = classifyLocation({
      scansThisWeek,
      scansLastWeek,
      staffAskingThisWeek,
      staffAskingLastWeek,
      gmActiveDays,
      gmTelemetryAvailable: telemetryAvailable,
    });

    return {
      restaurantId: l.id,
      slug: l.slug,
      name: l.name,
      region: l.region,
      scansThisWeek,
      scansLastWeek,
      staffAskingThisWeek,
      staffAskingLastWeek,
      gmActiveDays,
      gmTelemetryAvailable: telemetryAvailable,
      signal,
    };
  });
}

// ────────────────────────────────────────────────────────────
// Guest-book numbers (the frame the owner briefing uses)
// ────────────────────────────────────────────────────────────

export interface GuestSignal {
  restaurantId: number;
  /** Club VIP members on file, all time. */
  totalGuests: number;
  /** Members captured during the reported week. */
  newThisWeek: number;
  /** Members with visits on 2+ distinct days. */
  returningGuests: number;
  /** Courtesies validated during the reported week. */
  courtesiesThisWeek: number;
}

/** Guest-book counts per location for the reported week. */
export async function getGuestSignals(
  weekStart: Date,
  region?: string,
): Promise<Map<number, GuestSignal>> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const where = [eq(restaurants.isOwner, false), eq(restaurants.isRegional, false)];
  if (region) where.push(eq(restaurants.region, region));

  const locations = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(...where));
  const ids = locations.map((l) => l.id);
  if (ids.length === 0) return new Map();

  const [guestRows, returningRows] = await Promise.all([
    db
      .select({
        restaurantId: guests.restaurantId,
        total: countSql`count(*)`,
        newThisWeek: countSql`count(*) filter (where ${guests.capturedAt} >= ${weekStart} and ${guests.capturedAt} < ${weekEnd})`,
        courtesies: countSql`count(*) filter (where ${guests.validatedAt} >= ${weekStart} and ${guests.validatedAt} < ${weekEnd})`,
      })
      .from(guests)
      .where(inArray(guests.restaurantId, ids))
      .groupBy(guests.restaurantId),

    db
      .select({
        restaurantId: guestVisits.restaurantId,
        returning: countSql`count(distinct ${guestVisits.guestId}) filter (where ${guestVisits.guestId} in (
          select guest_id from guest_visits group by guest_id having count(distinct date(visit_date at time zone 'America/Mexico_City')) >= 2
        ))`,
      })
      .from(guestVisits)
      .where(inArray(guestVisits.restaurantId, ids))
      .groupBy(guestVisits.restaurantId),
  ]);

  const returningById = new Map(returningRows.map((r) => [r.restaurantId, r.returning]));

  const out = new Map<number, GuestSignal>();
  for (const id of ids) {
    const g = guestRows.find((r) => r.restaurantId === id);
    out.set(id, {
      restaurantId: id,
      totalGuests: g?.total ?? 0,
      newThisWeek: g?.newThisWeek ?? 0,
      returningGuests: returningById.get(id) ?? 0,
      courtesiesThisWeek: g?.courtesies ?? 0,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Upcoming birthdays (regional briefing)
// ────────────────────────────────────────────────────────────

export interface UpcomingBirthday {
  locationName: string;
  guestName: string;
  /** "DD/MM" */
  birthday: string;
}

/**
 * Club VIP members whose birthday falls inside the forward window, scoped to a
 * region. Ordered soonest first so the manager works the list top-down.
 *
 * Matches the same window the /guests filter uses — a manager reading the email
 * and a manager opening the app should see the same people.
 */
export async function getUpcomingBirthdays(
  from: Date,
  region?: string,
): Promise<UpcomingBirthday[]> {
  const keys = birthdayWindowKeys(from);

  const where = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    inArray(guests.birthdayMmdd, keys),
  ];
  if (region) where.push(eq(restaurants.region, region));

  const rows = await db
    .select({
      locationName: restaurants.name,
      guestName: guests.name,
      birthday: guests.birthdayMmdd,
    })
    .from(guests)
    .innerJoin(restaurants, eq(restaurants.id, guests.restaurantId))
    .where(and(...where));

  const order = new Map(keys.map((k, i) => [k, i]));
  return rows
    .filter((r): r is typeof r & { birthday: string } => r.birthday !== null)
    .sort((a, b) => (order.get(a.birthday) ?? 0) - (order.get(b.birthday) ?? 0));
}
