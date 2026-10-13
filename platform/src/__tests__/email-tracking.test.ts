import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQ-218: signed open pixel + wrapped links for the welcome and trial-nurture
 * emails, and GET /api/email/t. Grupo digests/briefings stay untouched.
 */

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
  recordProductEvent: vi.fn(async (_input: unknown) => undefined),
}));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));
vi.mock('@/lib/product-events', () => ({ recordProductEvent: mocks.recordProductEvent }));

import { GET } from '@/app/api/email/t/route';
import { addEmailTracking, clickUrl, openPixelUrl } from '@/lib/email-tracking';
import { sendOwnerBriefing, sendWelcomeEmail } from '@/lib/email';
import { NextRequest } from 'next/server';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-for-email-tracking';
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

const request = (url: string, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148') =>
  new NextRequest(url, { headers: { 'user-agent': ua } });

const decode = (href: string) => href.replace(/&amp;/g, '&');

const welcome = async (extra: Record<string, unknown> = {}) => {
  mocks.sendMail.mockClear();
  await sendWelcomeEmail({
    to: 'owner@example.com',
    restaurantName: 'Taquería Uno',
    slug: 'taqueria-uno',
    qrDataUrl: 'data:image/png;base64,AAAA',
    reviewUrl: 'https://app.ratetapmx.com/r/taqueria-uno',
    trialEndsAt: new Date('2026-11-12T12:00:00Z'),
    trialDays: 30,
    ...extra,
  });
  return mocks.sendMail.mock.calls[0][0].html;
};

beforeEach(() => mocks.recordProductEvent.mockClear());

describe('welcome email tracking', () => {
  it('with a restaurant id: carries the pixel and wraps its links', async () => {
    const html = await welcome({ restaurantId: 7 });
    expect(html).toMatch(/<img src="https:\/\/app\.ratetapmx\.com\/api\/email\/t\?k=o&amp;t=welcome&amp;r=7&amp;s=[0-9a-f]{32}" width="1" height="1"/);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1] as string));
    const wrapped = hrefs.filter((h) => h.includes('/api/email/t?k=c'));
    expect(wrapped.length).toBeGreaterThanOrEqual(1);
    // The dashboard CTA goes through the tracker; the guest review link is left
    // as-is because owners forward it to diners (their taps aren't owner clicks).
    expect(wrapped.some((h) => h.includes('u=https://app.ratetapmx.com/dashboard'))).toBe(true);
    expect(wrapped.some((h) => h.includes('/r/taqueria-uno'))).toBe(false);
    expect(hrefs).toContain('https://app.ratetapmx.com/r/taqueria-uno');
    // The visible text of the review link is unchanged.
    expect(html).toContain('>https://app.ratetapmx.com/r/taqueria-uno</a>');
  });

  it('puts no guest PII in the URLs: restaurant id, template and signature only', async () => {
    const html = await welcome({ restaurantId: 7 });
    const trackers = [...html.matchAll(/(?:href|src)="([^"]*api\/email\/t[^"]*)"/g)].map((m) => decode(m[1] as string));
    expect(trackers.length).toBeGreaterThan(0);
    for (const t of trackers) {
      expect(t).not.toContain('owner@example.com');
      expect([...new URL(t).searchParams.keys()].every((k) => ['k', 't', 'r', 'u', 's'].includes(k))).toBe(true);
    }
  });

  it('without a restaurant id the email has no tracking at all', async () => {
    const html = await welcome();
    expect(html).not.toContain('/api/email/t');
  });

  it('is untouched when signing is unavailable (no SESSION_SECRET)', async () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      const html = await welcome({ restaurantId: 7 });
      expect(html).not.toContain('/api/email/t');
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});

