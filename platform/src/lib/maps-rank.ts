import { db } from '@/db';
import { restaurants, mapsRankKeywords, mapsRankSamples } from '@/db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { weekdayMexico } from '@/lib/mexico-tz';
import { runGroupShareSweep } from '@/lib/maps-rank-group';

/**
 * Google Maps rank tracker. Each sweep asks Places Text Search for every active
 * keyword at a 3x3 grid around the restaurant and records where its place ID
 * lands. Only our own place ID and the rank are stored. Coordinates are fetched
 * fresh each run and never persisted, and competitor results are discarded.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';
const MEXICO_TZ = 'America/Mexico_City';
const METERS_PER_DEG_LAT = 111_320;
const LOCATION_BIAS_RADIUS_M = 1500;
const RESULT_PAGE_SIZE = 20;

export type LatLng = { lat: number; lng: number };
export type PointResult =
  | { status: 'found'; rank: number }
  | { status: 'not_returned' }
  | { status: 'error' };

export type SweepResult = {
  skipped?: 'disabled' | 'not_sweep_day';
  restaurants: number;
  samples: number;
  failed: number;
  group?: { cities: number; samples: number; failed: number } | { failed: -1 };
};

export type KeywordSummary = {
  keyword: string;
  measured: number;
  top3: number;
  top10: number;
  found: number;
  bestRank: number | null;
  prevTop3: number | null;
  runDate: string;
  prevRunDate: string | null;
};

function apiKey(): string {
  // A copied env value arrived as `"KEY\n"` (quotes plus a literal backslash-n) and every call returned 400 (SQ-159, SQ-160).
  const key = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim().replace(/^"|"$/g, '').replace(/\\n$/, '').trim();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY missing');
  return key;
}

/** 9 grid points, row-major from NW to SE. Index 4 is the center. */
export function gridPoints(center: LatLng, spacingMeters = 1500): LatLng[] {
  const dLat = spacingMeters / METERS_PER_DEG_LAT;
  const dLng = spacingMeters / (METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const points: LatLng[] = [];
  for (const row of [1, 0, -1]) {
    for (const col of [-1, 0, 1]) {
      points.push({ lat: center.lat + row * dLat, lng: center.lng + col * dLng });
    }
  }
  return points;
}

export async function fetchPlaceLocation(placeId: string): Promise<LatLng | null> {
  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'location' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { location?: { latitude?: number; longitude?: number } };
  const latitude = data.location?.latitude;
  const longitude = data.location?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return { lat: latitude, lng: longitude };
}

/** Place IDs in Maps order for one keyword at one point. Null on any failure. */
export async function searchTopIds(keyword: string, point: LatLng): Promise<string[] | null> {
  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({
        textQuery: keyword,
        pageSize: RESULT_PAGE_SIZE,
        languageCode: 'es',
        regionCode: 'MX',
        // Explicit RELEVANCE matched logged-out Google Maps order best and was the most stable run to run (SQ-160).
        rankPreference: 'RELEVANCE',
        locationBias: {
          circle: {
            center: { latitude: point.lat, longitude: point.lng },
            radius: LOCATION_BIAS_RADIUS_M,
          },
        },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { places?: { id?: string }[] };
    return (data.places ?? []).map((p) => p.id ?? '');
  } catch {
    return null;
  }
}

export async function searchRank(keyword: string, point: LatLng, placeId: string): Promise<PointResult> {
  const ids = await searchTopIds(keyword, point);
  if (!ids) return { status: 'error' };
  const index = ids.indexOf(placeId);
  return index === -1 ? { status: 'not_returned' } : { status: 'found', rank: index + 1 };
}

/** Sundays in Mexico City. */
export function isSweepDay(now: Date = new Date()): boolean {
  return weekdayMexico(now) === 0;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runMapsRankSweep(
  opts: { force?: boolean; now?: Date; concurrency?: number } = {},
): Promise<SweepResult> {
  if (process.env.MAPS_RANK_ENABLED !== 'true') {
    return { skipped: 'disabled', restaurants: 0, samples: 0, failed: 0 };
  }
  const now = opts.now ?? new Date();
  if (!opts.force && !isSweepDay(now)) {
    return { skipped: 'not_sweep_day', restaurants: 0, samples: 0, failed: 0 };
  }
  const concurrency = opts.concurrency ?? 6;
  const runDate = now.toLocaleDateString('en-CA', { timeZone: MEXICO_TZ });

  const rows = await db
    .select({
      id: restaurants.id,
      placeId: restaurants.googlePlaceId,
      keyword: mapsRankKeywords.keyword,
    })
    .from(mapsRankKeywords)
    .innerJoin(restaurants, eq(restaurants.id, mapsRankKeywords.restaurantId))
    .where(and(eq(mapsRankKeywords.active, true), isNotNull(restaurants.googlePlaceId)));

  const byRestaurant = new Map<number, { placeId: string; keywords: string[] }>();
  for (const row of rows) {
    if (!row.placeId) continue;
    const entry = byRestaurant.get(row.id) ?? { placeId: row.placeId, keywords: [] };
    entry.keywords.push(row.keyword);
    byRestaurant.set(row.id, entry);
  }

  let samples = 0;
  let failed = 0;
  for (const [restaurantId, { placeId, keywords }] of byRestaurant) {
    try {
      const location = await fetchPlaceLocation(placeId);
      if (!location) throw Object.assign(new Error('no location'), { code: 'no_location' });

      const points = gridPoints(location);
      const tasks = keywords.flatMap((keyword) =>
        points.map((point, gridPoint) => ({ keyword, gridPoint, point })),
      );
      const results = await mapWithConcurrency(tasks, concurrency, (task) =>
        searchRank(task.keyword, task.point, placeId),
      );

      const sampleRows = tasks.map((task, i) => {
        const result = results[i];
        return {
          restaurantId,
          keyword: task.keyword,
          gridPoint: task.gridPoint,
          runDate,
          status: result.status,
          rank: result.status === 'found' ? result.rank : null,
        };
      });
      await db
        .insert(mapsRankSamples)
        .values(sampleRows)
        .onConflictDoUpdate({
          target: [
            mapsRankSamples.restaurantId,
            mapsRankSamples.keyword,
            mapsRankSamples.gridPoint,
            mapsRankSamples.runDate,
          ],
          set: {
            status: sql`excluded.status`,
            rank: sql`excluded.rank`,
            capturedAt: sql`now()`,
          },
        });
      samples += sampleRows.length;
    } catch (err) {
      // Log only the restaurant id and an error code: request errors can carry request details.
      failed++;
      const code =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (err as { code?: string })?.code ??
        (err as Error)?.name ??
        'unknown';
      console.error(`[maps-rank] restaurant ${restaurantId} sweep failed: ${code}`);
    }
  }

  // A group-share failure must not fail the per-restaurant sweep above.
  let group: SweepResult['group'];
  try {
    group = await runGroupShareSweep(runDate);
  } catch (err) {
    console.error(`[maps-rank] group share sweep failed: ${(err as Error)?.name ?? 'unknown'}`);
    group = { failed: -1 };
  }

  return { restaurants: byRestaurant.size, samples, failed, group };
}

type SampleRow = { keyword: string; runDate: string; status: string; rank: number | null };

function summarizeRun(rows: SampleRow[]) {
  let measured = 0;
  let top3 = 0;
  let top10 = 0;
  let found = 0;
  let bestRank: number | null = null;
  for (const row of rows) {
    // Errors leave the denominator: a failed Places call is not a ranking.
    if (row.status !== 'found' && row.status !== 'not_returned') continue;
    measured++;
    if (row.status !== 'found' || row.rank == null) continue;
    found++;
    if (row.rank <= 3) top3++;
    if (row.rank <= 10) top10++;
    if (bestRank == null || row.rank < bestRank) bestRank = row.rank;
  }
  return { measured, top3, top10, found, bestRank };
}

/** Pure. Latest run vs previous run per keyword. */
export function summarizeSamples(rows: SampleRow[]): KeywordSummary[] {
  const byKeyword = new Map<string, Map<string, SampleRow[]>>();
  for (const row of rows) {
    const runs = byKeyword.get(row.keyword) ?? new Map<string, SampleRow[]>();
    const list = runs.get(row.runDate) ?? [];
    list.push(row);
    runs.set(row.runDate, list);
    byKeyword.set(row.keyword, runs);
  }

  const summaries: KeywordSummary[] = [];
  for (const keyword of [...byKeyword.keys()].sort()) {
    const runs = byKeyword.get(keyword)!;
    const dates = [...runs.keys()].sort((a, b) => b.localeCompare(a));
    const runDate = dates[0];
    const prevRunDate = dates[1] ?? null;
    const latest = summarizeRun(runs.get(runDate)!);
    const previous = prevRunDate ? summarizeRun(runs.get(prevRunDate)!) : null;
    summaries.push({
      keyword,
      measured: latest.measured,
      top3: latest.top3,
      top10: latest.top10,
      found: latest.found,
      bestRank: latest.bestRank,
      prevTop3: previous?.top3 ?? null,
      runDate,
      prevRunDate,
    });
  }
  return summaries;
}

export async function getMapsRankSummary(restaurantId: number): Promise<KeywordSummary[]> {
  const rows = await db
    .select({
      keyword: mapsRankSamples.keyword,
      runDate: mapsRankSamples.runDate,
      status: mapsRankSamples.status,
      rank: mapsRankSamples.rank,
    })
    .from(mapsRankSamples)
    .where(eq(mapsRankSamples.restaurantId, restaurantId));
  return summarizeSamples(rows);
}
