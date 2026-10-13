/**
 * Plans and feature entitlements.
 *
 * Grupo restaurants (group_key set) keep today's exact semantics: anything
 * other than `active` / `trialing` is blocked. Self-serve restaurants
 * (group_key NULL) never hit a lock screen: a lapsed trial lands on the free
 * plan, where the QR keeps working and counts show, but the paid features
 * stay locked.
 */

export type Plan = 'trial' | 'paid' | 'free' | 'blocked';
export type Feature = 'feedback_text' | 'alerts' | 'maps_rank' | 'weekly_report';

export interface PlanInput {
  subscriptionStatus: string;
  groupKey: string | null;
  locationsBand?: string | null;
}

export type BillingCycle = 'monthly' | 'annual';

export function isSelfServe(r: { groupKey: string | null }): boolean {
  return r.groupKey === null;
}

export function planFor(r: PlanInput): Plan {
  if (r.subscriptionStatus === 'active') return 'paid';
  if (r.subscriptionStatus === 'trialing') return 'trial';
  return isSelfServe(r) ? 'free' : 'blocked';
}

export function canUse(plan: Plan, _feature: Feature): boolean {
  return plan === 'trial' || plan === 'paid';
}

const DEFAULT_MONTHLY_MXN = 299;
const DEFAULT_ANNUAL_MXN = 2490;

function priceFromEnv(name: string, fallback: number): number {
  const parsed = parseFloat(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Plan Restaurante price in MXN, read per call so env changes apply at once. */
export function selfServePrice(cycle: BillingCycle): number {
  return cycle === 'annual'
    ? priceFromEnv('SELF_SERVE_ANNUAL_MXN', DEFAULT_ANNUAL_MXN)
    : priceFromEnv('SELF_SERVE_MONTHLY_MXN', DEFAULT_MONTHLY_MXN);
}

/**
 * Whether a restaurant is billed at the Plan Restaurante price: self-serve
 * with locations_band NULL or '1'. Everyone else keeps the global
 * MERCADOPAGO_MONTHLY_AMOUNT_MXN path.
 */
export function usesPlanRestaurantePrice(r: {
  groupKey: string | null;
  locationsBand?: string | null;
}): boolean {
  return isSelfServe(r) && (r.locationsBand == null || r.locationsBand === '1');
}
