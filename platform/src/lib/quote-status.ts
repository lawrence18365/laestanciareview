/**
 * Quote status vocabulary and the money formatter — the browser-safe half of the
 * quote lifecycle.
 *
 * WHY THIS FILE IS SEPARATE (a production outage, not a preference):
 * `/quotes` is a client component (QuoteList.tsx) and it needs the status labels,
 * the active-status list and formatPesos. It used to import them from
 * `@/lib/quote-lifecycle`, and that module imports `@/db`. A client component's
 * imports are bundled for the browser, so `src/db/index.ts` — which reads
 * `process.env.DATABASE_URL` at module scope — ended up in the browser bundle,
 * where DATABASE_URL is undefined (Next inlines only NEXT_PUBLIC_* vars). Module
 * evaluation threw before React could render anything:
 *
 *   TypeError: undefined is not an object
 *     (evaluating 'process.env.DATABASE_URL.replace')  at src/db/index.ts:7
 *
 * The server render was fine, so every server-side check said the page was
 * healthy while every browser showed "Algo salio mal" (app/global-error.tsx).
 * Shipped 10 sep 2026 in 1533c3d, found by a customer on 14 sep 2026.
 *
 * RULE: everything in this file must run in a browser. No `@/db`, no env reads,
 * no Node APIs, no server-only imports — however deep. The guard that enforces
 * this is src/__tests__/client-server-boundary.test.ts.
 *
 * `@/lib/quote-lifecycle` re-exports all of this, so there is exactly one
 * definition of every label, colour and status list in the codebase.
 */

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

/** MX$ 12,500 — no decimals, since these are whole-peso figures. */
export function formatPesos(amount: number): string {
  return `MX$${amount.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}
