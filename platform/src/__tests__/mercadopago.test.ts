import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { mercadopagoSubscriptions, restaurants } from '@/db/schema';
import { t } from '@/lib/i18n';

const mocks = vi.hoisted(() => {
  const seenEventIds = new Set<string>();
  const insertErrors: unknown[] = [];
  const updatedRows: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const dbInsert = vi.fn(() => ({
    values: vi.fn((values: { eventId: string }) => {
      if (insertErrors.length > 0) {
        return Promise.reject(insertErrors.shift());
      }
      if (seenEventIds.has(values.eventId)) {
        return Promise.reject(new Error('duplicate key value'));
      }
      seenEventIds.add(values.eventId);
      return Promise.resolve(undefined);
    }),
  }));
  return {
    seenEventIds,
    insertErrors,
    updatedRows,
    dbInsert,
    restaurantStatus: 'canceled',
    getPreapproval: vi.fn(),
    getAuthorizedPayment: vi.fn(),
  };
});

vi.mock('@/db', () => ({
  db: {
    insert: mocks.dbInsert,
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === mercadopagoSubscriptions) {
              return [
                {
                  id: 'sub-row-1',
                  restaurantId: 77,
                  preapprovalId: 'preapproval-123',
                  externalReference: '77',
                  status: 'pending',
                  payerEmail: 'gm@example.com',
                  nextPaymentDate: null,
                },
              ];
            }
            if (table === restaurants) {
              return [
                {
                  id: 77,
                  subscriptionStatus: mocks.restaurantStatus,
                  billingProvider: null,
                },
              ];
            }
            return [];
          }),
        })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updatedRows.push({ table, values });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  },
}));

vi.mock('@/lib/mercadopago', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/mercadopago')>();
  return {
    ...original,
    MERCADOPAGO_ACCESS_TOKEN: 'test-access-token',
    getPreapproval: mocks.getPreapproval,
    getAuthorizedPayment: mocks.getAuthorizedPayment,
  };
});

import {
  BILLING_START_DATE,
  billingHasStarted,
  createPreapproval,
  getPriceBreakdown,
  mapPreapprovalStatus,
  verifyMercadoPagoSignature as realVerifySignature,
} from '@/lib/mercadopago';
import { POST as webhookPOST } from '@/app/api/webhooks/mercadopago/route';

function signPayload({
  dataId,
  requestId,
  ts,
  secret,
}: {
  dataId: string;
  requestId: string;
  ts: string;
  secret: string;
}): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

function webhookRequest(
  payload: Record<string, unknown>,
  options: {
    secret?: string;
    requestId?: string | null;
    ts?: string;
    xSignature?: string | null;
  } = {},
) {
  const secret = options.secret ?? 'mp-webhook-secret';
  const requestId = options.requestId === undefined ? 'req-webhook' : options.requestId;
  const ts = options.ts ?? '1700000000';
  const dataId = String((payload.data as { id?: string | number } | undefined)?.id ?? '');
  const signingRequestId = requestId ?? 'req-webhook';
  const v1 = signPayload({ dataId, requestId: signingRequestId, ts, secret });
  const xSignature =
    options.xSignature === undefined ? `ts=${ts},v1=${v1}` : options.xSignature;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (xSignature !== null) headers['x-signature'] = xSignature;
  if (requestId !== null) headers['x-request-id'] = requestId;

  return new NextRequest('https://app.ratetapmx.com/api/webhooks/mercadopago', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

describe('Mercado Pago deferred pricing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the 700 + 27 + 0 = 727 price breakdown', () => {
    const breakdown = getPriceBreakdown();

    expect(breakdown).toEqual({
      base: 700,
      processingCharge: 27,
      tax: 0,
      total: 727,
    });
    expect(breakdown.tax).toBe(0);
  });

  it('includes auto_recurring.start_date for a future first charge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'pre-1', init_point: 'https://mp.test/pre-1', status: 'pending' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPreapproval({
      reason: 'RateTap Pro',
      externalReference: '77',
      payerEmail: 'gm@example.com',
      amount: 727,
      backUrl: 'https://app.ratetapmx.com/settings',
      startDate: BILLING_START_DATE,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      auto_recurring: { start_date?: string };
    };
    expect(body.auto_recurring.start_date).toBe(BILLING_START_DATE.toISOString());
  });

  it('omits auto_recurring.start_date for a past first charge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'pre-2', init_point: 'https://mp.test/pre-2', status: 'pending' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPreapproval({
      reason: 'RateTap Pro',
      externalReference: '77',
      payerEmail: 'gm@example.com',
      amount: 727,
      backUrl: 'https://app.ratetapmx.com/settings',
      startDate: BILLING_START_DATE,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      auto_recurring: { start_date?: string };
    };
    expect(body.auto_recurring).not.toHaveProperty('start_date');
  });

  it.each([
    ['before', '2026-09-01T05:59:59.999Z', false],
    ['on', '2026-09-01T06:00:00.000Z', true],
    ['after', '2026-09-01T06:00:00.001Z', true],
  ] as const)('reports billing as started %s the boundary', (_label, now, expected) => {
    expect(billingHasStarted(new Date(now))).toBe(expected);
  });

  it('keeps billing copy free of forbidden charge labels', () => {
    const billingStrings = Object.values(t.billing).filter(
      (value): value is string => typeof value === 'string',
    );

    expect(billingStrings.join('\n')).not.toMatch(/\b(?:impuesto|iva|tax)\b/i);
  });
});

