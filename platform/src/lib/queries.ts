import { db } from '@/db';
import { reviews, staff, restaurants, mercadopagoSubscriptions } from '@/db/schema';
import { eq, and, gte, lt, sql, desc, count, avg, asc } from 'drizzle-orm';
import { startOfWeek } from 'date-fns';
import { startOfWeekMexico, startOfTodayMexico } from '@/lib/mexico-tz';
import { POSITIVE_RATING_MIN } from '@/lib/feedback';

/** Helper: raw SQL count that returns a JS number (Postgres bigint → string otherwise). */
const countSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  sql<number>(strings, ...values).mapWith(Number);

/** Resolve a restaurant by slug, returning null if not found. */
export async function getRestaurantBySlug(slug: string) {
  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** Latest Mercado Pago subscription row for a restaurant (null if none). */
export async function getLatestMercadopagoSubscription(restaurantId: number) {
  const rows = await db
    .select()
    .from(mercadopagoSubscriptions)
    .where(eq(mercadopagoSubscriptions.restaurantId, restaurantId))
    .orderBy(desc(mercadopagoSubscriptions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve a staff member by code within a restaurant (case-insensitive, whitespace-tolerant). */
export async function getStaffByCode(restaurantId: number, code: string) {
  const rows = await db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.restaurantId, restaurantId),
        sql`lower(btrim(${staff.code})) = lower(btrim(${code}))`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Staff leaderboard: average rating + review count per staff member this week. */
export async function getLeaderboard(restaurantId: number) {
  const monday = startOfWeekMexico();

  return db
    .select({
      staffId: reviews.staffId,
      staffName: reviews.staffName,
      staffCode: reviews.staffCode,
      avgRating: avg(reviews.rating).mapWith(Number),
      reviewCount: count(reviews.id),
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, monday),
      ),
    )
    .groupBy(reviews.staffId, reviews.staffName, reviews.staffCode)
    .orderBy(desc(avg(reviews.rating)), desc(count(reviews.id)));
}

/** All-time staff ranking with 5★ and <4 breakdown for the analytics page. */
export async function getAllTimeStaffRanking(restaurantId: number) {
  return db
    .select({
      staffId: reviews.staffId,
      staffName: reviews.staffName,
      staffCode: reviews.staffCode,
      reviewCount: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      fiveStarCount:
        countSql`count(*) filter (where ${reviews.rating} = 5)`,
      belowFourCount:
        countSql`count(*) filter (where ${reviews.rating} < 4)`,
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId))
    .groupBy(reviews.staffId, reviews.staffName, reviews.staffCode)
    .orderBy(desc(count(reviews.id)), desc(avg(reviews.rating)));
}

/**
 * Personal scoreboard for a single staff member — powers the public
 * /m/[slug]/[code] "mi tablero" page. Today's count + 5★, this week's total,
 * live team rank, and a 7-day trend. All derived from existing review rows
 * (deterministic card attribution), so no Google API / no AI involved.
 */
export async function getStaffPersonalStats(restaurantId: number, staffId: number) {
  const todayStart = startOfTodayMexico();
  const weekStart = startOfWeekMexico();

  // 7-day window, today inclusive → start six Mexico-days back.
  const sparkStart = new Date(todayStart);
  sparkStart.setUTCDate(sparkStart.getUTCDate() - 6);

  const [todayRows, weekRanking, sparkRows] = await Promise.all([
    db
      .select({
        total: count(reviews.id),
        fiveStars: countSql`count(*) filter (where ${reviews.rating} = 5)`,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurantId),
          eq(reviews.staffId, staffId),
          gte(reviews.createdAt, todayStart),
        ),
      ),

    // This week's per-staff totals, ranked. Card-less reviews (staffId null)
    // are excluded so they don't form a phantom competitor.
    db
      .select({
        staffId: reviews.staffId,
        reviewCount: count(reviews.id),
        avgRating: avg(reviews.rating).mapWith(Number),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurantId),
          gte(reviews.createdAt, weekStart),
          sql`${reviews.staffId} is not null`,
        ),
      )
      .groupBy(reviews.staffId)
      .orderBy(desc(count(reviews.id)), desc(avg(reviews.rating))),

    // 7-day trend for this staff member, bucketed by Mexico calendar day.
    db
      .select({
        date: sql<string>`(${reviews.createdAt} at time zone 'America/Mexico_City')::date::text`,
        count: count(reviews.id),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurantId),
          eq(reviews.staffId, staffId),
          gte(reviews.createdAt, sparkStart),
        ),
      )
      .groupBy(sql`(${reviews.createdAt} at time zone 'America/Mexico_City')::date`),
  ]);

  const today = todayRows[0] ?? { total: 0, fiveStars: 0 };
  const idx = weekRanking.findIndex((r) => r.staffId === staffId);
  const rank = idx >= 0 ? idx + 1 : null;
  const teamSize = weekRanking.length;
  const weekTotal = idx >= 0 ? weekRanking[idx].reviewCount : 0;

  // Fill the 7-day series with zeros for days that had no reviews.
  const byDate = new Map(sparkRows.map((r) => [r.date, r.count]));
  const series: { date: string; count: number }[] = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    const key = new Date(now - i * 86_400_000).toLocaleDateString('en-CA', {
      timeZone: 'America/Mexico_City',
    });
    series.push({ date: key, count: byDate.get(key) ?? 0 });
  }

  return {
    todayTotal: today.total,
    todayFiveStars: today.fiveStars,
    weekTotal,
    rank,
    teamSize,
    series,
  };
}

