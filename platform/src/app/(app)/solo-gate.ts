import { redirect } from 'next/navigation';
import { isSolo } from '@/lib/onboarding-profile';

/**
 * Solo restaurants (team_mode = 'solo') have no staff, and guest capture /
 * campaign redemption needs staff, so v1 hides those screens. Direct URL hits
 * land on /dashboard. NULL / team restaurants are untouched.
 *
 * Takes the restaurant row loaded server-side; never a client value.
 */
export function redirectIfSolo(restaurant: { teamMode: string | null }): void {
  if (isSolo(restaurant)) redirect('/dashboard');
}
