import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.mercadopago.com';

export const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
export const MERCADOPAGO_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;

function amountFromEnv(name: string, fallback: number): number {
  const parsed = parseFloat(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const MERCADOPAGO_BASE_AMOUNT_MXN = amountFromEnv(
  'MERCADOPAGO_BASE_AMOUNT_MXN',
  700,
);
export const MERCADOPAGO_PROCESSING_CHARGE_MXN = amountFromEnv(
  'MERCADOPAGO_PROCESSING_CHARGE_MXN',
  27,
);
export const MERCADOPAGO_TAX_AMOUNT_MXN = amountFromEnv(
  'MERCADOPAGO_TAX_AMOUNT_MXN',
  0,
);
export const MERCADOPAGO_MONTHLY_AMOUNT_MXN = (() => {
  const parsed = parseFloat(process.env.MERCADOPAGO_MONTHLY_AMOUNT_MXN ?? '');
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : MERCADOPAGO_BASE_AMOUNT_MXN +
        MERCADOPAGO_PROCESSING_CHARGE_MXN +
        MERCADOPAGO_TAX_AMOUNT_MXN;
})();

export function getPriceBreakdown(): {
  base: number;
  processingCharge: number;
  tax: number;
  total: number;
} {
  return {
    base: MERCADOPAGO_BASE_AMOUNT_MXN,
    processingCharge: MERCADOPAGO_PROCESSING_CHARGE_MXN,
    tax: MERCADOPAGO_TAX_AMOUNT_MXN,
    total: MERCADOPAGO_MONTHLY_AMOUNT_MXN,
  };
}

export const BILLING_START_DATE = new Date('2026-09-01T00:00:00.000-06:00');

// Per-restaurant free-trial window: each subscription's first charge is
// MERCADOPAGO_TRIAL_DAYS days after it is created, but never before the
// global BILLING_START_DATE. A value of 0 (or negative/non-finite) would
// silently kill the trial and could charge immediately after the global
// date, so only strictly positive finite values are honored.
export const MERCADOPAGO_TRIAL_DAYS = trialDaysFromEnv();

function trialDaysFromEnv(): number {
  const parsed = parseFloat(process.env.MERCADOPAGO_TRIAL_DAYS ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function billingHasStarted(now: Date = new Date()): boolean {
  return now.getTime() >= BILLING_START_DATE.getTime();
}

/**
 * First billing date for a subscription created at `now`: the later of the
 * global BILLING_START_DATE and the end of the restaurant's trial window.
 * Pure (aside from the default `now`) so it is unit-testable.
 */
export function computeBillingStartDate(now: Date = new Date()): Date {
  const trialEnd = new Date(now.getTime() + MERCADOPAGO_TRIAL_DAYS * DAY_MS);
  return trialEnd.getTime() > BILLING_START_DATE.getTime()
    ? trialEnd
    : new Date(BILLING_START_DATE.getTime());
}

/**
 * Whether a specific subscription's billing has begun, preferring its
 * per-restaurant `billingStartsAt` over the global BILLING_START_DATE
 * (legacy rows may have it null).
 */
export function subscriptionBillingHasStarted(
  billingStartsAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return billingStartsAt
    ? now.getTime() >= billingStartsAt.getTime()
    : billingHasStarted(now);
}

/** Public base URL of the app, stripped of stray `\n` and trailing slash. */
export function getMercadoPagoBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
}

// ── Minimal API types ─────────────────────────────────────────────────────

export type MercadoPagoPreapproval = {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  external_reference?: string | null;
  payer_email?: string | null;
  next_payment_date?: string | null;
  init_point?: string;
  reason?: string;
};

export type MercadoPagoAuthorizedPayment = {
  id: string | number;
  status?: string | null;
  preapproval_id?: string | null;
  external_reference?: string | null;
  payer_email?: string | null;
  next_payment_date?: string | null;
  payment?: { id?: string | number; status?: string | null } | null;
};

// ── API calls (plain fetch, Bearer auth) ─────────────────────────────────

export async function createPreapproval(params: {
  reason: string;
  externalReference: string;
  payerEmail: string;
  amount: number;
  backUrl: string;
  startDate?: Date;
}): Promise<{ id: string; init_point: string; status: string }> {
  const autoRecurring: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number;
    currency_id: string;
    start_date?: string;
  } = {
    frequency: 1,
    frequency_type: 'months',
    transaction_amount: params.amount,
    currency_id: 'MXN',
  };

  // Always honor an explicit start_date: computeBillingStartDate() never
  // returns a past date, and silently dropping it would let Mercado Pago
  // charge earlier than the trial end we display to the restaurant.
  if (params.startDate) {
    autoRecurring.start_date = params.startDate.toISOString();
  }

  const res = await fetch(`${API_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: params.reason,
      external_reference: params.externalReference,
      payer_email: params.payerEmail,
      back_url: params.backUrl,
      status: 'pending',
      auto_recurring: autoRecurring,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Mercado Pago createPreapproval failed (${res.status}): ${bodyText}`);
  }

  return (await res.json()) as { id: string; init_point: string; status: string };
}

export async function getPreapproval(id: string): Promise<MercadoPagoPreapproval> {
  const res = await fetch(`${API_BASE}/preapproval/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Mercado Pago getPreapproval failed (${res.status}): ${bodyText}`);
  }
  return (await res.json()) as MercadoPagoPreapproval;
}