/** Weekly stats: total reviews, average rating, google sends this week. */
export async function getWeeklyStats(restaurantId: number) {
  const monday = startOfWeekMexico();

  const rows = await db
    .select({
      totalReviews: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, monday),
      ),
    );

  return rows[0] ?? { totalReviews: 0, avgRating: 0, googleSends: 0 };
}

/** Last week's stats for comparison. */
export async function getLastWeekStats(restaurantId: number, threshold: number = 4) {
  const thisMonday = startOfWeekMexico();
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);

  const rows = await db
    .select({
      totalReviews: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${threshold})`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, lastMonday),
        sql`${reviews.createdAt} < ${thisMonday}`,
      ),
    );

  return rows[0] ?? { totalReviews: 0, avgRating: 0, googleSends: 0, intercepted: 0 };
}

/** Count of unread complaint feedback below a threshold, excluding all positive ratings. */
export async function getUnreadLowRatingCount(restaurantId: number, threshold: number) {
  const rows = await db
    .select({ count: count(reviews.id) })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        eq(reviews.status, 'new'),
        sql`${reviews.feedback} is not null`,
        sql`${reviews.rating} < ${threshold}`,
        sql`${reviews.rating} < ${POSITIVE_RATING_MIN}`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/** Recent feedback (reviews with feedback text), newest first. */
export async function getRecentFeedback(
  restaurantId: number,
  limit = 20,
) {
  return db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        sql`${reviews.feedback} is not null`,
      ),
    )
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** Get all staff for a restaurant. */
export async function getStaffList(restaurantId: number) {
  return db
    .select()
    .from(staff)
    .where(eq(staff.restaurantId, restaurantId))
    .orderBy(staff.name);
}

/** All feedback for a restaurant, with optional status filter. */
export async function getAllFeedback(restaurantId: number, status?: string, limit = 500) {
  const conditions = [
    eq(reviews.restaurantId, restaurantId),
    sql`${reviews.feedback} is not null`,
  ];
  if (status && ['new', 'reviewed', 'resolved'].includes(status)) {
    conditions.push(eq(reviews.status, status as 'new' | 'reviewed' | 'resolved'));
  }

  return db
    .select()
    .from(reviews)
    .where(and(...conditions))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** Rating distribution: count of each star (1–5) for a restaurant. */
export async function getRatingDistribution(restaurantId: number) {
  const rows = await db
    .select({
      rating: reviews.rating,
      count: count(reviews.id),
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId))
    .groupBy(reviews.rating)
    .orderBy(reviews.rating);

  // Fill in missing ratings with 0
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) dist[r.rating] = r.count;
  return dist;
}

/** Daily review counts for the last N days. */
export async function getDailyReviewCounts(restaurantId: number, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return db
    .select({
      date: sql<string>`to_char(${reviews.createdAt}::date, 'YYYY-MM-DD')`,
      count: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, since),
      ),
    )
    .groupBy(sql`${reviews.createdAt}::date`)
    .orderBy(sql`${reviews.createdAt}::date`);
}

/** All-time stats for a restaurant. */
export async function getAllTimeStats(restaurantId: number) {
  const rows = await db
    .select({
      totalReviews: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      feedbackCount: countSql`count(*) filter (where ${reviews.feedback} is not null)`,
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId));

  return rows[0] ?? { totalReviews: 0, avgRating: 0, googleSends: 0, feedbackCount: 0 };
}

/** Count of complaint feedback (below the positive threshold) with status='new'. */
export async function getNewFeedbackCount(restaurantId: number) {
  const rows = await db
    .select({ count: count(reviews.id) })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        eq(reviews.status, 'new'),
        sql`${reviews.feedback} is not null`,
        sql`${reviews.rating} < ${POSITIVE_RATING_MIN}`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/** Overview stats for restaurants (weekly). Optionally filter by region. */
export async function getOverviewStats(region?: string) {
  const monday = startOfWeekMexico();

  const conditions = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
  ];
  if (region) {
    conditions.push(eq(restaurants.region, region));
  }

  return db
    .select({
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      slug: restaurants.slug,
      googleThreshold: restaurants.googleThreshold,
      weeklyReviews: countSql`count(case when ${reviews.createdAt} >= ${monday} then 1 end)`,
      weeklyAvg: sql<number>`avg(case when ${reviews.createdAt} >= ${monday} then ${reviews.rating} end)`.mapWith(Number),
      weeklyGoogle: countSql`count(case when ${reviews.createdAt} >= ${monday} and ${reviews.sentToGoogle} = true then 1 end)`,
      weeklyIntercepted: countSql`count(case when ${reviews.createdAt} >= ${monday} and ${reviews.sentToGoogle} = false and ${reviews.rating} < ${restaurants.googleThreshold} then 1 end)`,
      totalReviews: count(reviews.id),
      totalAvg: avg(reviews.rating).mapWith(Number),
    })
    .from(restaurants)
    .leftJoin(reviews, eq(restaurants.id, reviews.restaurantId))
    .where(and(...conditions))
    .groupBy(restaurants.id, restaurants.name, restaurants.slug, restaurants.googleThreshold)
    .orderBy(asc(restaurants.name));
}

/** Week before last stats (for digest comparison). */
export async function getWeekBeforeLastStats(restaurantId: number, threshold: number = 4) {
  const thisMonday = startOfWeekMexico();
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const twoWeeksAgo = new Date(lastMonday);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

  const rows = await db
    .select({
      totalReviews: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${threshold})`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, twoWeeksAgo),
        sql`${reviews.createdAt} < ${lastMonday}`,
      ),
    );

  return rows[0] ?? { totalReviews: 0, avgRating: 0, googleSends: 0, intercepted: 0 };
}

