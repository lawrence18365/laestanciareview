import { NextRequest } from 'next/server';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, restaurants, reviews } from '@/db/schema';
import { sendPushToRestaurant } from '@/lib/push';
import { sendDailyDigest as sendOutreachDailyDigest } from '@/lib/outreach-notifications';
import {
  startOfTodayMexico,
  startOfYesterdayMexico,
  todayBirthdayKeyMexico,
} from '@/lib/mexico-tz';

export const dynamic = 'force-dynamic';

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

  const outreach = await sendOutreachDailyDigest().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[daily-digest] outreach digest failed:', message);
    return { sent: false, skipped: false, error: message };
  });

  const todayStart = startOfTodayMexico();
  const yesterdayStart = startOfYesterdayMexico();
  const birthdayKey = todayBirthdayKeyMexico();
  const dayTag = todayStart.toISOString().slice(0, 10);

  const operational = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(
      and(eq(restaurants.isOwner, false), eq(restaurants.isRegional, false)),
    );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of operational) {
    try {
      const [birthdayRow, fiveStarRow] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(guests)
          .where(
            and(
              eq(guests.restaurantId, r.id),
              eq(guests.status, 'validated'),
              eq(guests.birthdayMmdd, birthdayKey),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(reviews)
          .where(
            and(
              eq(reviews.restaurantId, r.id),
              eq(reviews.rating, 5),
              gte(reviews.createdAt, yesterdayStart),
              lt(reviews.createdAt, todayStart),
            ),
          ),
      ]);

      const birthdayCount = birthdayRow[0]?.count ?? 0;
      const fiveStarCount = fiveStarRow[0]?.count ?? 0;

      if (birthdayCount === 0 && fiveStarCount === 0) {
        skipped++;
        continue;
      }

      const parts: string[] = [];
      if (birthdayCount > 0) {
        parts.push(
          birthdayCount === 1
            ? '1 cumpleaños hoy. Manda la invitación'
            : `${birthdayCount} cumpleaños hoy. Manda las invitaciones`,
        );
      }
      if (fiveStarCount > 0) {
        parts.push(
          fiveStarCount === 1
            ? '1 reseña de 5 estrellas ayer'
            : `${fiveStarCount} reseñas de 5 estrellas ayer`,
        );
      }

      const title = birthdayCount > 0 ? 'Cumpleaños del día' : 'Resumen del día';
      const url = birthdayCount > 0 ? '/guests?filter=today' : '/dashboard';

      await sendPushToRestaurant(r.id, {
        title,
        body: parts.join(' · '),
        url,
        tag: `daily-${dayTag}`,
      }, { kind: 'daily_digest' });
      sent++;
    } catch (err) {
      console.error(`[daily-digest] ${r.name} failed:`, err);
      failed++;
    }
  }

  return Response.json({
    restaurantPush: { sent, skipped, failed, total: operational.length },
    outreach,
  });
}
