import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../lib/chef-weekly-report', () => ({ runChefReport: run, deliveryFailed: (o: { status: string; previousStatus?: string }) => o.status !== 'sent' && !(o.status === 'skipped' && o.previousStatus === 'sent') }));
import { GET } from '../app/api/cron/chef-weekly-report/route';

const request = (auth = 'Bearer test-secret', query = '') => new NextRequest(`https://example.test/api/cron/chef-weekly-report${query}`, { headers: { authorization: auth } });
afterEach(() => { vi.unstubAllEnvs(); run.mockReset(); });

describe('chef weekly cron boundary', () => {
  it('configures daily 14 UTC sweep without changing the owner weekly schedule', () => {
    const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    expect(config.crons.find((c: { path: string }) => c.path === '/api/cron/chef-weekly-report').schedule).toBe('0 14 * * *');
    expect(config.crons.find((c: { path: string }) => c.path === '/api/cron/weekly-digest').schedule).toBe('0 14 * * 1');
  });
  it('keeps both sanitized partial outcomes visible and returns failure, not flawless success', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    run.mockResolvedValue({ status: 'completed', outcomes: [{ status: 'unknown', recipientHash: 'chef-hash', code: 'manual_check_no_retry' }, { status: 'sent', recipientHash: 'owner-hash' }] });
    const response = await GET(request()); expect(response.status).toBe(502);
    const body = await response.json(); expect(body.outcomes).toHaveLength(2);
    expect(body.outcomes.map((o: { status: string }) => o.status)).toEqual(['unknown', 'sent']);
    expect(JSON.stringify(body)).not.toContain('@');
  });
  it('requires configured secret and exact bearer auth before report execution', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request())).status).toBe(500);
    vi.stubEnv('CRON_SECRET', 'test-secret');
    for (const auth of ['', 'test-secret', 'Bearer wrong', 'Basic test-secret']) expect((await GET(request(auth))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects all query parameters: no public arbitrary weeks or recipient overrides', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    for (const query of ['?week-start=2026-09-21', '?to=someone', '?preview=true']) expect((await GET(request(undefined, query))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('reports disabled without inventing sends and calls live with no override', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret'); run.mockResolvedValue({ status: 'disabled', outcomes: [] });
    const response = await GET(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'disabled', outcomes: [] });
    expect(run).toHaveBeenCalledExactlyOnceWith({ mode: 'live' });
  });
  it('returns actionable failure for missing/invalid recipient or scope errors without raw PII', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    run.mockRejectedValue(new Error('SMTP raw guest@example.test private feedback'));
    const response = await GET(request()); expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('check_configuration_scope_and_delivery_ledger'); expect(body).not.toMatch(/guest@example|private feedback/);
  });
  it.each(['failed', 'unknown', 'attempted'])('returns 502 for %s delivery or uncertain prior reservation', async (status) => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    run.mockResolvedValue({ status: 'completed', window: { startDate: '2026-09-28' }, outcomes: [{ status: status === 'attempted' ? 'skipped' : status, previousStatus: status, recipientHash: 'hash', code: 'manual_check_no_retry' }] });
    const response = await GET(request()); expect(response.status).toBe(502);
    expect((await response.json()).outcomes[0].recipientHash).toBe('hash');
  });
  it('returns 200 only for confirmed sent or a previously sent fingerprint', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    run.mockResolvedValue({ status: 'completed', outcomes: [{ status: 'sent', recipientHash: 'hash' }, { status: 'skipped', previousStatus: 'sent', recipientHash: 'hash2' }] });
    expect((await GET(request())).status).toBe(200);
  });
});