describe('verifyMercadoPagoSignature', () => {
  const secret = 'mp-webhook-secret';
  const ts = '1700000000';
  const requestId = 'req-abc';
  const dataId = '12345';

  it('accepts a correctly computed signature', () => {
    const v1 = signPayload({ dataId, requestId, ts, secret });
    expect(
      realVerifySignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: requestId,
        dataId,
        secret,
      }),
    ).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const v1 = signPayload({ dataId, requestId, ts, secret });
    const tampered = v1.slice(0, -2) + (v1.endsWith('00') ? 'ff' : '00');
    expect(
      realVerifySignature({
        xSignature: `ts=${ts},v1=${tampered}`,
        xRequestId: requestId,
        dataId,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects a header without v1', () => {
    expect(
      realVerifySignature({
        xSignature: `ts=${ts}`,
        xRequestId: requestId,
        dataId,
        secret,
      }),
    ).toBe(false);
    expect(
      realVerifySignature({ xSignature: null, xRequestId: requestId, dataId, secret }),
    ).toBe(false);
  });

  it('lowercases an alphanumeric data id per MP docs', () => {
    const v1 = signPayload({ dataId: 'abc123', requestId, ts, secret });
    expect(
      realVerifySignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: requestId,
        dataId: 'ABC123',
        secret,
      }),
    ).toBe(true);
  });
});

describe('mapPreapprovalStatus', () => {
  it.each([
    ['authorized', 'active'],
    ['paused', 'past_due'],
    ['cancelled', 'canceled'],
    ['pending', null],
    ['unknown-status', null],
    ['', null],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapPreapprovalStatus(input)).toBe(expected);
  });
});

