import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('outreach email templates', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-outreach-templates';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.ratetapmx.com';
  });

  afterAll(() => {
    process.env.SESSION_SECRET = originalSecret;
    process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
  });

  async function loadTemplates() {
    const mod = await import('@/lib/outreach-templates');
    return mod;
  }

  function makeProspect(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1,
      name: 'La Estancia',
      email: 'test@example.com',
      kind: 'leon' as const,
      placeId: 'ChIJ123',
      phone: '+52 1 222 882 2360',
      city: 'León',
      rating: '4.2',
      sourceUrl: null,
      confidence: null,
      status: 'queued' as const,
      touchesSent: 0,
      lastTouchAt: null,
      nextTouchAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('touch 1 html body has zero style attributes in typed body divs', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    // Extract the typed body portion (everything before the designed footer table).
    const bodyPart = result.html.split('<table role="presentation"')[0];

    // The body wrapper and paragraph divs must not contain style attributes.
    const styledBodyDivs = bodyPart.match(/<div[^>]*style=/gi);
    expect(styledBodyDivs).toBeNull();

    expect(bodyPart).toContain('<div dir="ltr">');
    expect(bodyPart).toContain('<div>Soy Lawrence, de RateTap, aquí en León.</div>');
    expect(bodyPart).toContain('<div><br></div>');
  });

  it('touch 1 plain-text body has no hard-wrapped paragraphs', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    const lines = result.text.split('\n');
    const paragraphLines = lines.filter(
      (line) => line.trim() !== '' && !line.startsWith('-- ') && !line.startsWith('WEB ') && !line.startsWith('EMAIL ') && !line.startsWith('WHATSAPP ') && !line.startsWith('BASE ') && !line.startsWith('Lawrence ') && !line.startsWith('Convierte ') && !line.startsWith('Recibes '),
    );

    for (const line of paragraphLines) {
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/\n/);
    }

    expect(result.text).toContain('Soy Lawrence, de RateTap, aquí en León.');
    expect(result.text).toContain('Le preparé una auditoría de La Estancia');
    expect(result.text).toContain('30 días gratis');
  });

  it('footer contains unsubscribe URL and List-Unsubscribe header', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    expect(result.headers['List-Unsubscribe']).toContain('/api/outreach/unsubscribe?id=1&token=');
    expect(result.html).toContain('/api/outreach/unsubscribe?id=1&amp;token=');
    expect(result.text).toContain('/api/outreach/unsubscribe?id=1&token=');
  });

  it('group kind adapts copy and keeps audit link', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect({ kind: 'group' }), 1);

    expect(result.subject).toBe('Le preparé una auditoría de La Estancia');
    expect(result.html).toContain('grupo');
    expect(result.html).toContain('sucursales');
    expect(result.html).toContain('https://app.ratetapmx.com/audit/ChIJ123');
  });

  it('includes CID wordmark attachment', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].cid).toBe('ratetap-wordmark');
    expect(result.attachments[0].filename).toBe('ratetap-wordmark.png');
    expect(result.attachments[0].contentType).toBe('image/png');
    expect(result.html).toContain('cid:ratetap-wordmark');
  });
});
