import { db } from '@/db';
import { outreachProspects, outreachEvents } from '@/db/schema';
import { and, eq, gte, inArray, lt, lte, sql, asc } from 'drizzle-orm';
import {
  mexicoHour,
  weekdayMexico,
  startOfTodayMexico,
  startOfTomorrowMexico,
} from '@/lib/mexico-tz';
import {
  buildOutreachEmail,
  sendOutreachEmail,
} from '@/lib/outreach-templates';
import type { OutreachProspect } from '@/lib/outreach-templates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isInSendWindowAt(hour: number, dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 6 && hour >= 10 && hour <= 12;
}

/**
 * Monday–Saturday, Mexico City time, 10:00–12:59 inclusive.
 * Sunday and outside that window are skipped.
 */
export function isInSendWindow(now: Date = new Date()): boolean {
  return isInSendWindowAt(mexicoHour(now), weekdayMexico(now));
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

export async function countTodaysSentEvents(now: Date = new Date()): Promise<number> {
  const start = startOfTodayMexico(now);
  const end = startOfTomorrowMexico(now);
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

/**
 * Atomically claim a touch for a prospect. The UPDATE only lands when the
 * prospect is still at touchNumber - 1 in a sendable status, so a
 * concurrent batch (or a retried cron) cannot double-send the same touch.
 * Returns true when this caller won the claim.
 */
export async function claimProspectTouch(
  prospectId: number,
  touchNumber: 1 | 2 | 3,
  now: Date,
): Promise<boolean> {
  const claimed = await db
    .update(outreachProspects)
    .set({
      touchesSent: touchNumber,
      status: touchNumber === 3 ? 'finished' : 'in_sequence',
      lastTouchAt: now,
      nextTouchAt: computeNextTouchAt(touchNumber, now),
    })
    .where(
      and(
        eq(outreachProspects.id, prospectId),
        eq(outreachProspects.touchesSent, touchNumber - 1),
        inArray(outreachProspects.status, ['queued', 'in_sequence']),
      ),
    )
    .returning({ id: outreachProspects.id });
  return claimed.length > 0;
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

export interface OutreachBatchPlanItem {
  prospectId: number;
  name: string;
  email: string;
  touchNumber: 1 | 2 | 3;
  subject: string;
}

export interface OutreachBatchResult {
  enabled: boolean;
  inWindow: boolean;
  cap: number;
  alreadySentToday: number;
  planned: OutreachBatchPlanItem[];
  sent: number;
  failed: number;
  skippedClaimed: number;
  skipped?: string;
}

/**
 * Single entry point for running the outreach sequence (cron or manual script).
 *
 * Safety: nothing is planned or sent unless OUTREACH_EMAIL_ENABLED === 'true'.
 * With `send: false` it is a pure dry run: it computes the plan and renders
 * subjects without sending email or writing any events.
 *
 * Follow-ups (touch 3, then touch 2) are always planned before new touch 1
 * sends, and the whole plan is truncated to today's remaining ramped cap.
 */
export async function runOutreachBatch(opts: {
  now?: Date;
  send: boolean;
  ignoreWindow?: boolean;
}): Promise<OutreachBatchResult> {
  const now = opts.now ?? new Date();
  const inWindow = isInSendWindow(now);

  if (process.env.OUTREACH_EMAIL_ENABLED !== 'true') {
    return {
      enabled: false,
      inWindow,
      cap: 0,
      alreadySentToday: 0,
      planned: [],
      sent: 0,
      failed: 0,
      skippedClaimed: 0,
      skipped: 'disabled',
    };
  }

  if (!inWindow && !opts.ignoreWindow) {
    return {
      enabled: true,
      inWindow,
      cap: 0,
      alreadySentToday: 0,
      planned: [],
      sent: 0,
      failed: 0,
      skippedClaimed: 0,
      skipped: 'outside_window',
    };
  }

  const firstSent = await getFirstSentEventDate();
  const alreadySentToday = await countTodaysSentEvents(now);
  const cap = dailyCap(dayOfOperation(firstSent ?? now, now)) - alreadySentToday;

  if (cap <= 0) {
    return {
      enabled: true,
      inWindow,
      cap,
      alreadySentToday,
      planned: [],
      sent: 0,
      failed: 0,
      skippedClaimed: 0,
      skipped: 'cap_reached',
    };
  }

  const { touch1, touch2, touch3 } = await selectProspectsForTouch(now);
  const queue = [
    ...touch3.map((prospect) => ({ prospect, touchNumber: 3 as const })),
    ...touch2.map((prospect) => ({ prospect, touchNumber: 2 as const })),
    ...touch1.map((prospect) => ({ prospect, touchNumber: 1 as const })),
  ].slice(0, cap);

  const planned: OutreachBatchPlanItem[] = [];
  for (const { prospect, touchNumber } of queue) {
    const { subject } = await buildOutreachEmail(prospect, touchNumber);
    planned.push({
      prospectId: prospect.id,
      name: prospect.name,
      email: prospect.email,
      touchNumber,
      subject,
    });
  }

  let sent = 0;
  let failed = 0;
  let skippedClaimed = 0;

  if (opts.send) {
    // CLAIM → SEND → RECORD: claim the touch atomically first so a
    // concurrent batch cannot send the same touch twice. On send failure
    // the claim stays in place (one failed touch beats a duplicate).
    for (const { prospect, touchNumber } of queue) {
      const claimed = await claimProspectTouch(prospect.id, touchNumber, now);
      if (!claimed) {
        skippedClaimed++;
        continue;
      }
      try {
        const { subject } = await sendOutreachEmail(prospect, touchNumber);
        await recordSentEvent(prospect.id, touchNumber, subject, now);
        sent++;
      } catch (err) {
        console.error(`[outreach-engine] failed sending touch ${touchNumber} to ${prospect.email}:`, err);
        await recordFailedEvent(prospect.id, touchNumber, err, now);
        failed++;
      }
    }
  }

  return { enabled: true, inWindow, cap, alreadySentToday, planned, sent, failed, skippedClaimed };
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
