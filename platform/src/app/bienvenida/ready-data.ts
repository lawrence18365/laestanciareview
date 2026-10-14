/**
 * Data the tailored /bienvenida "ready" screen needs (US-14 T4), shared by the
 * status endpoint (first visit) and the page (reload with a session).
 *
 * Pure and dependency-free so the client component can import it. All numbers
 * come from SQL/Places; nothing is generated.
 *
 * HARD GUARDRAIL: team_mode AND locations_band both NULL (every existing
 * restaurant, including all 12 Grupo Estancia locations) is 'legacy' = the
 * screen exactly as it was before US-14.
 */
import {
  canAskGoal,
  competitorLine,
  goalFromProfile,
  parseGoogleProfile,
  reviewGoal,
  type GoogleProfile,
  type LocationsBand,
  type TeamMode,
} from '@/lib/onboarding-profile';

export interface ReadyProfileFields {
  teamMode: TeamMode | null;
  locationsBand: LocationsBand | null;
  googleReviewCount: number | null;
  googleProfile: GoogleProfile | null;
}

export type ReadyMode = 'legacy' | 'solo' | 'team' | 'group';

interface RestaurantProfileRow {
  teamMode: string | null;
  locationsBand: string | null;
  googleReviewCount: number | null;
  googleProfile: unknown;
}

/** Narrow the raw restaurant row (free-text columns, jsonb) to the payload. */
export function readyProfileFields(r: RestaurantProfileRow): ReadyProfileFields {
  return {
    teamMode: r.teamMode === 'solo' || r.teamMode === 'team' ? r.teamMode : null,
    locationsBand:
      r.locationsBand === '1' || r.locationsBand === '2-5' || r.locationsBand === '6+'
        ? r.locationsBand
        : null,
    googleReviewCount:
      typeof r.googleReviewCount === 'number' && Number.isFinite(r.googleReviewCount)
        ? r.googleReviewCount
        : null,
    googleProfile: parseGoogleProfile(r.googleProfile),
  };
}

/**
 * The optional goal question on the ready screen. Present only for a self-serve
 * restaurant (group_key NULL, team_mode set) that has not answered yet, so a
 * legacy / Grupo row gets nothing added to its payload and an answered one never
 * sees it again.
 */
export interface GoalQuestion {
  teamMode: TeamMode;
}

export function goalQuestionFor(r: {
  groupKey?: string | null;
  teamMode: string | null;
  googleProfile: unknown;
}): { goalQuestion: GoalQuestion } | Record<string, never> {
  if (!canAskGoal(r) || goalFromProfile(r.googleProfile) !== null) return {};
  return { goalQuestion: { teamMode: r.teamMode as TeamMode } };
}

/** Which version of the ready screen to show. */
export function readyMode(f: Pick<ReadyProfileFields, 'teamMode' | 'locationsBand'>): ReadyMode {
  if (f.locationsBand === '6+') return 'group';
  if (f.teamMode === 'solo') return 'solo';
  if (f.teamMode === 'team') return 'team';
  return 'legacy';
}

export type PersonalPiece = 'count' | 'competitors' | 'goal';

/**
 * The personal line under the header, one sentence per piece. A piece whose
 * data is missing is omitted: a missing count is never shown as zero.
 */
export function personalLine(
  f: Pick<ReadyProfileFields, 'googleReviewCount' | 'googleProfile'>,
): { pieces: PersonalPiece[]; sentences: string[] } {
  const pieces: PersonalPiece[] = [];
  const sentences: string[] = [];
  const n = f.googleReviewCount;
  if (n !== null) {
    pieces.push('count');
    sentences.push(`Tienes ${n.toLocaleString('es-MX')} ${n === 1 ? 'reseña' : 'reseñas'} en Google.`);
  }
  const rivals = f.googleProfile ? competitorLine(n, f.googleProfile.competitors) : null;
  if (rivals) {
    pieces.push('competitors');
    sentences.push(rivals);
  }
  if (n !== null) {
    pieces.push('goal');
    sentences.push(`Meta sugerida: ${reviewGoal(n).toLocaleString('es-MX')} este mes.`);
  }
  return { pieces, sentences };
}

// ---------------------------------------------------------------------------
// "Tu lugar en Google Maps" card (US-16). Fed by maps_rank_samples, which the
// signup sweep writes seconds after the account exists.
// ---------------------------------------------------------------------------

/** The Maps rank sweep always measures a 3x3 grid. */
export const MAPS_ZONES = 9;
export const MAPS_POLL_MS = 5_000;
export const MAPS_POLL_MAX_MS = 90_000;

export interface MapsCardData {
  keyword: string;
  /** Zones (of 9) where the place appeared in the first 20 results. */
  found: number;
  /** Best rank across zones, null when found is 0. */
  best: number | null;
}

type MapsSummaryInput = {
  keyword: string;
  runDate: string;
  measured: number;
  found: number;
  bestRank: number | null;
};

/**
 * Newest measured run -> card data, or null while nothing is measured yet.
 * A run whose Places calls all failed (measured 0) is not a ranking.
 */
export function mapsCardFor(summaries: MapsSummaryInput[]): MapsCardData | null {
  let pick: MapsSummaryInput | null = null;
  for (const s of summaries) {
    if (s.measured <= 0) continue;
    if (!pick || s.runDate > pick.runDate) pick = s;
  }
  if (!pick) return null;
  return {
    keyword: pick.keyword,
    found: pick.found,
    best: pick.found > 0 ? pick.bestRank : null,
  };
}

export type MapsCardState =
  | { phase: 'waiting' }
  | { phase: 'card'; card: MapsCardData }
  | { phase: 'hidden' };

export interface MapsCardResponse {
  card: MapsCardData | null;
  /** True when no card will ever come (feature off / not eligible). */
  done?: boolean;
}

/**
 * Polls `load` every 5 s (first call immediately) until a card arrives, the
 * server says there will be none, or 90 s pass. A failed call is just a miss.
 * Returns a stop function.
 */
export function startMapsCardPoll(
  load: () => Promise<MapsCardResponse | null>,
  onState: (s: MapsCardState) => void,
): () => void {
  let stopped = false;
  onState({ phase: 'waiting' });

  const stop = () => {
    stopped = true;
    clearInterval(intervalId);
    clearTimeout(timeoutId);
  };
  async function tick() {
    if (stopped) return;
    let body: MapsCardResponse | null = null;
    try {
      body = await load();
    } catch {
      body = null;
    }
    if (stopped || !body) return;
    if (body.card) {
      stop();
      onState({ phase: 'card', card: body.card });
    } else if (body.done) {
      stop();
      onState({ phase: 'hidden' });
    }
  }
  const intervalId = setInterval(tick, MAPS_POLL_MS);
  const timeoutId = setTimeout(() => {
    if (stopped) return;
    stop();
    onState({ phase: 'hidden' });
  }, MAPS_POLL_MAX_MS);
  void tick();
  return stop;
}