describe('Grupo emails are unchanged', () => {
  it('the owner briefing never carries tracking', async () => {
    mocks.sendMail.mockClear();
    await sendOwnerBriefing({
      to: 'owner@example.com',
      weekStart: new Date('2026-10-05T06:00:00Z'),
      locations: [],
      dashboardUrl: 'https://app.ratetapmx.com/overview',
    });
    expect(mocks.sendMail.mock.calls[0][0].html).not.toContain('/api/email/t');
  });

  it('only the welcome email calls addEmailTracking inside email.ts', () => {
    const source = readFileSync(resolve(__dirname, '../lib/email.ts'), 'utf8');
    expect(source.match(/addEmailTracking\(/g)).toHaveLength(1);
    expect(source).toMatch(/addEmailTracking\(content, \{ template: 'welcome'/);
  });
});

describe('addEmailTracking', () => {
  it('wraps only allow-listed https links', async () => {
    const html = await addEmailTracking(
      '<a href="https://app.ratetapmx.com/staff">a</a><a href="https://evil.example/x">b</a><a href="https://wa.me/5214771234567">c</a>',
      { template: 'nurture_day1', restaurantId: 3 },
    );
    expect(html).toContain('href="https://evil.example/x"');
    expect(html.match(/api\/email\/t\?k=c/g)).toHaveLength(2);
    expect(html).toContain('t=nurture_day1');
  });
});

describe('GET /api/email/t', () => {
  it('open: validates the token, records email_opened with {template, restaurant_id} and returns a GIF', async () => {
    const res = await GET(request(await openPixelUrl('welcome', 7)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'email_opened',
        restaurantId: 7,
        properties: expect.objectContaining({ template: 'welcome', restaurant_id: 7, device: 'mobile', os: 'ios' }),
      }),
    );
    const props = (mocks.recordProductEvent.mock.calls[0][0] as { properties: Record<string, unknown> }).properties;
    expect('bot' in props).toBe(false);
  });

  it('open by a link scanner is recorded with bot=true', async () => {
    await GET(request(await openPixelUrl('welcome', 7), 'WhatsApp/2.23 A'));
    const props = (mocks.recordProductEvent.mock.calls[0][0] as { properties: Record<string, unknown> }).properties;
    expect(props.bot).toBe(true);
  });

  it('rejects a tampered signature, restaurant id or template and writes nothing', async () => {
    const good = new URL(await openPixelUrl('welcome', 7));
    const badSig = new URL(good);
    badSig.searchParams.set('s', '0'.repeat(32));
    const otherRestaurant = new URL(good);
    otherRestaurant.searchParams.set('r', '8');
    const otherTemplate = new URL(good);
    otherTemplate.searchParams.set('t', 'nurture_day1');
    const unsigned = new URL(good);
    unsigned.searchParams.delete('s');
    for (const u of [badSig, otherRestaurant, otherTemplate, unsigned]) {
      expect((await GET(request(u.toString()))).status).toBe(400);
    }
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('click: records email_clicked and redirects to allow-listed hosts', async () => {
    for (const target of [
      'https://app.ratetapmx.com/dashboard',
      'https://wa.me/5214771234567',
      'https://www.google.com/maps/place/x',
      'https://g.page/r/abc/review',
    ]) {
      mocks.recordProductEvent.mockClear();
      const res = await GET(request(await clickUrl('welcome', 7, target)));
      expect(res.status, target).toBe(302);
      expect(res.headers.get('location')).toBe(target);
      expect(mocks.recordProductEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'email_clicked', restaurantId: 7 }),
      );
    }
  });

  it('click: refuses a correctly signed link to a host off the allow-list (no open redirect)', async () => {
    for (const target of [
      'https://evil.example/phish',
      'https://app.ratetapmx.com.evil.example/',
      'https://google.com.evil.example/',
      'http://app.ratetapmx.com/dashboard',
      'https://user:pw@app.ratetapmx.com/',
      'javascript:alert(1)',
    ]) {
      const res = await GET(request(await clickUrl('welcome', 7, target)));
      expect(res.status, target).toBe(400);
    }
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it('click: a swapped target invalidates the signature', async () => {
    const url = new URL(await clickUrl('welcome', 7, 'https://app.ratetapmx.com/dashboard'));
    url.searchParams.set('u', 'https://wa.me/5210000000000');
    expect((await GET(request(url.toString()))).status).toBe(400);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });
});

describe('guest review links stay unwrapped', () => {
  it('does not wrap /r/{slug} links that owners forward to diners', async () => {
    process.env.SESSION_SECRET ??= 'test-session-secret-email-tracking-guest';
    const { addEmailTracking } = await import('@/lib/email-tracking');
    const html = '<a href="https://app.ratetapmx.com/r/tacos-ana">link</a><a href="https://app.ratetapmx.com/qr-codes">qr</a>';
    const out = await addEmailTracking(html, { template: 'hour1', restaurantId: 7 });
    expect(out).toContain('href="https://app.ratetapmx.com/r/tacos-ana"');
    expect(out).not.toContain('href="https://app.ratetapmx.com/qr-codes"');
  });
});
