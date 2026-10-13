/**
 * Self-serve onboarding profile (US-14): the shared types and pure helpers
 * every onboarding/panel/message surface reads.
 *
 * HARD GUARDRAIL: all branching keys off `restaurants.team_mode`. NULL (every
 * existing restaurant, including all 12 Grupo Estancia locations) means
 * today's behavior exactly. Only `team_mode === 'solo'` gets solo UI/messages.
 *
 * Pure and dependency-free so it is safe in server and client components.
 * Templates only: every number shown comes from SQL/Places, never from a model.
 */

export type TeamMode = 'solo' | 'team';
export type LocationsBand = '1' | '2-5' | '6+';

export interface Competitor {
  name: string;
  reviewCount: number;
  rating: number | null;
  distanceM: number | null;
}

export interface GoogleProfile {
  primaryType: string | null;
  types: string[];
  takeout: boolean | null;
  delivery: boolean | null;
  dineIn: boolean | null;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  /** Top 3 by reviewCount, excluding self. */
  competitors: Competitor[];
  /** ISO timestamp of the Places fetch. */
  fetchedAt: string;
  /** Google locations sharing this brand name (chain detection, US-15 M5). */
  chainCount?: number;
}

export function isSolo(r: { teamMode: string | null }): boolean {
  return r.teamMode === 'solo';
}

export function isGroupLead(r: { locationsBand: string | null }): boolean {
  return r.locationsBand === '6+';
}

/**
 * The optional "¿Qué quieres lograr?" answer, stored as `google_profile.goal`
 * (a jsonb merge, so no migration). `team_asks` is only offered to team_mode
 * 'team'.
 */
export const SIGNUP_GOALS = [
  'more_reviews',
  'beat_competitor',
  'customer_feedback',
  'team_asks',
] as const;
export type SignupGoal = (typeof SIGNUP_GOALS)[number];

const GOAL_LABELS: Record<SignupGoal, string> = {
  more_reviews: 'Más reseñas en Google',
  beat_competitor: 'Ganarle a la competencia en Maps',
  customer_feedback: 'Saber qué opinan mis clientes',
  team_asks: 'Que mi equipo pida reseñas',
};

/** The chips to show, in order. The team chip only for team_mode 'team'. */
export function goalOptions(teamMode: string | null): Array<{ goal: SignupGoal; label: string }> {
  return SIGNUP_GOALS.filter((g) => g !== 'team_asks' || teamMode === 'team').map((goal) => ({
    goal,
    label: GOAL_LABELS[goal],
  }));
}

/**
 * Only self-serve restaurants with an onboarding profile are asked: group_key
 * NULL and team_mode set. NULL team_mode (every Grupo Estancia location) and
 * any group member never see the question and cannot answer it.
 */
export function canAskGoal(r: { groupKey?: string | null; teamMode: string | null }): boolean {
  return (r.groupKey ?? null) === null && (r.teamMode === 'solo' || r.teamMode === 'team');
}

/** `google_profile.goal` if it is a known goal, else null. Never throws. */
export function goalFromProfile(raw: unknown): SignupGoal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const g = (raw as Record<string, unknown>).goal;
  return typeof g === 'string' && (SIGNUP_GOALS as readonly string[]).includes(g)
    ? (g as SignupGoal)
    : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCompetitor(v: unknown): Competitor | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const reviewCount = numOrNull(c.reviewCount);
  if (typeof c.name !== 'string' || !c.name || reviewCount === null || reviewCount < 0) {
    return null;
  }
  return {
    name: c.name,
    reviewCount: Math.round(reviewCount),
    rating: numOrNull(c.rating),
    distanceM: numOrNull(c.distanceM),
  };
}

/**
 * Safe parse of the `google_profile` jsonb. Never throws: anything that is not
 * a profile object with a string `fetchedAt` returns null, and malformed
 * fields degrade to null / are dropped individually.
 */
export function parseGoogleProfile(v: unknown): GoogleProfile | null {
  try {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const p = v as Record<string, unknown>;
    if (typeof p.fetchedAt !== 'string' || !p.fetchedAt) return null;
    const chainCount = numOrNull(p.chainCount);
    return {
      ...(chainCount !== null && chainCount >= 0 ? { chainCount: Math.round(chainCount) } : {}),
      primaryType: strOrNull(p.primaryType),
      types: Array.isArray(p.types)
        ? p.types.filter((t): t is string => typeof t === 'string')
        : [],
      takeout: boolOrNull(p.takeout),
      delivery: boolOrNull(p.delivery),
      dineIn: boolOrNull(p.dineIn),
      lat: numOrNull(p.lat),
      lng: numOrNull(p.lng),
      formattedAddress: strOrNull(p.formattedAddress),
      competitors: Array.isArray(p.competitors)
        ? p.competitors
            .map(parseCompetitor)
            .filter((c): c is Competitor => c !== null)
            .slice(0, 3)
        : [],
      fetchedAt: p.fetchedAt,
    };
  } catch {
    return null;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  pizza_restaurant: 'pizzería',
  seafood_restaurant: 'marisquería',
  mexican_restaurant: 'restaurante mexicano',
  bar: 'bar',
  cafe: 'cafetería',
  coffee_shop: 'cafetería',
  taco_restaurant: 'taquería',
  fast_food_restaurant: 'comida rápida',
  steak_house: 'asador',
  bakery: 'panadería',
};

/** es-MX noun for a Places `primaryType`. Fallback: 'restaurante'. */
export function categoryLabel(primaryType: string | null): string {
  if (typeof primaryType !== 'string') return 'restaurante';
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, primaryType)
    ? CATEGORY_LABELS[primaryType]
    : 'restaurante';
}

/** Where to put the QR. Each tip is <= 15 words. */
export function qrPlacementTip(p: GoogleProfile | null, mode: TeamMode | null): string {
  if (p && (p.delivery === true || p.takeout === true)) {
    return 'Pégalo en la caja o la bolsa de cada pedido.';
  }
  if (mode === 'team') return 'Cada mesero muestra su QR al cobrar.';
  return 'Ponlo en la caja de cobro o en cada mesa.';
}

/** Suggested first goal: today's count plus 20 (0 when unknown). */
export function reviewGoal(currentCount: number | null): number {
  return (typeof currentCount === 'number' && Number.isFinite(currentCount) ? currentCount : 0) + 20;
}

function formatCount(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * "Los 3 más cerca tienen 48, 120 y 310." — the competitors' review counts,
 * smallest first. Null when there are no competitors.
 *
 * `_ownCount` is accepted for call-site symmetry with `reviewGoal` but the
 * line states only the competitors' numbers.
 */
export function competitorLine(
  _ownCount: number | null,
  competitors: Competitor[],
): string | null {
  const counts = (Array.isArray(competitors) ? competitors : [])
    .map((c) => c?.reviewCount)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return null;
  if (counts.length === 1) return `El más cerca tiene ${formatCount(counts[0])}.`;
  const labels = counts.map(formatCount);
  const last = labels.pop() as string;
  return `Los ${counts.length} más cerca tienen ${labels.join(', ')} y ${last}.`;
}