/** Last week's leaderboard (top performers). */
export async function getLastWeekLeaderboard(restaurantId: number, limit = 5) {
  const thisMonday = startOfWeekMexico();
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);

  return db
    .select({
      staffName: reviews.staffName,
      staffCode: reviews.staffCode,
      avgRating: avg(reviews.rating).mapWith(Number),
      reviewCount: count(reviews.id),
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, lastMonday),
        sql`${reviews.createdAt} < ${thisMonday}`,
      ),
    )
    .groupBy(reviews.staffName, reviews.staffCode)
    .orderBy(desc(avg(reviews.rating)))
    .limit(limit);
}

export interface QuietStaffEntry {
  staffId: number;
  staffName: string | null;
  staffCode: string | null;
  priorWeeklyAvg: number;
  lastWeekCount: number;
}

/**
 * Staff whose attributed opinion volume fell sharply during the trailing
 * seven days after averaging at least five per week over the prior 21 days.
 *
 * @deprecated Use getStaffAnomalies from '@/lib/anomalies'.
 */
export async function getQuietStaff(
  restaurantId: number,
  now = new Date(),
): Promise<QuietStaffEntry[]> {
  const priorStart = new Date(now.getTime() - 28 * 86_400_000);
  const lastWeekStart = new Date(now.getTime() - 7 * 86_400_000);
  const priorWindow = and(
    gte(reviews.createdAt, priorStart),
    lt(reviews.createdAt, lastWeekStart),
  );
  const lastWeekWindow = and(
    gte(reviews.createdAt, lastWeekStart),
    lt(reviews.createdAt, now),
  );
  const priorCount = countSql`count(*) filter (where ${priorWindow})`;
  const lastWeekCount = countSql`count(*) filter (where ${lastWeekWindow})`;
  const priorWeeklyAvg = sql<number>`(${priorCount})::float / 3`.mapWith(Number);

  return db
    .select({
      staffId: staff.id,
      staffName: staff.name,
      staffCode: staff.code,
      priorWeeklyAvg,
      lastWeekCount,
    })
    .from(reviews)
    .innerJoin(staff, eq(reviews.staffId, staff.id))
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        sql`${reviews.staffId} is not null`,
        gte(reviews.createdAt, priorStart),
        lt(reviews.createdAt, now),
      ),
    )
    .groupBy(staff.id, staff.name, staff.code)
    .having(sql`${priorCount} >= 15 and ${lastWeekCount} <= 1`)
    .orderBy(desc(priorWeeklyAvg));
}

