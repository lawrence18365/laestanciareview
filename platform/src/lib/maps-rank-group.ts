import { db } from '@/db';
import { restaurants, mapsRankKeywords, mapsRankGroupSamples } from '@/db/schema';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  fetchPlaceLocation,
  gridPoints,
  mapWithConcurrency,
  searchTopIds,
  type LatLng,
} from '@/lib/maps-rank';

/**
 * Group share of Google Maps top 3. For each city and active keyword, the same
 * 3x3 grid as the per-restaurant tracker is searched, and we record which of OUR
 * restaurants held the top 3. Competitor place IDs are dropped before storage.
 */

const GRID_SPACING_M = 2000;
const CONCURRENCY = 6;

export type GroupShareSummary = {
  city: string;
  keyword: string;
  measured: number;
  avgTop3: number;
  pointsAny: number;
  pointsTwoPlus: number;
  holders: { restaurantId: number; name: string; points: number }[];
  prevAvgTop3: number | null;
  runDate: string;
  prevRunDate: string | null;
};

type GroupRow = { city: string; keyword: string; runDate: string; status: string; groupTop3: number; holderIds: number[] };

/**
 * Group = our locations only. Owner and regional accounts are excluded, as in
 * the owner briefing, and so is every location with no group_key (self-serve
 * trials are their own island: they are never swept as part of the group, so
 * they can neither hold a group top-3 slot nor appear in a group summary).
 */
const groupLocationWhere = and(
  isNotNull(restaurants.googlePlaceId),
  isNotNull(restaurants.city),
  eq(restaurants.isOwner, false),
  eq(restaurants.isRegional, false),
  isNotNull(restaurants.groupKey),
);

export async function runGroupShareSweep(
  runDate: string,
): Promise<{ cities: number; samples: number; failed: number }> {
  const locations = await db
    .select({ id: restaurants.id, city: restaurants.city, placeId: restaurants.googlePlaceId })
    .from(restaurants)
    .where(groupLocationWhere);
  const groupLocations = locations.flatMap((l) =>
    l.city && l.city.trim() && l.placeId ? [{ id: l.id, city: l.city.trim(), placeId: l.placeId }] : [],
  );
  if (groupLocations.length === 0) return { cities: 0, samples: 0, failed: 0 };

  const keywordRows = await db
    .select({ restaurantId: mapsRankKeywords.restaurantId, keyword: mapsRankKeywords.keyword })
    .from(mapsRankKeywords)
    .where(
      and(
        eq(mapsRankKeywords.active, true),
        inArray(mapsRankKeywords.restaurantId, groupLocations.map((l) => l.id)),
      ),
    );

  // Place ID to our restaurant id. Any top-3 place not in this map is a competitor and is discarded.
  const ourIdByPlace = new Map(groupLocations.map((l) => [l.placeId, l.id]));

  const cities = [...new Set(groupLocations.map((l) => l.city))];
  let swept = 0;
  let samples = 0;
  let failed = 0;

  for (const city of cities) {
    const cityLocations = groupLocations.filter((l) => l.city === city);
    const cityIds = new Set(cityLocations.map((l) => l.id));
    const keywords = [
      ...new Set(keywordRows.filter((k) => cityIds.has(k.restaurantId)).map((k) => k.keyword)),
    ].sort();
    if (keywords.length === 0) continue;

    try {
      // Center is fetched fresh and never stored, the same as the per-restaurant sweep.
      const centers: LatLng[] = [];
      for (const location of cityLocations) {
        const point = await fetchPlaceLocation(location.placeId);
        if (point) centers.push(point);
      }
      if (centers.length === 0) throw Object.assign(new Error('no center'), { code: 'no_location' });
      const center = {
        lat: centers.reduce((sum, p) => sum + p.lat, 0) / centers.length,
        lng: centers.reduce((sum, p) => sum + p.lng, 0) / centers.length,
      };

      const points = gridPoints(center, GRID_SPACING_M);
      const tasks = keywords.flatMap((keyword) =>
        points.map((point, gridPoint) => ({ keyword, gridPoint, point })),
      );
      const results = await mapWithConcurrency(tasks, CONCURRENCY, (task) =>
        searchTopIds(task.keyword, task.point),
      );

      const sampleRows = tasks.map((task, i) => {
        const ids = results[i];
        const holderIds = ids
          ? ids.slice(0, 3).flatMap((placeId) => {
              const ourId = ourIdByPlace.get(placeId);
              return ourId === undefined ? [] : [ourId];
            })
          : [];
        return {
          city,
          keyword: task.keyword,
          gridPoint: task.gridPoint,
          runDate,
          status: ids ? 'ok' : 'error',
          groupTop3: holderIds.length,
          holderIds,
        };
      });
      await db
        .insert(mapsRankGroupSamples)
        .values(sampleRows)
        .onConflictDoUpdate({
          target: [
            mapsRankGroupSamples.city,
            mapsRankGroupSamples.keyword,
            mapsRankGroupSamples.gridPoint,
            mapsRankGroupSamples.runDate,
          ],
          set: {
            status: sql`excluded.status`,
            groupTop3: sql`excluded.group_top3`,
            holderIds: sql`excluded.holder_ids`,
            capturedAt: sql`now()`,
          },
        });
      samples += sampleRows.length;
      swept++;
    } catch (err) {
      // Log the city and an error code only: request errors can carry request details.
      failed++;
      const code =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (err as { code?: string })?.code ??
        (err as Error)?.name ??
        'unknown';
      console.error(`[maps-rank-group] city ${city} sweep failed: ${code}`);
    }
  }

  return { cities: swept, samples, failed };
}

