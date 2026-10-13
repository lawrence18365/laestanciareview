import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// US-15 / SQ-209: the free plan sees counts, never guest comment text or
// contact. Enforced on the server (the API route), and in the teaser emails.

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
  restaurant: {} as Record<string, unknown>,
  getRecentFeedback: vi.fn(),
  getFeedbackCounts: vi.fn(),
}));

vi.mock('@/lib/mailer', () => ({ FROM: 'RateTap <hello@test>', sendMail: mocks.sendMail }));
vi.mock('@/lib/session', () => ({
  verifySession: async () => ({ role: 'gm', slug: 'taqueria-uno' }),
}));
vi.mock('@/lib/queries', () => ({
  getGroupKeyBySlug: async () => null,
  getRestaurantBySlug: async () => mocks.restaurant,
  getLeaderboard: async () => [],
  getWeeklyStats: async () => ({}),
  getRecentFeedback: mocks.getRecentFeedback,
  getFeedbackCounts: mocks.getFeedbackCounts,
}));

import { GET } from '@/app/api/reviews/dashboard/route';
import {
  FREE_FEEDBACK_TEASER,
  freeWeeklyTeaserText,
  sendFeedbackTeaser,
  sendWeeklyDigestTeaser,
} from '@/lib/email';

const GUEST_ROW = {
  id: 7,
  rating: 1,
  customerName: 'María Fernández',
  customerEmail: 'maria.fernandez@example.com',
  feedback: 'El mesero fue grosero y la sopa llegó fría',
};

const words = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

function restaurant(over: Record<string, unknown>) {
  return { id: 1, name: 'Taquería Uno', slug: 'taqueria-uno', locationsBand: null, ...over };
}

const call = () =>
  GET(new NextRequest('http://localhost/api/reviews/dashboard?restaurant=taqueria-uno'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRecentFeedback.mockResolvedValue([GUEST_ROW]);
  mocks.getFeedbackCounts.mockResolvedValue({ total: 4, unread: 2 });
});

describe('dashboard API redacts guest comments for the free plan', () => {
  it('returns counts only, with no name, email or text, and never selects them', async () => {
    mocks.restaurant = restaurant({ subscriptionStatus: 'canceled', groupKey: null });

    const response = await call();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.feedbackLocked).toBe(true);
    expect(body.feedbackCounts).toEqual({ total: 4, unread: 2 });
    expect(body.recentFeedback).toEqual([]);
    expect(mocks.getRecentFeedback).not.toHaveBeenCalled();
    for (const secret of [GUEST_ROW.customerName, GUEST_ROW.customerEmail, GUEST_ROW.feedback, 'grosero']) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ['trial', { subscriptionStatus: 'trialing', groupKey: null }],
    ['paid', { subscriptionStatus: 'active', groupKey: null }],
    ['Grupo location, active', { subscriptionStatus: 'active', groupKey: 'grupo-estancia' }],
    ['Grupo location, lapsed (blocked, never redacted)', { subscriptionStatus: 'canceled', groupKey: 'grupo-estancia' }],
  ])('%s gets the full comments, unchanged', async (_label, over) => {
    mocks.restaurant = restaurant(over);

    const body = await (await call()).json();

    expect(body.recentFeedback).toEqual([GUEST_ROW]);
    expect(body).not.toHaveProperty('feedbackLocked');
    expect(mocks.getFeedbackCounts).not.toHaveBeenCalled();
  });
});

describe('free-plan teaser emails', () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
  });

  it('feedback teaser carries the fixed line and /plan, no guest field, and is short', async () => {
    await sendFeedbackTeaser({ to: 'gm@example.com', restaurantName: 'Taquería Uno' });

    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.html).toContain(FREE_FEEDBACK_TEASER);
    expect(mail.html).toContain('/plan');
    for (const secret of [GUEST_ROW.customerName, GUEST_ROW.customerEmail, GUEST_ROW.feedback, 'mailto:']) {
      expect(mail.html).not.toContain(secret);
      expect(mail.subject).not.toContain(secret);
    }
    expect(FREE_FEEDBACK_TEASER).toBe('Recibiste un comentario nuevo. Activa tu plan para verlo.');
    expect(words(mail.html)).toBeLessThanOrEqual(60);
  });

  it('weekly teaser says exactly the contract line and stays within 60 words', async () => {
    await sendWeeklyDigestTeaser({
      to: 'gm@example.com',
      restaurantName: 'Taquería Uno',
      ratings: 12,
      sentToGoogle: 7,
    });

    const mail = mocks.sendMail.mock.calls[0][0];
    expect(freeWeeklyTeaserText(12, 7)).toBe(
      'Esta semana: 12 calificaciones, 7 a Google. Activa tu plan para ver el detalle.',
    );
    expect(mail.html).toContain(freeWeeklyTeaserText(12, 7));
    expect(mail.html).toContain('/plan');
    expect(words(mail.html)).toBeLessThanOrEqual(60);
  });
});
