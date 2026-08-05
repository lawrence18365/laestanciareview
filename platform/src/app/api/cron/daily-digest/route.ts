import { NextRequest } from 'next/server';
import { sendDailyDigest } from '@/lib/outreach-notifications';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || auth !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendDailyDigest();
  return Response.json(result);
}