function roundOne(n: number): number {
  return Math.round(n * 10) / 10;
}

type RunStats = { measured: number; avgTop3: number; pointsAny: number; pointsTwoPlus: number; holders: Map<number, number> };

function summarizeGroupRun(rows: GroupRow[]): RunStats {
  const holders = new Map<number, number>();
  let measured = 0;
  let total = 0;
  let pointsAny = 0;
  let pointsTwoPlus = 0;
  for (const row of rows) {
    // Errors leave the denominator: a failed Places call is not a ranking.
    if (row.status !== 'ok') continue;
    measured++;
    total += row.groupTop3;
    if (row.groupTop3 > 0) pointsAny++;
    if (row.groupTop3 >= 2) pointsTwoPlus++;
    for (const id of row.holderIds) holders.set(id, (holders.get(id) ?? 0) + 1);
  }
  return {
    measured,
    avgTop3: measured === 0 ? 0 : roundOne(total / measured),
    pointsAny,
    pointsTwoPlus,
    holders,
  };
}

/** Pure. Latest run vs previous run per city x keyword. Sorted by city, then avgTop3 desc. */
export function summarizeGroupShare(rows: GroupRow[], names: Map<number, string>): GroupShareSummary[] {
  const byPair = new Map<string, Map<string, GroupRow[]>>();
  for (const row of rows) {
    const key = `${row.city}\u0000${row.keyword}`;
    const runs = byPair.get(key) ?? new Map<string, GroupRow[]>();
    const list = runs.get(row.runDate) ?? [];
    list.push(row);
    runs.set(row.runDate, list);
    byPair.set(key, runs);
  }

  const summaries: GroupShareSummary[] = [];
  for (const [key, runs] of byPair) {
    const [city, keyword] = key.split('\u0000');
    const dates = [...runs.keys()].sort((a, b) => b.localeCompare(a));
    const runDate = dates[0];
    const prevRunDate = dates[1] ?? null;
    const latest = summarizeGroupRun(runs.get(runDate)!);
    const previous = prevRunDate ? summarizeGroupRun(runs.get(prevRunDate)!) : null;

    const holders = [...latest.holders]
      .map(([restaurantId, points]) => ({
        restaurantId,
        name: names.get(restaurantId) ?? `#${restaurantId}`,
        points,
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    summaries.push({
      city,
      keyword,
      measured: latest.measured,
      avgTop3: latest.avgTop3,
      pointsAny: latest.pointsAny,
      pointsTwoPlus: latest.pointsTwoPlus,
      holders,
      prevAvgTop3: previous && previous.measured > 0 ? previous.avgTop3 : null,
      runDate,
      prevRunDate,
    });
  }

  return summaries.sort(
    (a, b) => a.city.localeCompare(b.city) || b.avgTop3 - a.avgTop3 || a.keyword.localeCompare(b.keyword),
  );
}

/** Fail closed: a viewer with no group_key gets nothing. */
export async function getGroupShareSummary(
  groupKey: string | null | undefined,
): Promise<GroupShareSummary[]> {
  if (!groupKey) return [];
  const [rows, locations] = await Promise.all([
    db
      .select({
        city: mapsRankGroupSamples.city,
        keyword: mapsRankGroupSamples.keyword,
        runDate: mapsRankGroupSamples.runDate,
        status: mapsRankGroupSamples.status,
        groupTop3: mapsRankGroupSamples.groupTop3,
        holderIds: mapsRankGroupSamples.holderIds,
      })
      .from(mapsRankGroupSamples),
    db
      .select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants)
      .where(and(groupLocationWhere, eq(restaurants.groupKey, groupKey))),
  ]);
  return summarizeGroupShare(rows, new Map(locations.map((l) => [l.id, l.name])));
}
