/**
 * Quote lifecycle and the conversion readout.
 *
 * The point of the module is one sentence the CEO can say to Juan Carlos or an
 * outside prospect: in this period we sent N quotes, won M events, and
 * collected X pesos. That only works if the history stays intact — the quotes
 * written before today are the entire denominator, so nothing is ever deleted,
 * only moved out of the active view.
 *
 * This module is server-only: it reads the DB. The client-safe half — statuses,
 * labels, colours and formatPesos — lives in @/lib/quote-status and is
 * re-exported here, so the list, the readout and the API cannot drift apart
 * while a client component (QuoteList) can import the vocabulary without
 * dragging @/db into the browser bundle. See quote-status.ts for the outage that
 * made that split necessary.
 */
import { db } from '@/db';
import { quotes } from '@/db/schema';
import { and, eq, gte, lt, inArray, sql, desc } from 'drizzle-orm';
import { ACTIVE_STATUSES, type QuoteConversion, type QuoteStatus } from './quote-status';

export {
  QUOTE_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  STATUS_LABELS,
  STATUS_COLORS,
  isQuoteStatus,
  isTerminal,
  allowedTransitions,
  formatPesos,
} from './quote-status';
export type { QuoteStatus, QuoteConversion } from './quote-status';

/**
 * Conversion for one restaurant over a period.
 *
 * `sent` counts by sentAt and the outcomes count by outcomeAt, so a quote sent
 * in August and won in September lands in the month it was won. That is the
 * honest reading for a revenue question, and it means sent and won in the same
 * period are not two views of the same rows — never present won/sent from this
 * as a percentage.
 */
export async function getQuoteConversion(
  restaurantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<QuoteConversion> {
  const [row] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${quotes.sentAt} >= ${periodStart} and ${quotes.sentAt} < ${periodEnd})`.mapWith(Number),
      won: sql<number>`count(*) filter (where ${quotes.status} = 'won' and ${quotes.outcomeAt} >= ${periodStart} and ${quotes.outcomeAt} < ${periodEnd})`.mapWith(Number),
      declined: sql<number>`count(*) filter (where ${quotes.status} = 'declined' and ${quotes.outcomeAt} >= ${periodStart} and ${quotes.outcomeAt} < ${periodEnd})`.mapWith(Number),
      expired: sql<number>`count(*) filter (where ${quotes.status} = 'expired' and ${quotes.outcomeAt} >= ${periodStart} and ${quotes.outcomeAt} < ${periodEnd})`.mapWith(Number),
      open: sql<number>`count(*) filter (where ${quotes.status} in ('draft','sent'))`.mapWith(Number),
      pesos: sql<number>`coalesce(sum(${quotes.outcomeAmountMxn}) filter (where ${quotes.status} = 'won' and ${quotes.outcomeAt} >= ${periodStart} and ${quotes.outcomeAt} < ${periodEnd}), 0)`.mapWith(Number),
    })
    .from(quotes)
    .where(eq(quotes.restaurantId, restaurantId));

  const closed = (row?.won ?? 0) + (row?.declined ?? 0) + (row?.expired ?? 0);

  return {
    sent: row?.sent ?? 0,
    won: row?.won ?? 0,
    declined: row?.declined ?? 0,
    expired: row?.expired ?? 0,
    open: row?.open ?? 0,
    pesosCollected: row?.pesos ?? 0,
    closeRate: closed > 0 ? (row?.won ?? 0) / closed : null,
  };
}

/**
 * Quotes for the list view. Defaults to active only; `statuses` opens history.
 */
export async function listQuotes(
  restaurantId: number,
  statuses: QuoteStatus[] = ACTIVE_STATUSES,
) {
  return db
    .select()
    .from(quotes)
    .where(and(eq(quotes.restaurantId, restaurantId), inArray(quotes.status, statuses)))
    .orderBy(desc(quotes.updatedAt));
}

/** Quotes past their validity with no answer — candidates to mark Vencida. */
export async function getStaleQuotes(restaurantId: number, olderThan: Date) {
  return db
    .select()
    .from(quotes)
    .where(
      and(
        eq(quotes.restaurantId, restaurantId),
        eq(quotes.status, 'sent'),
        lt(quotes.sentAt, olderThan),
      ),
    )
    .orderBy(quotes.sentAt);
}
