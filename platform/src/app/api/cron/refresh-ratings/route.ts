import { NextRequest } from 'next/server';
import { refreshAllGoogleRatings } from '@/lib/google-places';

export const dynamic = 'force-dynamic';

/**
 * Daily cron: refresh cached Google ratings for all restaurants.
 * Runs once per day at noon UTC via Vercel Cron.
 * Cost: ~12 Google API calls/day = ~$6/month.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || secret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Force refresh all (ignore cache age - it's a daily cron)
  const result = await refreshAllGoogleRatings(0);

  return Response.json({ ok: true, ...result });
}
