import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { mercadopagoSubscriptions, restaurants } from '@/db/schema';
import { t } from '@/lib/i18n';

const mocks = vi.hoisted(() => {
  const seenEventIds = new Set<string>();
  const insertErrors: unknown[] = [];
  const updatedRows: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const defaultSubscriptionRow = () => ({
    id: 'sub-row-1',
    restaurantId: 77,
    preapprovalId: 'preapproval-123',
    externalReference: '77',
    status: 'pending',
    payerEmail: 'gm@example.com',
    nextPaymentDate: null,
    amount: '727.00',
    totalAmount: '727.00',
    billingStartsAt: null,
  });
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
    defaultSubscriptionRow,
    subscriptionRows: [defaultSubscriptionRow()] as Array<
      Record<string, unknown>
    >,
    restaurantStatus: 'canceled',
    // Restaurants row returned by select(). Extra columns are what the
    // conversion notification reads (and the trial end the downgrade guard
    // checks). The suite's clock is fixed at 2026-08-21.
    restaurantRow: {
      id: 77,
      name: 'Tacos del Centro',
      subscriptionStatus: 'canceled',
      billingProvider: null,
      contactName: 'Ana López',
      managerEmail: 'ana@example.com',
      managerPhone: '+52 55 1234 5678',
      city: 'Ciudad de México',
      shippingAddress: JSON.stringify({
        line1: 'Reforma 100',
        city: 'Ciudad de México',
        state: 'CDMX',
        postalCode: '06600',
      }),
      nfcCardsShippedAt: null,
      trialEndsAt: new Date('2026-09-15T00:00:00.000Z'),
    } as Record<string, unknown>,
    // Rows returned by the conditional "claim the first conversion" update.
    // Empty simulates a retry/renewal where another delivery already claimed it.
    claimedRows: [{ id: 77 }] as Array<{ id: number }>,
    getPreapproval: vi.fn(),
    getAuthorizedPayment: vi.fn(),
    // Contract: `true` when the notice went out, `false` when it did not.
    sendOwnerConversionNotification: vi.fn(async () => true),
    sendPurchaseEvent: vi.fn(async () => true),
    recordProductEvent: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/product-events', () => ({
  recordProductEvent: mocks.recordProductEvent,
}));

vi.mock('@/lib/email', () => ({
  sendOwnerConversionNotification: mocks.sendOwnerConversionNotification,
}));

vi.mock('@/lib/meta-conversions', () => ({
  sendPurchaseEvent: mocks.sendPurchaseEvent,
}));