/** All restaurants that have a manager email set (for digest sends). */
export async function getRestaurantsWithEmail() {
  return db
    .select()
    .from(restaurants)
    .where(sql`${restaurants.managerEmail} is not null`);
}

/** All restaurants marked as owner accounts. */
export async function getOwnerAccounts() {
  return db
    .select()
    .from(restaurants)
    .where(eq(restaurants.isOwner, true));
}

/** All regional account rows. */
export async function getRegionalAccounts() {
  return db
    .select()
    .from(restaurants)
    .where(eq(restaurants.isRegional, true));
}

/** All operational restaurant rows, excluding owner and regional accounts. */
export async function getOperationalRestaurants() {
  return db
    .select()
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    );
}

/** Live view stats: real-time team data for the fullscreen tablet display. */
export async function getLiveStats(restaurantId: number, threshold: number = 4) {
  const monday = startOfWeekMexico();
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const todayStart = startOfTodayMexico();

  const totalsSelect = {
    totalScans: count(reviews.id),
    fiveStarCount:
      countSql`count(*) filter (where ${reviews.rating} = 5)`,
    belowFourCount:
      countSql`count(*) filter (where ${reviews.rating} < 4)`,
    intercepted:
      countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${threshold})`,
    sentToGoogle:
      countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
  };

  const [weekTotals, lastWeekTotals, todayTotals, staffReviewStats, lastWeekStaffStatsRaw, allActiveStaff, recentScans] =
    await Promise.all([
      // This week totals
      db.select(totalsSelect).from(reviews).where(
        and(eq(reviews.restaurantId, restaurantId), gte(reviews.createdAt, monday)),
      ),

      // Last week totals (for comparison)
      db.select(totalsSelect).from(reviews).where(
        and(
          eq(reviews.restaurantId, restaurantId),
          gte(reviews.createdAt, lastMonday),
          sql`${reviews.createdAt} < ${monday}`,
        ),
      ),

      // Today totals
      db.select(totalsSelect).from(reviews).where(
        and(eq(reviews.restaurantId, restaurantId), gte(reviews.createdAt, todayStart)),
      ),

      // Per-staff stats this week
      db
        .select({
          staffId: reviews.staffId,
          staffName: reviews.staffName,
          staffCode: reviews.staffCode,
          totalScans: count(reviews.id),
          fiveStarCount:
            countSql`count(*) filter (where ${reviews.rating} = 5)`,
          belowFourCount:
            countSql`count(*) filter (where ${reviews.rating} < 4)`,
          avgRating: avg(reviews.rating).mapWith(Number),
          todayScans:
            countSql`count(*) filter (where ${reviews.createdAt} >= ${todayStart})`,
          todayFiveStars:
            countSql`count(*) filter (where ${reviews.createdAt} >= ${todayStart} and ${reviews.rating} = 5)`,
          todayBelowFour:
            countSql`count(*) filter (where ${reviews.createdAt} >= ${todayStart} and ${reviews.rating} < 4)`,
        })
        .from(reviews)
        .where(
          and(eq(reviews.restaurantId, restaurantId), gte(reviews.createdAt, monday)),
        )
        .groupBy(reviews.staffId, reviews.staffName, reviews.staffCode)
        .orderBy(desc(count(reviews.id))),

      // Per-staff stats last week (Mon-Sun prior to this week's Monday)
      db
        .select({
          staffId: reviews.staffId,
          staffName: reviews.staffName,
          staffCode: reviews.staffCode,
          totalScans: count(reviews.id),
          fiveStarCount:
            countSql`count(*) filter (where ${reviews.rating} = 5)`,
          belowFourCount:
            countSql`count(*) filter (where ${reviews.rating} < 4)`,
          avgRating: avg(reviews.rating).mapWith(Number),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.restaurantId, restaurantId),
            gte(reviews.createdAt, lastMonday),
            sql`${reviews.createdAt} < ${monday}`,
          ),
        )
        .groupBy(reviews.staffId, reviews.staffName, reviews.staffCode)
        .orderBy(desc(count(reviews.id))),

      // All active staff
      db.select().from(staff).where(
        and(eq(staff.restaurantId, restaurantId), eq(staff.active, true)),
      ).orderBy(staff.name),

      // Recent scans for live activity feed (today only, last 20).
      // Single source of truth: the feed and the "today" counters cover
      // the same window, so they can never disagree.
      db
        .select({
          id: reviews.id,
          staffName: reviews.staffName,
          rating: reviews.rating,
          sentToGoogle: reviews.sentToGoogle,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(
          and(eq(reviews.restaurantId, restaurantId), gte(reviews.createdAt, todayStart)),
        )
        .orderBy(desc(reviews.createdAt))
        .limit(20),
    ]);

  const emptyTotals = { totalScans: 0, fiveStarCount: 0, belowFourCount: 0, intercepted: 0, sentToGoogle: 0 };

  return {
    week: weekTotals[0] ?? emptyTotals,
    lastWeek: lastWeekTotals[0] ?? emptyTotals,
    today: todayTotals[0] ?? emptyTotals,
    staffStats: staffReviewStats,
    lastWeekStaffStats: lastWeekStaffStatsRaw,
    allStaff: allActiveStaff,
    recentScans,
  };
}

/** All-time stats broken down for ROI: total google sends + total intercepted. */
export async function getROIStats(restaurantId: number, threshold: number) {
  const rows = await db
    .select({
      totalReviews: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${threshold})`,
      feedbackCount: countSql`count(*) filter (where ${reviews.feedback} is not null)`,
      firstReviewAt: sql<Date | null>`min(${reviews.createdAt})`,
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId));

  return rows[0] ?? {
    totalReviews: 0,
    avgRating: 0,
    googleSends: 0,
    intercepted: 0,
    feedbackCount: 0,
    firstReviewAt: null,
  };
}

