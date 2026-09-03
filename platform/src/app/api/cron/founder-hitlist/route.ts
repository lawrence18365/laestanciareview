import { NextRequest } from 'next/server';
import { sendFounderDailyHitList } from '@/lib/outreach-notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  try {
    const result = await sendFounderDailyHitList();
    return Response.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[founder-hitlist] failed:', message);
    return Response.json({ sent: false, skipped: false, error: message }, { status: 500 });
  }
}
