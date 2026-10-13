import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SQ-218: link-preview bots are flagged (not dropped) on review_page_open, the
 * device kind/os is derived from the UA with no raw UA stored, and trial:funnel
 * excludes bot rows.
 */

import { classifyUserAgent } from '@/lib/analytics-client';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('classifyUserAgent', () => {
  const cases: Array<[string, string | null | undefined, { device: string; os: string; bot: boolean }]> = [
    ['iPhone Safari', UA.iphone, { device: 'mobile', os: 'ios', bot: false }],
    ['iPad Safari', UA.ipad, { device: 'tablet', os: 'ios', bot: false }],
    ['Android phone', UA.androidPhone, { device: 'mobile', os: 'android', bot: false }],
    ['Android tablet (no Mobile token)', UA.androidTablet, { device: 'tablet', os: 'android', bot: false }],
    ['Mac desktop', UA.mac, { device: 'desktop', os: 'other', bot: false }],
    ['Windows desktop', UA.windows, { device: 'desktop', os: 'other', bot: false }],
    ['missing UA', null, { device: 'desktop', os: 'other', bot: false }],
    ['empty UA', '', { device: 'desktop', os: 'other', bot: false }],
    [
      'facebookexternalhit',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      { device: 'desktop', os: 'other', bot: true },
    ],
    ['Facebot', 'Facebot', { device: 'desktop', os: 'other', bot: true }],
    ['WhatsApp link preview', 'WhatsApp/2.23.20.0 A', { device: 'desktop', os: 'other', bot: true }],
    ['TelegramBot', 'TelegramBot (like TwitterBot)', { device: 'desktop', os: 'other', bot: true }],
    ['Twitterbot', 'Twitterbot/1.0', { device: 'desktop', os: 'other', bot: true }],
    ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', { device: 'desktop', os: 'other', bot: true }],
    ['LinkedInBot', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)', { device: 'desktop', os: 'other', bot: true }],
    [
      'Googlebot smartphone',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      { device: 'mobile', os: 'android', bot: true },
    ],
    ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', { device: 'desktop', os: 'other', bot: true }],
    ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', { device: 'desktop', os: 'other', bot: true }],
    ['generic crawler', 'AcmeCrawler/3.1', { device: 'desktop', os: 'other', bot: true }],
    ['generic spider', 'SomeSpider 1.0', { device: 'desktop', os: 'other', bot: true }],
    ['generic preview', 'LinkPreview/1.0', { device: 'desktop', os: 'other', bot: true }],
  ];

  it.each(cases)('%s', (_label, ua, expected) => {
    expect(classifyUserAgent(ua)).toEqual(expected);
  });
});

const pageMocks = vi.hoisted(() => ({
  ua: null as string | null,
  recordProductEvent: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(pageMocks.ua ? { 'user-agent': pageMocks.ua } : {}),
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: async () => ({ id: 7, slug: 'taqueria-uno', name: 'Taquería Uno' }),
  getStaffByCode: async () => null,
}));
vi.mock('@/lib/brands', () => ({ getBrandForRestaurant: () => ({ logo: '/x.png', darkBg: false }) }));
vi.mock('@/lib/product-events', () => ({ recordProductEvent: pageMocks.recordProductEvent }));
vi.mock('@/components/review/StarRating', () => ({ default: () => null }));

describe('review_page_open bot flag and device', () => {
  beforeEach(() => pageMocks.recordProductEvent.mockClear());

  async function open(ua: string | null) {
    pageMocks.ua = ua;
    const { default: ReviewPage } = await import('@/app/r/[slug]/page');
    await ReviewPage({
      params: Promise.resolve({ slug: 'taqueria-uno' }),
      searchParams: Promise.resolve({}),
    });
    return pageMocks.recordProductEvent.mock.calls[0][0] as { name: string; properties: Record<string, unknown> };
  }

  it('flags a WhatsApp link-preview request with bot=true and still records it', async () => {
    const event = await open('WhatsApp/2.23.20.0 A');
    expect(event.name).toBe('review_page_open');
    expect(event.properties.bot).toBe(true);
  });

  it('a real phone has device + os and no bot key', async () => {
    const event = await open(UA.iphone);
    expect(event.properties).toMatchObject({ device: 'mobile', os: 'ios' });
    expect('bot' in event.properties).toBe(false);
  });

  it('never stores the raw User-Agent', async () => {
    const event = await open(UA.androidPhone);
    expect(JSON.stringify(event)).not.toContain('Mozilla');
  });
});

describe('trial:funnel excludes bot rows', () => {
  const state = { queries: [] as string[], lines: [] as string[] };

  afterEach(() => vi.restoreAllMocks());

  it('every product_events count skips properties.bot = true and email opens/clicks are printed', async () => {
    vi.doMock('@neondatabase/serverless', () => ({
      neon: () => async (strings: TemplateStringsArray) => {
        const text = strings.join('?');
        state.queries.push(text);
        return text.includes('pending_signups')
          ? [{ slug: 'x', google: true, meseros: 0, calif: 0, pago: '-', estado: 'trial', aperturas: 2, clics: 0 }]
          : [{}];
      },
    }));
    vi.resetModules();
    process.env.DATABASE_URL = 'postgres://test';
    state.queries = [];
    state.lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void state.lines.push(a.join(' ')));
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    const oldArgv = process.argv;
    process.argv = ['node', 'trial-funnel.ts'];
    try {
      await import('../../scripts/trial-funnel');
      await vi.waitFor(() => expect(state.lines.join('\n')).toContain('Info: emails abiertos'));
    } finally {
      process.argv = oldArgv;
    }

    const eventQueries = state.queries.filter((q) => q.includes('from product_events'));
    expect(eventQueries.length).toBeGreaterThanOrEqual(3);
    for (const q of eventQueries.filter((q) => !q.includes('min(created_at)'))) {
      expect(q).toMatch(/properties->>'bot'/);
    }
    const mainQuery = state.queries.find((q) => q.includes('pending_signups'))!;
    expect(mainQuery).toMatch(/event_name = 'email_opened'[\s\S]*properties->>'bot'/);
    expect(mainQuery).toMatch(/event_name = 'email_clicked'/);
    expect(state.lines.join('\n')).toContain('emails abiertos 1 · con clic 0');
  });
});