/**
 * Cancel a preapproval so a stale checkout link can never be charged.
 *
 * Only two outcomes are tolerated without throwing:
 *   - 404: the preapproval no longer exists at all, so nothing live remains.
 *   - a non-ok cancel response whose state is then VERIFIED via a fresh GET
 *     as `cancelled` (the cancel may have been applied despite the error).
 * Anything else — including "cannot cancel" style API errors — throws;
 * callers MUST abort before creating a replacement preapproval so we never
 * leave two live. No response-body heuristics: only the preapproval's
 * actual server-side status proves the cancel landed.
 */
export async function cancelPreapproval(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/preapproval/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (res.ok) return;

  const bodyText = await res.text().catch(() => '');
  if (res.status === 404) {
    console.warn(
      `[mercadopago] cancelPreapproval(${id}) tolerated (404): ${bodyText}`,
    );
    return;
  }

  // Verify the actual state before trusting that the cancel landed.
  let verifiedStatus: string | null = null;
  try {
    const current = await getPreapproval(id);
    verifiedStatus = current.status ?? null;
  } catch (verifyErr) {
    throw new Error(
      `Mercado Pago cancelPreapproval failed (${res.status}): ${bodyText} ` +
        `(verification GET also failed: ${
          verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
        })`,
    );
  }

  if (verifiedStatus === 'cancelled') {
    console.warn(
      `[mercadopago] cancelPreapproval(${id}) tolerated (${res.status}): verified status=cancelled; original error: ${bodyText}`,
    );
    return;
  }

  throw new Error(
    `Mercado Pago cancelPreapproval failed (${res.status}): ${bodyText} ` +
      `(verified status: ${verifiedStatus ?? 'unknown'})`,
  );
}

export async function getAuthorizedPayment(
  id: string,
): Promise<MercadoPagoAuthorizedPayment> {
  const res = await fetch(
    `${API_BASE}/authorized_payments/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` } },
  );
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Mercado Pago getAuthorizedPayment failed (${res.status}): ${bodyText}`);
  }
  return (await res.json()) as MercadoPagoAuthorizedPayment;
}

// ── Webhook signature verification ────────────────────────────────────────

/**
 * Verify Mercado Pago's webhook signature.
 *
 * Documented scheme: the `x-signature` header carries `ts=<unix>,v1=<hex hmac>`.
 * The signed manifest is `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * (the `id:` part is omitted when there is no data id, the `request-id:` part
 * when the header is missing). MP lowercases the data id when it is
 * alphanumeric. The expected v1 is HMAC-SHA256(secret, manifest) in hex.
 *
 * Pure function (no env access) so it is unit-testable.
 */
export function verifyMercadoPagoSignature(params: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
}): boolean {
  const { xSignature, xRequestId, secret } = params;
  if (!xSignature || !secret) return false;

  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of xSignature.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }
  if (!ts || !v1) return false;

  // MP docs: lowercase the data id when it is alphanumeric.
  let dataId = params.dataId ?? '';
  if (dataId && /^[a-zA-Z0-9]+$/.test(dataId)) dataId = dataId.toLowerCase();

  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac('sha256', secret).update(manifest).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const v1Buf = Buffer.from(v1, 'utf8');
  if (expectedBuf.length !== v1Buf.length) return false;
  return timingSafeEqual(expectedBuf, v1Buf);
}

// ── Status mapping ────────────────────────────────────────────────────────

/**
 * Map a raw Mercado Pago preapproval status to our 4-state subscriptionStatus.
 * Returns null for `pending`/unknown statuses, meaning: do not change
 * restaurants.subscriptionStatus.
 */
export function mapPreapprovalStatus(
  status: string,
): 'active' | 'trialing' | 'past_due' | 'canceled' | null {
  switch (status) {
    case 'authorized':
      return 'active';
    case 'paused':
      return 'past_due';
    case 'cancelled':
      return 'canceled';
    default:
      return null;
  }
}