/** Monthly review stats for trend charts. */
export async function getMonthlyStats(restaurantId: number, months = 12, threshold: number = 4) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  return db
    .select({
      month: sql<string>`to_char(${reviews.createdAt}, 'YYYY-MM')`,
      reviewCount: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${threshold})`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.restaurantId, restaurantId),
        gte(reviews.createdAt, since),
      ),
    )
    .groupBy(sql`to_char(${reviews.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${reviews.createdAt}, 'YYYY-MM')`);
}

/** Weekly history: review counts grouped by week for the last N weeks. Optionally filter by region. */
export async function getWeeklyHistory(region?: string, weeks = 12) {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  // Snap to Monday of that week
  const sinceMonday = startOfWeek(since, { weekStartsOn: 1 });

  const conditions = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    gte(reviews.createdAt, sinceMonday),
  ];
  if (region) {
    conditions.push(eq(restaurants.region, region));
  }

  const rows = await db
    .select({
      weekStart: sql<string>`to_char(date_trunc('week', ${reviews.createdAt}), 'YYYY-MM-DD')`,
      reviewCount: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${restaurants.googleThreshold})`,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(and(...conditions))
    .groupBy(sql`date_trunc('week', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('week', ${reviews.createdAt})`);

  return rows;
}

/** Total review count before a given date, for cumulative baseline. Optionally filter by region. */
export async function getTotalReviewsBefore(before: Date, region?: string) {
  const conditions = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    sql`${reviews.createdAt} < ${before}`,
  ];
  if (region) {
    conditions.push(eq(restaurants.region, region));
  }

  const rows = await db
    .select({ total: count(reviews.id) })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(and(...conditions));

  return rows[0]?.total ?? 0;
}