describe('mercadopago webhook route', () => {
  const secret = 'mp-webhook-secret';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'));
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', secret);
    mocks.seenEventIds.clear();
    mocks.insertErrors.length = 0;
    mocks.updatedRows.length = 0;
    mocks.restaurantStatus = 'canceled';
    mocks.dbInsert.mockClear();
    mocks.getPreapproval.mockReset();
    mocks.getAuthorizedPayment.mockReset();
    mocks.getPreapproval.mockResolvedValue({
      id: 'preapproval-123',
      status: 'authorized',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: '2026-09-21T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const eventPayload = {
    id: 'evt-1',
    type: 'subscription_preapproval',
    action: 'updated',
    data: { id: 'preapproval-123' },
  };

  it('returns 503 without a configured webhook secret before DB access', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', undefined);

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Webhook secret not configured');
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it('returns 401 without x-signature before DB access', async () => {
    const response = await webhookPOST(
      webhookRequest(eventPayload, { xSignature: null }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it('returns 401 without x-request-id before DB access', async () => {
    const response = await webhookPOST(
      webhookRequest(eventPayload, { requestId: null }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it('returns 401 for a tampered v1 before DB access', async () => {
    const v1 = signPayload({
      dataId: 'preapproval-123',
      requestId: 'req-webhook',
      ts: '1700000000',
      secret,
    });
    const tampered = v1.slice(0, -2) + (v1.endsWith('00') ? 'ff' : '00');
    const response = await webhookPOST(
      webhookRequest(eventPayload, {
        xSignature: `ts=1700000000,v1=${tampered}`,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it('still activates the restaurant on an authorized preapproval', async () => {
    const response = await webhookPOST(webhookRequest(eventPayload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mocks.getPreapproval).toHaveBeenCalledWith('preapproval-123');

    const restaurantUpdate = mocks.updatedRows.find((r) => r.table === restaurants);
    expect(restaurantUpdate?.values).toEqual(
      expect.objectContaining({
        subscriptionStatus: 'active',
        billingProvider: 'mercadopago',
      }),
    );

    const subscriptionUpdate = mocks.updatedRows.find(
      (r) => r.table === mercadopagoSubscriptions,
    );
    expect(subscriptionUpdate?.values).toEqual(
      expect.objectContaining({ status: 'authorized' }),
    );
  });

  it('records a cancelled preapproval without downgrading an active restaurant before billing starts', async () => {
    mocks.restaurantStatus = 'active';
    mocks.getPreapproval.mockResolvedValue({
      id: 'preapproval-123',
      status: 'cancelled',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: null,
    });

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(200);
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants),
    ).toBeUndefined();
    expect(
      mocks.updatedRows.find((row) => row.table === mercadopagoSubscriptions)
        ?.values,
    ).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });

  it('downgrades an active restaurant for a cancelled preapproval after billing starts', async () => {
    vi.setSystemTime(new Date('2026-09-01T06:00:00.000Z'));
    mocks.restaurantStatus = 'active';
    mocks.getPreapproval.mockResolvedValue({
      id: 'preapproval-123',
      status: 'cancelled',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: null,
    });

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(200);
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants)?.values,
    ).toEqual(
      expect.objectContaining({
        subscriptionStatus: 'canceled',
        billingProvider: 'mercadopago',
      }),
    );
  });

  it('records a rejected authorized payment without downgrading active access before billing starts', async () => {
    mocks.restaurantStatus = 'active';
    mocks.getAuthorizedPayment.mockResolvedValue({
      id: 'authorized-payment-1',
      status: 'rejected',
      preapproval_id: 'preapproval-123',
      external_reference: '77',
      payment: { id: 'payment-1', status: 'rejected' },
    });
    const payload = {
      id: 'evt-authorized-payment-1',
      type: 'subscription_authorized_payment',
      action: 'updated',
      data: { id: 'authorized-payment-1' },
    };

    const response = await webhookPOST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants),
    ).toBeUndefined();
    expect(
      mocks.updatedRows.find((row) => row.table === mercadopagoSubscriptions)
        ?.values,
    ).toEqual(
      expect.objectContaining({
        lastPaymentId: 'payment-1',
        lastPaymentStatus: 'rejected',
      }),
    );
  });

  it('returns duplicate:true on a second delivery without calling getPreapproval', async () => {
    const first = await webhookPOST(webhookRequest(eventPayload));
    expect(first.status).toBe(200);
    expect(mocks.getPreapproval).toHaveBeenCalledTimes(1);

    const second = await webhookPOST(webhookRequest(eventPayload));
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
    expect(mocks.getPreapproval).toHaveBeenCalledTimes(1);
  });

  it('returns duplicate:true for a 23505 idempotency insert error', async () => {
    mocks.insertErrors.push(
      Object.assign(new Error('wrapped database error'), {
        cause: { code: '23505' },
      }),
    );

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.getPreapproval).not.toHaveBeenCalled();
  });

  it('returns 500 for a non-unique idempotency insert error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const insertError = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    mocks.insertErrors.push(insertError);

    try {
      const response = await webhookPOST(webhookRequest(eventPayload));

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Idempotency error');
      expect(mocks.getPreapproval).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        '[mercadopago-webhook] idempotency insert error:',
        insertError,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('acknowledges unrelated event types as no-ops', async () => {
    const response = await webhookPOST(
      webhookRequest({ id: 'evt-2', type: 'payment', data: { id: 'pay-1' } }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mocks.getPreapproval).not.toHaveBeenCalled();
    expect(mocks.updatedRows).toHaveLength(0);
  });
});
