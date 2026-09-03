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

  const GUARANTEE =
    'Si en 30 días no tiene 30 reseñas nuevas en Google, le devolvemos la instalación.';

  it('touch 1 html body has zero style attributes in typed body divs', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    // Extract the typed body portion (everything before the designed footer table).
    const bodyPart = result.html.split('<table role="presentation"')[0];

    // The body wrapper and paragraph divs must not contain style attributes.
    const styledBodyDivs = bodyPart.match(/<div[^>]*style=/gi);
    expect(styledBodyDivs).toBeNull();

    expect(bodyPart).toContain('<div dir="ltr">');
    expect(bodyPart).toContain('<div>Soy Lawrence, cofundador de RateTap.');
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

    expect(result.text).toContain('Soy Lawrence, cofundador de RateTap.');
    expect(result.text).toContain('Le preparé una auditoría de La Estancia');
    expect(result.text).toContain('30 días gratis');
  });

  it('no em dash appears in any subject, text, or html for either kind and all touches', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    for (const kind of ['leon', 'group'] as const) {
      for (const touch of [1, 2, 3] as const) {
        const result = await buildOutreachEmail(makeProspect({ kind }), touch);
        expect(result.subject).not.toContain('—');
        expect(result.text).not.toContain('—');
        expect(result.html).not.toContain('—');
      }
    }
  });

  it('touch 1 includes the 30-day guarantee for both kinds', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    for (const kind of ['leon', 'group'] as const) {
      const result = await buildOutreachEmail(makeProspect({ kind }), 1);
      expect(result.text).toContain(GUARANTEE);
      expect(result.html).toContain(GUARANTEE);
    }
  });

  it('leon touch 1 asks the waiter question and keeps the audit link', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    expect(result.subject).toBe('¿Sabe cuál de sus meseros atiende mejor?');
    expect(result.html).toContain('https://app.ratetapmx.com/audit/ChIJ123');
  });

  it('group kind uses the multi-location copy and subjects', async () => {
    const { buildOutreachEmail } = await loadTemplates();

    const touch1 = await buildOutreachEmail(makeProspect({ kind: 'group' }), 1);
    expect(touch1.subject).toBe('¿Cuál de sus sucursales está pidiendo y cuál no?');
    expect(touch1.html).toContain('sucursales');
    expect(touch1.html).toContain('mesero por mesero');

    const touch2 = await buildOutreachEmail(makeProspect({ kind: 'group' }), 2);
    expect(touch2.subject).toBe('Re: ¿Cuál de sus sucursales está pidiendo y cuál no?');
    expect(touch2.text).toContain('63.7% de las reseñas');

    const touch3 = await buildOutreachEmail(makeProspect({ kind: 'group' }), 3);
    expect(touch3.subject).toBe('Último correo sobre La Estancia');
    expect(touch3.text).toContain('https://wa.me/');
  });

  it('touch 3 leaves the founder WhatsApp link for both kinds', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    for (const kind of ['leon', 'group'] as const) {
      const result = await buildOutreachEmail(makeProspect({ kind }), 3);
      expect(result.text).toContain('Este es el último correo que le envío.');
      expect(result.text).toContain('Le dejo mi WhatsApp: https://wa.me/5212228822360');
    }
  });

  it('footer contains unsubscribe URL and List-Unsubscribe header', async () => {
    const { buildOutreachEmail } = await loadTemplates();
    const result = await buildOutreachEmail(makeProspect(), 1);

    expect(result.headers['List-Unsubscribe']).toContain('/api/outreach/unsubscribe?id=1&token=');
    expect(result.html).toContain('/api/outreach/unsubscribe?id=1&amp;token=');
    expect(result.text).toContain('/api/outreach/unsubscribe?id=1&token=');
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