/** Weekly history per restaurant: review counts grouped by (restaurant, week). Optionally filter by region. */
export async function getWeeklyHistoryByRestaurant(region?: string, weeks = 12) {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  const sinceMonday = startOfWeek(since, { weekStartsOn: 1 });

  const conditions = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    gte(reviews.createdAt, sinceMonday),
  ];
  if (region) {
    conditions.push(eq(restaurants.region, region));
  }

  const rows = await db
    .select({
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      slug: restaurants.slug,
      weekStart: sql<string>`to_char(date_trunc('week', ${reviews.createdAt}), 'YYYY-MM-DD')`,
      reviewCount: count(reviews.id),
      avgRating: avg(reviews.rating).mapWith(Number),
      googleSends: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
      intercepted: countSql`count(*) filter (where ${reviews.sentToGoogle} = false and ${reviews.rating} < ${restaurants.googleThreshold})`,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(and(...conditions))
    .groupBy(restaurants.id, restaurants.name, restaurants.slug, sql`date_trunc('week', ${reviews.createdAt})`)
    .orderBy(asc(restaurants.name), sql`date_trunc('week', ${reviews.createdAt})`);

  return rows;
}

/** All intercepted reviews across restaurants (for owner/regional drilldown). */
export async function getInterceptedReviews(region?: string, limit = 1000) {
  const conditions = [
    eq(restaurants.isOwner, false),
    eq(restaurants.isRegional, false),
    sql`${reviews.sentToGoogle} = false`,
    sql`${reviews.rating} < ${restaurants.googleThreshold}`,
  ];
  if (region) {
    conditions.push(eq(restaurants.region, region));
  }

  return db
    .select({
      id: reviews.id,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      slug: restaurants.slug,
      rating: reviews.rating,
      feedback: reviews.feedback,
      customerName: reviews.customerName,
      customerEmail: reviews.customerEmail,
      staffName: reviews.staffName,
      staffCode: reviews.staffCode,
      status: reviews.status,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(reviews.restaurantId, restaurants.id))
    .where(and(...conditions))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** Google conversion rate: sent / total for reviews above threshold. */
export async function getGoogleConversionRate(restaurantId: number, threshold: number) {
  const rows = await db
    .select({
      aboveThreshold: countSql`count(*) filter (where ${reviews.rating} >= ${threshold})`,
      sentToGoogle: countSql`count(*) filter (where ${reviews.sentToGoogle} = true)`,
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId));

  const r = rows[0];
  if (!r || r.aboveThreshold === 0) return { rate: 0, above: 0, sent: 0 };
  return {
    rate: Math.round((r.sentToGoogle / r.aboveThreshold) * 100),
    above: r.aboveThreshold,
    sent: r.sentToGoogle,
  };
}
