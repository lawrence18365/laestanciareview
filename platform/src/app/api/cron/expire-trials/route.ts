/**
 * Daily defense-in-depth: flip stale `trialing` rows to `canceled` if their
 * `trial_ends_at` is in the past.
 *
 * Stripe normally fires `customer.subscription.deleted` on trial lapse (because
 * the checkout config sets trial_settings.end_behavior.missing_payment_method
 * = 'cancel'), and the existing webhook handler transitions the status. This
 * cron only catches the case where that webhook was dropped or never arrived.
 *
 * Schedule: daily at 06:00 UTC ≈ 00:00 Mexico City. Idempotent: re-running
 * mid-day won't churn rows that were already flipped on a previous run.
 */
import { NextRequest } from 'next/server';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { restaurants } from '@/db/schema';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || auth !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expired = await db
    .update(restaurants)
    .set({ subscriptionStatus: 'canceled' })
    .where(
      and(
        eq(restaurants.subscriptionStatus, 'trialing'),
        lt(restaurants.trialEndsAt, new Date()),
      ),
    )
    .returning({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug });

  if (expired.length > 0) {
    console.log(
      `[expire-trials] flipped ${expired.length} row(s):`,
      expired.map((r) => r.slug).join(', '),
    );
  }

  return Response.json({
    expired: expired.length,
    rows: expired.map((r) => ({ id: r.id, slug: r.slug, name: r.name })),
  });
}
