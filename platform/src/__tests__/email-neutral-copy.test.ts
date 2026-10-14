import { beforeEach, describe, expect, it, vi } from 'vitest';

// SQ-228: digest, alert and welcome emails say "equipo" instead of "mesero"
// for a non-food business. Omitted / true keeps today's wording exactly.

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
}));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

import { sendFeedbackAlert, sendWeeklyDigest, sendWelcomeEmail } from '@/lib/email';

const lastHtml = () => mocks.sendMail.mock.calls[mocks.sendMail.mock.calls.length - 1][0].html;
// Visible words only: the layout's <style> block carries the shared .col-meseros class.
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

beforeEach(() => {
  mocks.sendMail.mockClear();
});

const digest = async (extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => {
  await sendWeeklyDigest({
    to: 'owner@example.com',
    restaurantName: 'Negocio Uno',
    lastWeek: { totalReviews: 5, avgRating: 4.6, googleSends: 3, intercepted: 0 },
    weekBefore: { totalReviews: 4, avgRating: 4.4, googleSends: 2, intercepted: 0 },
    unresolvedCount: 0,
    topPerformers: [{ staffName: 'Ana', avgRating: 4.8, reviewCount: 3 }],
    dashboardUrl: 'https://app.ratetapmx.com/dashboard',
    ...over,
    ...extra,
  });
  return lastHtml() as string;
};

describe('weekly digest leaderboard label', () => {
  it('non-food: "Top de tu equipo", no mesero wording', async () => {
    const html = await digest({ foodOrDrink: false });
    expect(html).toContain('Top de tu equipo');
    expect(visible(html)).not.toMatch(/meseros?/i);
  });

  it('non-food with no carded reviews: the empty state is neutral too', async () => {
    const html = await digest({ foodOrDrink: false }, { topPerformers: [] });
    expect(html).toContain('Top de tu equipo');
    expect(visible(html)).not.toMatch(/meseros?/i);
  });

  it('food, true or omitted: today\'s label', async () => {
    for (const extra of [{}, { foodOrDrink: true }]) {
      const html = await digest(extra);
      expect(html).toContain('Top meseros por experiencia del cliente');
      expect(html).not.toContain('Top de tu equipo');
    }
  });
});

describe('feedback alert staff label', () => {
  const alert = async (extra: Record<string, unknown> = {}) => {
    await sendFeedbackAlert({
      to: 'owner@example.com',
      reviewId: 1,
      restaurantName: 'Negocio Uno',
      customerName: null,
      customerEmail: null,
      rating: 2,
      staffName: 'Ana',
      feedback: 'Tardaron mucho',
      ...extra,
    });
    return lastHtml() as string;
  };

  it('non-food: "Equipo"', async () => {
    const html = await alert({ foodOrDrink: false });
    expect(html).toContain('>Equipo</span>');
    expect(html).not.toContain('>Mesero</span>');
  });

  it('food, true or omitted: "Mesero"', async () => {
    for (const extra of [{}, { foodOrDrink: true }]) {
      const html = await alert(extra);
      expect(html).toContain('>Mesero</span>');
      expect(html).not.toContain('>Equipo</span>');
    }
  });
});

describe('welcome email team steps', () => {
  const welcome = async (extra: Record<string, unknown> = {}) => {
    await sendWelcomeEmail({
      to: 'owner@example.com',
      restaurantName: 'Negocio Uno',
      slug: 'negocio-uno',
      qrDataUrl: 'data:image/png;base64,AAAA',
      reviewUrl: 'https://app.ratetapmx.com/r/negocio-uno',
      trialEndsAt: new Date('2026-11-12T12:00:00Z'),
      trialDays: 30,
      ...extra,
    });
    return lastHtml() as string;
  };

  it('non-food team: "tu equipo" steps, no mesero wording', async () => {
    const html = await welcome({ teamMode: 'team', locationsBand: '1', foodOrDrink: false });
    expect(html).toContain('Agrega a tu equipo.');
    expect(html).toContain('Descarga el código QR de cada persona de tu equipo en');
    expect(visible(html)).not.toMatch(/mesero/i);
  });

  it('food, true or omitted: today\'s mesero steps', async () => {
    for (const extra of [{}, { foodOrDrink: true }]) {
      const html = await welcome({ teamMode: 'team', locationsBand: '1', ...extra });
      expect(html).toContain('Agrega a tus meseros.');
      expect(html).toContain('Descarga el código QR de cada mesero en');
    }
  });
});
