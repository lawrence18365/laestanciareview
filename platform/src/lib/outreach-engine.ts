import { db } from '@/db';
import { outreachProspects, outreachEvents } from '@/db/schema';
import { and, eq, gte, lt, lte, sql, asc } from 'drizzle-orm';
import {
  currentMexicoHour,
  currentMexicoDayOfWeek,
  startOfTodayMexico,
  startOfTomorrowMexico,
} from '@/lib/mexico-tz';
import { sendOutreachEmail } from '@/lib/outreach-templates';
import type { OutreachProspect } from '@/lib/outreach-templates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isInSendWindowAt(hour: number, dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 6 && hour >= 10 && hour <= 12;
}

/**
 * Monday–Saturday, Mexico City time, 10:00–12:59 inclusive.
 * Sunday and outside that window are skipped.
 */
export function isInSendWindow(): boolean {
  return isInSendWindowAt(currentMexicoHour(), currentMexicoDayOfWeek());
}

/**
 * Ramped daily cap derived from the earliest 'sent' event.
 * Days 1-7: 8 emails/day. Days 8-14: 15/day. After: 20/day.
 * If no sent event has happened yet, behaves as day 1 (8).
 */
export function dailyCap(dayOfOperation: number): number {
  if (dayOfOperation <= 7) return 8;
  if (dayOfOperation <= 14) return 15;
  return 20;
}

export function dayOfOperation(firstSentAt: Date, now: Date): number {
  const diffMs = now.getTime() - firstSentAt.getTime();
  return Math.max(1, Math.floor(diffMs / MS_PER_DAY) + 1);
}

export async function getFirstSentEventDate(): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: outreachEvents.createdAt })
    .from(outreachEvents)
    .where(eq(outreachEvents.type, 'sent'))
    .orderBy(asc(outreachEvents.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

export async function countTodaysSentEvents(): Promise<number> {
  const start = startOfTodayMexico();
  const end = startOfTomorrowMexico();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreachEvents)
    .where(and(eq(outreachEvents.type, 'sent'), gte(outreachEvents.createdAt, start), lt(outreachEvents.createdAt, end)));
  return rows[0]?.count ?? 0;
}

export interface ProspectsToSend {
  touch1: OutreachProspect[];
  touch2: OutreachProspect[];
  touch3: OutreachProspect[];
}

export async function selectProspectsForTouch(now: Date): Promise<ProspectsToSend> {
  // Touch 1: status='queued'
  const touch1 = await db
    .select()
    .from(outreachProspects)
    .where(eq(outreachProspects.status, 'queued'))
    .orderBy(asc(outreachProspects.createdAt));

  // Touch 2: status='in_sequence', touches_sent=1, next_touch_at <= now
  const touch2 = await db
    .select()
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.status, 'in_sequence'),
        eq(outreachProspects.touchesSent, 1),
        lte(outreachProspects.nextTouchAt, now),
      ),
    )
    .orderBy(asc(outreachProspects.nextTouchAt));

  // Touch 3: status='in_sequence', touches_sent=2, next_touch_at <= now
  const touch3 = await db
    .select()
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.status, 'in_sequence'),
        eq(outreachProspects.touchesSent, 2),
        lte(outreachProspects.nextTouchAt, now),
      ),
    )
    .orderBy(asc(outreachProspects.nextTouchAt));

  return { touch1, touch2, touch3 };
}

export function nextTouchDelayDays(touchNumber: number): number | null {
  if (touchNumber === 1) return 4;
  if (touchNumber === 2) return 5;
  return null;
}

export function computeNextTouchAt(touchNumber: number, now: Date): Date | null {
  const delay = nextTouchDelayDays(touchNumber);
  if (delay == null) return null;
  return new Date(now.getTime() + delay * MS_PER_DAY);
}

export async function advanceProspectAfterSend(
  prospect: OutreachProspect,
  touchNumber: number,
  now: Date,
): Promise<void> {
  const nextTouchAt = computeNextTouchAt(touchNumber, now);
  const newStatus = touchNumber === 3 ? 'finished' : 'in_sequence';

  await db
    .update(outreachProspects)
    .set({
      status: newStatus,
      touchesSent: touchNumber,
      lastTouchAt: now,
      nextTouchAt,
    })
    .where(eq(outreachProspects.id, prospect.id));
}

export async function recordSentEvent(
  prospectId: number,
  touchNumber: number,
  subject: string,
  now: Date,
): Promise<void> {
  await db.insert(outreachEvents).values({
    prospectId,
    type: 'sent',
    touchNumber,
    meta: { subject },
    createdAt: now,
  });
}

export async function recordFailedEvent(
  prospectId: number,
  touchNumber: number,
  error: unknown,
  now: Date,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.insert(outreachEvents).values({
    prospectId,
    type: 'failed',
    touchNumber,
    meta: { error: message },
    createdAt: now,
  });
}

export async function sendNextTouches(
  now: Date,
  capRemaining: number,
): Promise<{ sent: number; failed: number; capped: boolean }> {
  if (capRemaining <= 0) return { sent: 0, failed: 0, capped: true };

  const { touch1, touch2, touch3 } = await selectProspectsForTouch(now);
  const all = [
    ...touch1.map((p) => ({ prospect: p, touchNumber: 1 as const })),
    ...touch2.map((p) => ({ prospect: p, touchNumber: 2 as const })),
    ...touch3.map((p) => ({ prospect: p, touchNumber: 3 as const })),
  ];

  let sent = 0;
  let failed = 0;

  for (const { prospect, touchNumber } of all) {
    if (sent + failed >= capRemaining) break;

    try {
      const { subject } = await sendOutreachEmail(prospect, touchNumber);
      await advanceProspectAfterSend(prospect, touchNumber, now);
      await recordSentEvent(prospect.id, touchNumber, subject, now);
      sent++;
    } catch (err) {
      console.error(`[outreach-engine] failed sending touch ${touchNumber} to ${prospect.email}:`, err);
      await recordFailedEvent(prospect.id, touchNumber, err, now);
      failed++;
    }
  }

  return { sent, failed, capped: sent + failed >= capRemaining && all.length > sent + failed };
}