vi.mock('@/db', () => ({
  db: {
    insert: mocks.dbInsert,
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === mercadopagoSubscriptions) {
              return mocks.subscriptionRows;
            }
            if (table === restaurants) {
              return [
                { ...mocks.restaurantRow, subscriptionStatus: mocks.restaurantStatus },
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
        const result = {
          returning: vi.fn(async () => mocks.claimedRows),
          then: (
            onFulfilled?: (value: undefined) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
        };
        return { where: vi.fn(() => result) };
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
  cancelPreapproval,
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

  it('returns the flat 700 price breakdown (processing fee absorbed)', () => {
    const breakdown = getPriceBreakdown();

    expect(breakdown).toEqual({
      base: 700,
      processingCharge: 0,
      tax: 0,
      total: 700,
    });
    expect(breakdown.tax).toBe(0);
  });

  it('sends frequency 12 months for an annual preapproval and 1 by default', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ id: 'pre-1', init_point: 'https://mp.test/pre-1', status: 'pending' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const base = {
      reason: 'RateTap Pro',
      externalReference: '77',
      payerEmail: 'gm@example.com',
      amount: 2490,
      backUrl: 'https://app.ratetapmx.com/settings',
    };

    await createPreapproval({ ...base, frequency: 12 });
    await createPreapproval({ ...base, amount: 299 });

    const bodyOf = (i: number) =>
      JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as {
        auto_recurring: { frequency: number; frequency_type: string; transaction_amount: number };
      };
    expect(bodyOf(0).auto_recurring).toMatchObject({
      frequency: 12,
      frequency_type: 'months',
      transaction_amount: 2490,
    });
    expect(bodyOf(1).auto_recurring).toMatchObject({ frequency: 1, frequency_type: 'months' });
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

  it('always sends auto_recurring.start_date when provided, even for a past first charge', async () => {
    // Dropping a past start_date would let Mercado Pago charge on its own
    // schedule instead of the trial end we display; the caller is
    // responsible for never passing a past date.
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
    expect(body.auto_recurring.start_date).toBe(BILLING_START_DATE.toISOString());
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

describe('cancelPreapproval strict verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function stubMpApi(opts: {
    cancel: Response;
    get?: Response | Error;
  }): { calls: Array<{ method: string; url: string }> } {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url: String(input) });
        if (method === 'PUT') return opts.cancel.clone();
        if (opts.get instanceof Error) throw opts.get;
        if (!opts.get) throw new Error('unexpected verification GET');
        return opts.get.clone();
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
  }

  it('resolves on an ok cancel response without a verification GET', async () => {
    const { calls } = stubMpApi({
      cancel: jsonResponse({ id: 'pre-1', status: 'cancelled' }),
    });

    await expect(cancelPreapproval('pre-1')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PUT');
  });

  it('tolerates a 404 cancel response without a verification GET', async () => {
    const { calls } = stubMpApi({
      cancel: jsonResponse({ message: 'not found' }, 404),
    });

    await expect(cancelPreapproval('pre-gone')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('tolerates a failed cancel when a GET verifies status=cancelled', async () => {
    stubMpApi({
      cancel: jsonResponse({ message: 'internal error' }, 500),
      get: jsonResponse({ id: 'pre-1', status: 'cancelled' }),
    });

    await expect(cancelPreapproval('pre-1')).resolves.toBeUndefined();
  });

  it('throws on a "cannot cancel" style error when the preapproval is still live', async () => {
    // The body mentions "cancel", which the old /cancel/i heuristic would
    // have wrongly tolerated; strict verification must reject it.
    stubMpApi({
      cancel: jsonResponse(
        { message: 'cannot cancel preapproval in its current status' },
        400,
      ),
      get: jsonResponse({ id: 'pre-1', status: 'authorized' }),
    });

    await expect(cancelPreapproval('pre-1')).rejects.toThrow(
      /cancelPreapproval failed \(400\)/,
    );
  });

  it('throws when the verification GET also fails', async () => {
    stubMpApi({
      cancel: jsonResponse({ message: 'internal error' }, 500),
      get: new Error('network down'),
    });

    await expect(cancelPreapproval('pre-1')).rejects.toThrow(
      /verification GET also failed/,
    );
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
    mocks.subscriptionRows = [mocks.defaultSubscriptionRow()];
    mocks.restaurantStatus = 'canceled';
    mocks.restaurantRow.nfcCardsShippedAt = null;
    mocks.restaurantRow.trialEndsAt = new Date('2026-09-15T00:00:00.000Z');
    mocks.claimedRows = [{ id: 77 }];
    mocks.dbInsert.mockClear();
    mocks.getPreapproval.mockReset();
    mocks.getAuthorizedPayment.mockReset();
    mocks.sendOwnerConversionNotification.mockReset();
    mocks.sendOwnerConversionNotification.mockResolvedValue(true);
    mocks.sendPurchaseEvent.mockReset();
    mocks.sendPurchaseEvent.mockResolvedValue(true);
    mocks.recordProductEvent.mockClear();
    mocks.restaurantRow.groupKey = null;
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

  describe('plan_activated (US-15)', () => {
    const authorizedPaymentPayload = {
      id: 'evt-activated-payment',
      type: 'subscription_authorized_payment',
      action: 'created',
      data: { id: 'authorized-payment-1' },
    };

    it('records plan_activated with the annual cycle from the preapproval frequency', async () => {
      mocks.getPreapproval.mockResolvedValue({
        id: 'preapproval-123',
        status: 'authorized',
        external_reference: '77',
        payer_email: 'gm@example.com',
        auto_recurring: { frequency: 12, frequency_type: 'months' },
      });

      await webhookPOST(webhookRequest(eventPayload));

      expect(mocks.recordProductEvent).toHaveBeenCalledTimes(1);
      expect(mocks.recordProductEvent).toHaveBeenCalledWith({
        name: 'plan_activated',
        restaurantId: 77,
        properties: { cycle: 'annual' },
      });
      // The status transition is exactly what it was before the event existed.
      expect(mocks.updatedRows.find((r) => r.table === restaurants)?.values).toEqual({
        subscriptionStatus: 'active',
        billingProvider: 'mercadopago',
      });
    });

    it('falls back to the charged amount for the cycle, and omits it when unknown', async () => {
      mocks.subscriptionRows = [{ ...mocks.defaultSubscriptionRow(), totalAmount: '299.00' }];
      await webhookPOST(webhookRequest(eventPayload));
      expect(mocks.recordProductEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ properties: { cycle: 'monthly' } }),
      );

      mocks.seenEventIds.clear();
      mocks.restaurantStatus = 'canceled';
      mocks.subscriptionRows = [mocks.defaultSubscriptionRow()]; // 727.00: neither plan price
      await webhookPOST(webhookRequest(eventPayload));
      expect(mocks.recordProductEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ properties: {} }),
      );
    });

    it('records it on the first approved payment too', async () => {
      mocks.getAuthorizedPayment.mockResolvedValue({
        id: 'authorized-payment-1',
        status: 'approved',
        preapproval_id: 'preapproval-123',
        payment: { id: 'payment-1', status: 'approved', transaction_amount: 727 },
      });

      await webhookPOST(webhookRequest(authorizedPaymentPayload));

      expect(mocks.recordProductEvent).toHaveBeenCalledTimes(1);
      expect(mocks.recordProductEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'plan_activated', restaurantId: 77 }),
      );
    });

    it('does not record it again when the restaurant is already active', async () => {
      mocks.restaurantStatus = 'active';

      await webhookPOST(webhookRequest(eventPayload));

      expect(mocks.recordProductEvent).not.toHaveBeenCalled();
    });

    it('does not record it for a rejected payment or a cancelled preapproval', async () => {
      mocks.getAuthorizedPayment.mockResolvedValue({
        id: 'authorized-payment-1',
        status: 'rejected',
        preapproval_id: 'preapproval-123',
        payment: { id: 'payment-1', status: 'rejected' },
      });
      await webhookPOST(webhookRequest(authorizedPaymentPayload));

      mocks.seenEventIds.clear();
      mocks.getPreapproval.mockResolvedValue({
        id: 'preapproval-123',
        status: 'cancelled',
        external_reference: '77',
      });
      await webhookPOST(webhookRequest(eventPayload));

      expect(mocks.recordProductEvent).not.toHaveBeenCalled();
    });

    it('stays out of the Grupo flow: the status flips as before and no Plan Restaurante event is written', async () => {
      mocks.restaurantRow.groupKey = 'grupo-estancia';

      await webhookPOST(webhookRequest(eventPayload));

      expect(mocks.recordProductEvent).not.toHaveBeenCalled();
      expect(mocks.updatedRows.find((r) => r.table === restaurants)?.values).toEqual({
        subscriptionStatus: 'active',
        billingProvider: 'mercadopago',
      });
    });
  });

  it('holds a cancelled preapproval at trialing while the restaurant own trial is still running', async () => {
    // Clock is 2026-08-21; the trial runs to 2026-09-15, so cancelling the
    // preapproval must not revoke the days the restaurant already has. It must
    // not leave the account 'active' either: expire-trials only expires
    // 'trialing' rows, so 'active' would be free access forever.
    mocks.restaurantStatus = 'active';
    mocks.subscriptionRows = [
      { ...mocks.defaultSubscriptionRow(), billingStartsAt: new Date('2026-09-15T00:00:00.000Z') },
    ];
    mocks.getPreapproval.mockResolvedValue({
      id: 'preapproval-123',
      status: 'cancelled',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: null,
    });

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(200);
    // Access kept for the rest of the trial, but handed back to expire-trials
    // (which only flips 'trialing'), so cancelling during the trial cannot buy
    // free access after it.
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants)?.values,
    ).toEqual({ subscriptionStatus: 'trialing' });
    expect(
      mocks.updatedRows.find((row) => row.table === mercadopagoSubscriptions)
        ?.values,
    ).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });

  it('holds a paused preapproval at trialing while the restaurant own trial is still running', async () => {
    mocks.restaurantStatus = 'active';
    mocks.subscriptionRows = [
      { ...mocks.defaultSubscriptionRow(), billingStartsAt: new Date('2026-09-15T00:00:00.000Z') },
    ];
    mocks.getPreapproval.mockResolvedValue({
      id: 'preapproval-123',
      status: 'paused',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: null,
    });

    const response = await webhookPOST(webhookRequest(eventPayload));

    expect(response.status).toBe(200);
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants)?.values,
    ).toEqual({ subscriptionStatus: 'trialing' });
    expect(
      mocks.updatedRows.find((row) => row.table === mercadopagoSubscriptions)
        ?.values,
    ).toEqual(expect.objectContaining({ status: 'paused' }));
  });

  it('leaves an already-trialing restaurant untouched when the preapproval is cancelled during the trial', async () => {
    mocks.restaurantStatus = 'trialing';
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
  });

  it('downgrades an active restaurant for a cancelled preapproval once its own trial has ended', async () => {
    // Trial ended 2026-08-06, i.e. before the 2026-08-21 clock: there is no
    // free access left to protect, so the cancellation must land.
    mocks.restaurantRow.trialEndsAt = new Date('2026-08-06T00:00:00.000Z');
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

  it('records a rejected authorized payment and holds the account at trialing before billing starts', async () => {
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
    // past_due is not applied mid-trial (the trial days are kept), but the
    // account must not stay 'active' either — that would never expire.
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants)?.values,
    ).toEqual({ subscriptionStatus: 'trialing' });
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

  it('ignores a cancellation event for an unknown/stale preapproval id', async () => {
    // Simulates a delayed cancellation webhook for an OLD (replaced)
    // preapproval: no row stores that preapprovalId, so nothing — not even
    // the restaurant status — may be touched, even though the event's
    // external_reference matches a restaurant.
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.restaurantStatus = 'active';
    mocks.subscriptionRows = [];
    mocks.getPreapproval.mockResolvedValue({
      id: 'stale-preapproval-old',
      status: 'cancelled',
      external_reference: '77',
      payer_email: 'gm@example.com',
      next_payment_date: null,
    });

    try {
      const response = await webhookPOST(
        webhookRequest({
          id: 'evt-stale-1',
          type: 'subscription_preapproval',
          action: 'updated',
          data: { id: 'stale-preapproval-old' },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(mocks.updatedRows).toHaveLength(0);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[mercadopago-webhook] event for unknown/stale preapproval stale-preapproval-old, ignoring',
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('ignores an authorized payment for an unknown/stale preapproval id', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.restaurantStatus = 'active';
    mocks.subscriptionRows = [];
    mocks.getAuthorizedPayment.mockResolvedValue({
      id: 'authorized-payment-stale',
      status: 'approved',
      preapproval_id: 'stale-preapproval-old',
      external_reference: '77',
      payment: { id: 'payment-stale', status: 'approved' },
    });

    try {
      const response = await webhookPOST(
        webhookRequest({
          id: 'evt-stale-payment-1',
          type: 'subscription_authorized_payment',
          action: 'created',
          data: { id: 'authorized-payment-stale' },
        }),
      );

      expect(response.status).toBe(200);
      expect(mocks.updatedRows).toHaveLength(0);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[mercadopago-webhook] event for unknown/stale preapproval stale-preapproval-old, ignoring',
      );
    } finally {
      consoleWarn.mockRestore();
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

  it('ships NFC cards and notifies the owner once on the first approved payment', async () => {
    mocks.getAuthorizedPayment.mockResolvedValue({
      id: 'authorized-payment-1',
      status: 'approved',
      preapproval_id: 'preapproval-123',
      external_reference: '77',
      transaction_amount: 727,
      payment: { id: 'payment-1', status: 'approved', transaction_amount: 727 },
    });

    const response = await webhookPOST(
      webhookRequest({
        id: 'evt-first-payment',
        type: 'subscription_authorized_payment',
        action: 'created',
        data: { id: 'authorized-payment-1' },
      }),
    );

    expect(response.status).toBe(200);

    // Idempotent claim: nfc_cards_shipped_at is only set when it is still NULL.
    expect(mocks.updatedRows).toContainEqual({
      table: restaurants,
      values: { nfcCardsShippedAt: expect.any(Date) },
    });
    expect(mocks.updatedRows).toContainEqual({
      table: restaurants,
      values: expect.objectContaining({
        subscriptionStatus: 'active',
        billingProvider: 'mercadopago',
      }),
    });

    expect(mocks.sendOwnerConversionNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerConversionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantName: 'Tacos del Centro',
        email: 'ana@example.com',
        amountMxn: 727,
        shippingAddress: expect.objectContaining({ line1: 'Reforma 100' }),
      }),
    );
    expect(mocks.sendPurchaseEvent).toHaveBeenCalledTimes(1);
    expect(mocks.sendPurchaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@example.com',
        valueMxn: 727,
        // Deterministic id: the retry path below re-sends the same Purchase
        // event and Meta must drop the duplicate.
        eventId: 'mp_conversion_77',
      }),
    );
  });

  it('does not notify again when a retried approved payment finds the cards already claimed', async () => {
    mocks.getAuthorizedPayment.mockResolvedValue({
      id: 'authorized-payment-1',
      status: 'approved',
      preapproval_id: 'preapproval-123',
      external_reference: '77',
      transaction_amount: 727,
      payment: { id: 'payment-1', status: 'approved', transaction_amount: 727 },
    });

    const first = await webhookPOST(
      webhookRequest({
        id: 'evt-first-payment',
        type: 'subscription_authorized_payment',
        action: 'created',
        data: { id: 'authorized-payment-1' },
      }),
    );
    expect(first.status).toBe(200);
    expect(mocks.sendOwnerConversionNotification).toHaveBeenCalledTimes(1);

    // A retry that arrives with a NEW event id (so idempotency does not catch
    // it) updates zero rows because nfc_cards_shipped_at is no longer NULL.
    mocks.claimedRows = [];
    const retry = await webhookPOST(
      webhookRequest({
        id: 'evt-first-payment-retry',
        type: 'subscription_authorized_payment',
        action: 'updated',
        data: { id: 'authorized-payment-1' },
      }),
    );

    expect(retry.status).toBe(200);
    expect(mocks.sendOwnerConversionNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendPurchaseEvent).toHaveBeenCalledTimes(1);
  });

  it('does not ship cards for a rejected payment', async () => {
    mocks.restaurantStatus = 'active';
    mocks.getAuthorizedPayment.mockResolvedValue({
      id: 'authorized-payment-1',
      status: 'rejected',
      preapproval_id: 'preapproval-123',
      external_reference: '77',
      payment: { id: 'payment-1', status: 'rejected' },
    });

    const response = await webhookPOST(
      webhookRequest({
        id: 'evt-rejected-payment',
        type: 'subscription_authorized_payment',
        action: 'created',
        data: { id: 'authorized-payment-1' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendOwnerConversionNotification).not.toHaveBeenCalled();
    expect(mocks.sendPurchaseEvent).not.toHaveBeenCalled();
    // No ship claim; the only restaurant write is the trial hold.
    expect(
      mocks.updatedRows.some(
        (row) => row.table === restaurants && 'nfcCardsShippedAt' in row.values,
      ),
    ).toBe(false);
    expect(
      mocks.updatedRows.find((row) => row.table === restaurants)?.values,
    ).toEqual({ subscriptionStatus: 'trialing' });
  });

  const approvedPayment = {
    id: 'authorized-payment-1',
    status: 'approved',
    preapproval_id: 'preapproval-123',
    external_reference: '77',
    transaction_amount: 727,
    payment: { id: 'payment-1', status: 'approved', transaction_amount: 727 },
  };

  const approvedPayload = {
    id: 'evt-first-payment',
    type: 'subscription_authorized_payment',
    action: 'created',
    data: { id: 'authorized-payment-1' },
  };

  it('uses the same deterministic Meta Purchase event id on every claiming attempt', async () => {
    // Two deliveries both win the ship claim (the notice-retry path released it
    // in between) and carry DIFFERENT payment ids. Meta dedupes by event_id, so
    // both sends must carry the same per-restaurant id or the second one would
    // be counted as a second paid conversion.
    mocks.getAuthorizedPayment
      .mockResolvedValueOnce({ ...approvedPayment })
      .mockResolvedValueOnce({
        ...approvedPayment,
        id: 'authorized-payment-2',
        payment: { id: 'payment-2', status: 'approved', transaction_amount: 727 },
      });

    const first = await webhookPOST(webhookRequest(approvedPayload));
    const second = await webhookPOST(
      webhookRequest({ ...approvedPayload, id: 'evt-first-payment-retry' }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.sendPurchaseEvent).toHaveBeenCalledTimes(2);
    const eventIds = mocks.sendPurchaseEvent.mock.calls.map(
      (call) => (call as unknown as [{ eventId: string }])[0].eventId,
    );
    expect(eventIds).toEqual(['mp_conversion_77', 'mp_conversion_77']);
  });

  it('releases the ship claim when the owner conversion notice rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getAuthorizedPayment.mockResolvedValue({ ...approvedPayment });
    mocks.sendOwnerConversionNotification.mockRejectedValue(new Error('smtp down'));

    try {
      const response = await webhookPOST(webhookRequest(approvedPayload));

      expect(response.status).toBe(200);
      // Claimed first, so a concurrent delivery still cannot double-send...
      expect(mocks.updatedRows).toContainEqual({
        table: restaurants,
        values: { nfcCardsShippedAt: expect.any(Date) },
      });
      // ...then released, so the next approved payment retries the notice.
      expect(mocks.updatedRows).toContainEqual({
        table: restaurants,
        values: { nfcCardsShippedAt: null },
      });
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('conversion notice NOT sent'),
        expect.anything(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('releases the ship claim when the notice resolves to "not sent"', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getAuthorizedPayment.mockResolvedValue({ ...approvedPayment });
    mocks.sendOwnerConversionNotification.mockResolvedValue(false);

    try {
      const response = await webhookPOST(webhookRequest(approvedPayload));

      expect(response.status).toBe(200);
      expect(mocks.updatedRows).toContainEqual({
        table: restaurants,
        values: { nfcCardsShippedAt: null },
      });
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('conversion notice NOT sent'),
        expect.anything(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps the ship claim when only the Meta purchase event fails', async () => {
    mocks.getAuthorizedPayment.mockResolvedValue({ ...approvedPayment });
    mocks.sendPurchaseEvent.mockRejectedValue(new Error('meta down'));

    const response = await webhookPOST(webhookRequest(approvedPayload));

    expect(response.status).toBe(200);
    expect(mocks.sendOwnerConversionNotification).toHaveBeenCalledTimes(1);
    expect(mocks.updatedRows).toContainEqual({
      table: restaurants,
      values: { nfcCardsShippedAt: expect.any(Date) },
    });
    // The notice went out, so the claim stands: a failed ad-platform event is
    // not worth echoing a second paid conversion for.
    expect(
      mocks.updatedRows.some(
        (row) => row.table === restaurants && row.values.nfcCardsShippedAt === null,
      ),
    ).toBe(false);
  });
});
