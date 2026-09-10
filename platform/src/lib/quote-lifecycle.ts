/**
 * Quote lifecycle and the conversion readout.
 *
 * The point of the module is one sentence the CEO can say to Juan Carlos or an
 * outside prospect: in this period we sent N quotes, won M events, and
 * collected X pesos. That only works if the history stays intact — the quotes
 * written before today are the entire denominator, so nothing is ever deleted,
 * only moved out of the active view.
 */
import { db } from '@/db';
import { quotes } from '@/db/schema';
import { and, eq, gte, lt, inArray, sql, desc } from 'drizzle-orm';

export const QUOTE_STATUSES = ['draft', 'sent', 'won', 'declined', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Statuses still in play. The quotes list defaults to exactly these. */
export const ACTIVE_STATUSES: QuoteStatus[] = ['draft', 'sent'];

/** Statuses that are finished. Kept forever; hidden from the default view. */
export const TERMINAL_STATUSES: QuoteStatus[] = ['won', 'declined', 'expired'];

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  won: 'Ganada',
  declined: 'Declinada',
  expired: 'Vencida',
};

/** Tailwind-free colour tokens, so the list and the readout agree. */
export const STATUS_COLORS: Record<QuoteStatus, { bg: string; text: string }> = {
  draft: { bg: '#f5f5f4', text: '#57534e' },
  sent: { bg: '#eff6ff', text: '#1d4ed8' },
  won: { bg: '#f0fdf4', text: '#15803d' },
  declined: { bg: '#fef2f2', text: '#b91c1c' },
  expired: { bg: '#fafaf9', text: '#a8a29e' },
};

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === 'string' && (QUOTE_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: QuoteStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Which statuses a quote may move to next.
 *
 * Terminal statuses are reversible — a GM who marks the wrong quote Ganada
 * needs a way back, and a "declined" client sometimes returns. Reopening is
 * allowed; silently losing the row is not.
 */
export function allowedTransitions(from: QuoteStatus): QuoteStatus[] {
  switch (from) {
    case 'draft':
      return ['sent', 'declined', 'expired'];
    case 'sent':
      return ['won', 'declined', 'expired', 'draft'];
    case 'won':
    case 'declined':
    case 'expired':
      return ['sent', 'draft'];
  }
}

export interface QuoteConversion {
  /** Quotes that reached the client in the period. */
  sent: number;
  /** Quotes marked won in the period. */
  won: number;
  declined: number;
  expired: number;
  /** Still awaiting an answer — not yet countable either way. */
  open: number;
  /** Pesos actually collected on won quotes in the period. */
  pesosCollected: number;
  /** won / (won + declined + expired). Null while nothing has closed. */
  closeRate: number | null;
}

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

/** MX$ 12,500 — no decimals, since these are whole-peso figures. */
export function formatPesos(amount: number): string {
  return `MX$${amount.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}
