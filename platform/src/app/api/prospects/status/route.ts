/**
 * Founder prospect board — one-tap status advancement.
 *
 * Auth: requires a valid ratetap_session cookie with role owner/regional
 * (same gate as the /prospects page, enforced here because middleware only
 * guards page routes).
 *
 * CRON SAFETY: every action moves the row to 'sent' / 'replied' / 'booked'
 * / 'won' / 'lost' — none of which are in the prospect-outreach cron's
 * target set ('pending', 'identified', 'queued', 'failed'), so advancing a
 * prospect here permanently removes it from the auto-SMS pool.
 */
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { prospectQueue } from '@/db/schema';
import { verifySession } from '@/lib/session';

export const runtime = 'nodejs';

type Action = 'contacted' | 'replied' | 'demo' | 'won' | 'lost';
const VALID_ACTIONS = new Set<Action>(['contacted', 'replied', 'demo', 'won', 'lost']);

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session || (session.role !== 'owner' && session.role !== 'regional')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { placeId?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const placeId = typeof body.placeId === 'string' ? body.placeId : '';
  const action = body.action as Action;
  if (!placeId || !VALID_ACTIONS.has(action)) {
    return Response.json({ error: 'Invalid placeId or action' }, { status: 400 });
  }

  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  switch (action) {
    case 'contacted':
      set.status = 'sent';
      set.lastOutreachAt = now;
      // Keep the original first-contact timestamp if one already exists.
      set.contactedAt = sql`COALESCE(${prospectQueue.contactedAt}, ${now})`;
      break;
    case 'replied':
      set.status = 'replied';
      set.repliedAt = now;
      break;
    case 'demo':
      set.status = 'booked';
      set.bookedAt = now;
      break;
    case 'won':
      set.status = 'won';
      set.wonAt = now;
      break;
    case 'lost':
      set.status = 'lost';
      set.lostAt = now;
      break;
  }

  const updated = await db
    .update(prospectQueue)
    .set(set)
    .where(eq(prospectQueue.placeId, placeId))
    .returning({ placeId: prospectQueue.placeId, status: prospectQueue.status });

  if (updated.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json({ ok: true, status: updated[0].status });
}
