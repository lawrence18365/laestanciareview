import { NextRequest } from 'next/server';
import {
  isInSendWindow,
  getFirstSentEventDate,
  countTodaysSentEvents,
  dailyCap,
  dayOfOperation,
  sendNextTouches,
} from '@/lib/outreach-engine';

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

  if (!isInSendWindow()) {
    return Response.json({ skipped: true, reason: 'outside_mexico_city_window' });
  }

  const now = new Date();
  const firstSent = await getFirstSentEventDate();
  const operationDay = firstSent ? dayOfOperation(firstSent, now) : 1;
  const cap = dailyCap(operationDay);
  const alreadySent = await countTodaysSentEvents();
  const remaining = Math.max(0, cap - alreadySent);

  if (remaining <= 0) {
    return Response.json({
      skipped: false,
      sent: 0,
      failed: 0,
      capped: true,
      cap,
      alreadySent,
    });
  }

  const { sent, failed, capped } = await sendNextTouches(now, remaining);

  return Response.json({
    skipped: false,
    sent,
    failed,
    capped,
    cap,
    alreadySent,
    remainingAfter: Math.max(0, remaining - sent - failed),
  });
}
