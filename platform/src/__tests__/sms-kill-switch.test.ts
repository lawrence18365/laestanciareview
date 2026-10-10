import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { send, select } = vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.TELNYX_API_KEY = 'test-telnyx-key';
  process.env.TELNYX_PHONE_NUMBER = '+520000000000';
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const k of ['from', 'where', 'orderBy', 'limit']) c[k] = () => c;
    c.then = (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej);
    return c;
  };
  return { send: vi.fn(), select: vi.fn(chain) };
});

vi.mock('telnyx', () => ({ default: class { messages = { create: send }; } }));
vi.mock('../db', () => ({
  db: { select, insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) })), update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })) },
}));
vi.mock('../lib/outreach-tracking', () => ({
  addDays: () => new Date(0),
  auditPath: (p: string) => `/audit/${p}`,
  ensureCommercialLeadForProspect: async () => ({ id: 'lead', status: 'new' }),
  logProspectOutreachEvent: async () => undefined,
}));
vi.mock('../lib/commercial-tracking', () => ({ trackCommercialEvent: async () => undefined }));

import { GET as prospectGET } from '../app/api/cron/prospect-outreach/route';
import { GET as auditGET } from '../app/api/cron/audit-followup/route';

const request = (path: string, auth = 'Bearer test-secret') =>
  new NextRequest(`https://example.test${path}`, { headers: { authorization: auth } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  send.mockReset();
  select.mockClear();
});

describe('prospect-outreach SMS kill switch', () => {
  it.each([undefined, '1', 'TRUE', 'false'])('returns disabled before discovery, DB or Telnyx when flag is %s', async (value) => {
    if (value === undefined) vi.stubEnv('PROSPECT_SMS_ENABLED', undefined as unknown as string);
    else vi.stubEnv('PROSPECT_SMS_ENABLED', value);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await prospectGET(request('/api/cron/prospect-outreach'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('still rejects an unauthenticated request when disabled', async () => {
    vi.stubEnv('PROSPECT_SMS_ENABLED', undefined as unknown as string);
    const response = await prospectGET(request('/api/cron/prospect-outreach', 'Bearer wrong'));
    expect(response.status).toBe(401);
  });

  it('runs the existing discovery path when flag is exactly true', async () => {
    vi.stubEnv('PROSPECT_SMS_ENABLED', 'true');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    vi.stubGlobal('fetch', fetchSpy);

    const response = await prospectGET(request('/api/cron/prospect-outreach'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ discovered: 0, queued: 0, sent: 0, failed: 0 });
    expect(fetchSpy).toHaveBeenCalled();
    expect(select).toHaveBeenCalled();
  });
});

describe('audit-followup SMS kill switch', () => {
  it.each([undefined, '1', 'TRUE', 'false'])('returns disabled before DB or Telnyx when flag is %s', async (value) => {
    if (value === undefined) vi.stubEnv('AUDIT_FOLLOWUP_SMS_ENABLED', undefined as unknown as string);
    else vi.stubEnv('AUDIT_FOLLOWUP_SMS_ENABLED', value);

    const response = await auditGET(request('/api/cron/audit-followup'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled' });
    expect(select).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('runs the existing follow-up path when flag is exactly true', async () => {
    vi.stubEnv('AUDIT_FOLLOWUP_SMS_ENABLED', 'true');

    const response = await auditGET(request('/api/cron/audit-followup'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0 });
    expect(select).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
