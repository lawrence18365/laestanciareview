import { and, eq, gte, lt, sql } from 'drizzle-orm';
import {
  pushNotifications,
  restaurants,
  reviews,
  staff,
} from '@/db/schema';
import { startOfTodayMexico } from '@/lib/mexico-tz';

const DAY_MS = 86_400_000;

const countSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  sql<number>(strings, ...values).mapWith(Number);

export interface StaffAnomaly {
  staffId: number;
  staffName: string;
  staffCode: string;
  baselineWeekly: number;
  lastWeekCount: number;
  dropPct: number;
}

export interface LocationAnomaly {
  restaurantId: number;
  name: string;
  region: string | null;
  expected3d: number;
  actual3d: number;
  dropPct: number;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function mexicoCalendarDaysBefore(dayStart: Date, days: number): Date {
  const date = new Date(dayStart);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function mexicoDateDaysBefore(dayStart: Date, days: number): string {
  return mexicoCalendarDaysBefore(dayStart, days).toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getStaffAnomalies(
  restaurantId: number,
  now = new Date(),
): Promise<StaffAnomaly[]> {
  const boundaries = [35, 28, 21, 14, 7, 0].map((days) => daysBefore(now, days));
  const { db } = await import('@/db');

  const rows = await db
    .select({
      staffId: staff.id,
      staffName: staff.name,
      staffCode: staff.code,
      week1Count: countSql`count(*) filter (
        where ${reviews.createdAt} >= ${boundaries[0]}
          and ${reviews.createdAt} < ${boundaries[1]}
      )`,
      week2Count: countSql`count(*) filter (
        where ${reviews.createdAt} >= ${boundaries[1]}
          and ${reviews.createdAt} < ${boundaries[2]}
      )`,
      week3Count: countSql`count(*) filter (
        where ${reviews.createdAt} >= ${boundaries[2]}
          and ${reviews.createdAt} < ${boundaries[3]}
      )`,
      week4Count: countSql`count(*) filter (
        where ${reviews.createdAt} >= ${boundaries[3]}
          and ${reviews.createdAt} < ${boundaries[4]}
      )`,
      lastWeekCount: countSql`count(*) filter (
        where ${reviews.createdAt} >= ${boundaries[4]}
          and ${reviews.createdAt} < ${boundaries[5]}
      )`,
    })
    .from(reviews)
    .innerJoin(staff, eq(reviews.staffId, staff.id))
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        sql`${reviews.staffId} is not null`,
        gte(reviews.createdAt, boundaries[0]),
        lt(reviews.createdAt, now),
      ),
    )
    .groupBy(staff.id, staff.name, staff.code);

  return rows
    .map((row): StaffAnomaly | null => {
      const activeBaselineWeeks = [
        row.week1Count,
        row.week2Count,
        row.week3Count,
        row.week4Count,
      ]
        .map(finiteNumber)
        .filter((count) => count >= 1);

      if (activeBaselineWeeks.length < 2) return null;

      const baselineWeekly = activeBaselineWeeks.reduce((sum, count) => sum + count, 0)
        / activeBaselineWeeks.length;
      if (baselineWeekly < 5) return null;

      const lastWeekCount = finiteNumber(row.lastWeekCount);
      const dropPct = 1 - lastWeekCount / baselineWeekly;
      if (dropPct < 0.6) return null;

      return {
        staffId: row.staffId,
        staffName: row.staffName,
        staffCode: row.staffCode,
        baselineWeekly,
        lastWeekCount,
        dropPct,
      };
    })
    .filter((row): row is StaffAnomaly => row !== null)
    .sort((a, b) => b.baselineWeekly - a.baselineWeekly);
}

export async function getLocationAnomalies(
  now = new Date(),
): Promise<LocationAnomaly[]> {
  const windowEnd = startOfTodayMexico(now);
  const windowStart = mexicoCalendarDaysBefore(windowEnd, 31);
  const actualDayOffsets = [3, 2, 1];
  const baselineWeekOffsets = [7, 14, 21, 28];
  const { db } = await import('@/db');

  const rows = await db
    .select({
      restaurantId: restaurants.id,
      name: restaurants.name,
      region: restaurants.region,
      reviewDate: sql<string | null>`(${reviews.createdAt} at time zone 'America/Mexico_City')::date::text`,
      reviewCount: countSql`count(${reviews.id})`,
    })
    .from(restaurants)
    .leftJoin(
      reviews,
      and(
        eq(reviews.restaurantId, restaurants.id),
        gte(reviews.createdAt, windowStart),
        lt(reviews.createdAt, windowEnd),
      ),
    )
    .where(
      and(
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    )
    .groupBy(
      restaurants.id,
      restaurants.name,
      restaurants.region,
      sql`(${reviews.createdAt} at time zone 'America/Mexico_City')::date`,
    );

  const locations = new Map<number, {
    restaurantId: number;
    name: string;
    region: string | null;
    countsByDate: Map<string, number>;
  }>();

  for (const row of rows) {
    let location = locations.get(row.restaurantId);
    if (!location) {
      location = {
        restaurantId: row.restaurantId,
        name: row.name,
        region: row.region,
        countsByDate: new Map(),
      };
      locations.set(row.restaurantId, location);
    }

    if (row.reviewDate !== null) {
      location.countsByDate.set(row.reviewDate, finiteNumber(row.reviewCount));
    }
  }

  return [...locations.values()]
    .map((location): LocationAnomaly | null => {
      const actual3d = actualDayOffsets.reduce(
        (total, dayOffset) => total + (
          location.countsByDate.get(mexicoDateDaysBefore(windowEnd, dayOffset)) ?? 0
        ),
        0,
      );
      const expected3d = actualDayOffsets.reduce((threeDayTotal, dayOffset) => {
        const sameWeekdayTotal = baselineWeekOffsets.reduce(
          (weekdayTotal, weekOffset) => weekdayTotal + (
            location.countsByDate.get(
              mexicoDateDaysBefore(windowEnd, dayOffset + weekOffset),
            ) ?? 0
          ),
          0,
        );
        return threeDayTotal + sameWeekdayTotal / baselineWeekOffsets.length;
      }, 0);

      if (expected3d < 6 || actual3d > 0.25 * expected3d) return null;

      return {
        restaurantId: location.restaurantId,
        name: location.name,
        region: location.region,
        expected3d,
        actual3d,
        dropPct: 1 - actual3d / expected3d,
      };
    })
    .filter((row): row is LocationAnomaly => row !== null)
    .sort((a, b) => b.expected3d - a.expected3d);
}

export function formatStaffAnomaly(anomaly: StaffAnomaly): string {
  return `${anomaly.staffName} recibió ${anomaly.lastWeekCount} respuestas esta semana vs ${Math.round(anomaly.baselineWeekly)} normalmente (-${Math.round(anomaly.dropPct * 100)}%).`;
}

export function formatLocationAnomaly(anomaly: LocationAnomaly): string {
  return `${anomaly.name}: ${anomaly.actual3d} respuestas en 3 días vs ${Math.round(anomaly.expected3d)} normalmente (-${Math.round(anomaly.dropPct * 100)}%).`;
}

export async function runDailyLocationAnomalyCheck(now = new Date()) {
  const anomalies = await getLocationAnomalies(now);
  const [{ db }, queryHelpers, pushHelpers] = await Promise.all([
    import('@/db'),
    import('@/lib/queries'),
    import('@/lib/push'),
  ]);
  const [owners, regionalAccounts] = await Promise.all([
    queryHelpers.getOwnerAccounts(),
    queryHelpers.getRegionalAccounts(),
  ]);
  const recentCutoff = daysBefore(now, 3);
  const mexicoDate = startOfTodayMexico(now).toISOString().slice(0, 10);
  let pushed = 0;
  let targeted = 0;
  let skippedRecent = 0;

  for (const anomaly of anomalies) {
    const recent = await db
      .select({ id: pushNotifications.id })
      .from(pushNotifications)
      .where(
        and(
          eq(pushNotifications.kind, 'location_anomaly'),
          eq(pushNotifications.subjectType, 'restaurant'),
          eq(pushNotifications.subjectId, anomaly.restaurantId),
          gte(pushNotifications.createdAt, recentCutoff),
        ),
      )
      .limit(1);

    if (recent.length > 0) {
      skippedRecent++;
      continue;
    }

    const title = formatLocationAnomaly(anomaly);
    const tag = `location-anomaly-${anomaly.restaurantId}-${mexicoDate}`;
    const delivery = {
      kind: 'location_anomaly',
      subjectType: 'restaurant',
      subjectId: anomaly.restaurantId,
    };
    const recipients = new Map(
      [...owners, ...regionalAccounts]
        .filter((account) => (
          account.isOwner
          || (
            account.isRegional
            && anomaly.region !== null
            && account.region === anomaly.region
          )
        ))
        .map((account) => [account.id, account]),
    ).values();

    const locationResult = await pushHelpers.sendPushToRestaurant(anomaly.restaurantId, {
      title,
      body: 'Revise si las tarjetas están en uso.',
      url: '/dashboard',
      tag,
    }, delivery);
    pushed += locationResult.sent;
    targeted += locationResult.targeted;

    for (const account of recipients) {
      const result = await pushHelpers.sendPushToRestaurant(account.id, {
        title,
        body: 'Revise si las tarjetas están en uso.',
        url: '/overview',
        tag,
      }, delivery);
      pushed += result.sent;
      targeted += result.targeted;
    }
  }

  return { anomalies, pushed, targeted, skippedRecent };
}
