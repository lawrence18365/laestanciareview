import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { mercadopagoSubscriptions, restaurants } from '@/db/schema';

const mocks = vi.hoisted(() => {
  const seenEventIds = new Set<string>();
  const updatedRows: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const dbInsert = vi.fn(() => ({
    values: vi.fn((values: { eventId: string }) => {
      if (seenEventIds.has(values.eventId)) {
        return Promise.reject(new Error('duplicate key value'));
      }
      seenEventIds.add(values.eventId);
      return Promise.resolve(undefined);
    }),
  }));
  return {
    seenEventIds,
    updatedRows,
    dbInsert,
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
              return [{ id: 77, subscriptionStatus: 'canceled', billingProvider: null }];
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
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', secret);
    mocks.seenEventIds.clear();
    mocks.updatedRows.length = 0;
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

  it('activates the restaurant on an authorized preapproval', async () => {
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
