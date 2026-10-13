import { isSelfServe, planFor } from '@/lib/entitlements';

/** What the app-shell upgrade banner shows. null means no banner. */
export type UpgradeState = { kind: 'trial'; daysLeft: number } | { kind: 'free' };

/** The trial countdown only appears in the last days of the trial. */
export const TRIAL_BANNER_MAX_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left in the trial, rounded up. null when the end date is unknown. */
export function trialDaysLeft(
  trialEndsAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!trialEndsAt) return null;
  return Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Banner state for the app shell. Grupo restaurants (group_key set) never get
 * one: their render must stay identical to before the free plan existed.
 */
export function upgradeStateFor(
  r: {
    subscriptionStatus: string;
    groupKey: string | null;
    locationsBand?: string | null;
    trialEndsAt?: Date | null;
  },
  now: Date = new Date(),
): UpgradeState | null {
  if (!isSelfServe(r)) return null;
  const plan = planFor(r);
  if (plan === 'free') return { kind: 'free' };
  if (plan === 'trial') {
    const daysLeft = trialDaysLeft(r.trialEndsAt, now);
    if (daysLeft !== null && daysLeft <= TRIAL_BANNER_MAX_DAYS) {
      return { kind: 'trial', daysLeft };
    }
  }
  return null;
}
