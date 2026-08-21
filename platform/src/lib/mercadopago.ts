import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.mercadopago.com';

export const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
export const MERCADOPAGO_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;
export const MERCADOPAGO_MONTHLY_AMOUNT_MXN = (() => {
  const parsed = parseFloat(process.env.MERCADOPAGO_MONTHLY_AMOUNT_MXN ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 700;
})();

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
}): Promise<{ id: string; init_point: string; status: string }> {
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
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: params.amount,
        currency_id: 'MXN',
      },
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
