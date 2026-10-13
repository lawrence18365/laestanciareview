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
