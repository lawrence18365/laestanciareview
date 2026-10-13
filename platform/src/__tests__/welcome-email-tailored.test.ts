import { beforeEach, describe, expect, it, vi } from 'vitest';

// US-14 / SQ-195: the welcome email is tailored by team_mode. NULL / omitted
// team_mode must render today's email (guardrail: Grupo Estancia unchanged).

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
}));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

import { sendWelcomeEmail } from '@/lib/email';

const send = async (extra: Record<string, unknown> = {}) => {
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
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

const LEGACY_STEPS =
  'Agrega a tus meseros.</li>\n        <li>Descarga el código QR de cada mesero en <a href="https://app.ratetapmx.com/qr-codes"';

beforeEach(() => {
  mocks.sendMail.mockClear();
});

describe('welcome email by team_mode', () => {
  it('NULL / omitted team_mode renders the same email, with the two waiter steps', async () => {
    const omitted = await send();
    const explicit = await send({ teamMode: null, locationsBand: null, googleReviewCount: 48 });
    expect(explicit).toBe(omitted);
    expect(omitted).toContain(LEGACY_STEPS);
    expect(omitted).not.toMatch(/letrero|Agendemos|Tu meta|Hoy tienes/);
  });

  it('an unknown team_mode is treated as NULL, never solo', async () => {
    const html = await send({ teamMode: 'bogus', googleReviewCount: 10 });
    expect(html).toContain(LEGACY_STEPS);
    expect(html).not.toMatch(/letrero|Tu meta/);
  });

  it('solo: QR, letrero link and the ask, no waiter steps', async () => {
    const html = await send({ teamMode: 'solo', locationsBand: '1' });
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('/qr-codes/letrero');
    expect(text(html)).toContain('Imprime tu letrero');
    expect(text(html)).toContain('Pídele la reseña a tu próximo cliente.');
    expect(html).not.toContain('Agrega a tus meseros');
    expect(html).not.toContain('Agendemos');
  });

  it('team: today\'s two waiter steps, no call link', async () => {
    const html = await send({ teamMode: 'team', locationsBand: '2-5' });
    expect(html).toContain(LEGACY_STEPS);
    expect(html).not.toMatch(/letrero|Agendemos/);
  });

  it('6+: the team steps plus the call link to support WhatsApp', async () => {
    const html = await send({ teamMode: 'team', locationsBand: '6+' });
    expect(html).toContain(LEGACY_STEPS);
    expect(text(html)).toContain('Agendemos una llamada');
    expect(html).toMatch(/href="https:\/\/wa\.me\/\d+"[^>]*>Agendemos una llamada/);
  });

  it('adds the personal line with the real count and goal (count + 20)', async () => {
    const html = await send({ teamMode: 'solo', googleReviewCount: 48 });
    expect(text(html)).toContain('Hoy tienes 48 reseñas en Google. Tu meta: 68.');
    const team = await send({ teamMode: 'team', googleReviewCount: 0 });
    expect(text(team)).toContain('Hoy tienes 0 reseñas en Google. Tu meta: 20.');
  });

  it('omits the personal line when the count is unknown', async () => {
    for (const googleReviewCount of [null, undefined]) {
      const html = await send({ teamMode: 'solo', googleReviewCount });
      expect(text(html)).not.toMatch(/Hoy tienes|Tu meta/);
    }
  });

  it('keeps the added copy short: personal line and steps stay under 40 words', async () => {
    const full = await send({ teamMode: 'team', locationsBand: '6+', googleReviewCount: 120 });
    const base = await send();
    const extra = text(full).split(' ').length - text(base).split(' ').length;
    expect(extra).toBeLessThanOrEqual(15);
    const solo = await send({ teamMode: 'solo', googleReviewCount: 120 });
    expect(text(solo).split(' ').length - text(base).split(' ').length).toBeLessThanOrEqual(15);
  });
});
