/**
 * (app)/inbox/page.tsx: the free plan gets counts, never comment text or guest
 * contact. The redaction happens on the server, before anything is rendered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  restaurant: {} as Record<string, unknown>,
  getAllFeedback: vi.fn(),
  getFeedbackCounts: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'mi-cocina', role: 'gm' })),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => mocks.restaurant),
  getAllFeedback: mocks.getAllFeedback,
  getFeedbackCounts: mocks.getFeedbackCounts,
}));
vi.mock('@/lib/complaint-sla', () => ({
  getComplaintSlaStats: vi.fn(async () => ({
    received: 0,
    reviewedWithin2h: 0,
    resolvedWithin24h: 0,
    overdueOpen: 0,
    avgHoursToReview: null,
    avgHoursToResolve: null,
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock('@/components/dashboard/FeedbackInbox', () => ({ default: () => null }));

import InboxPage from '@/app/(app)/inbox/page';
import FeedbackInbox from '@/components/dashboard/FeedbackInbox';

const ROW = {
  id: 7,
  rating: 1,
  customerName: 'María Fernández',
  customerEmail: 'maria.fernandez@example.com',
  feedback: 'El mesero fue grosero y la sopa llegó fría',
  staffName: 'Ana',
  staffCode: 'ANA1',
  status: 'new',
  resolution: null,
  createdAt: new Date('2026-10-01T12:00:00Z'),
};

function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((child) => elements(child, out));
  } else if (node && typeof node === 'object' && 'props' in node) {
    out.push(node);
    elements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

const textOf = (node: ReactNode): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : node && typeof node === 'object' && 'props' in node
        ? textOf((node.props as { children?: ReactNode }).children)
        : '';

async function render() {
  return (await InboxPage({ searchParams: Promise.resolve({}) })) as ReactElement;
}

function setRestaurant(subscriptionStatus: string, groupKey: string | null) {
  mocks.restaurant = { id: 77, slug: 'mi-cocina', subscriptionStatus, groupKey, locationsBand: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAllFeedback.mockResolvedValue([ROW]);
  mocks.getFeedbackCounts.mockResolvedValue({ total: 5, unread: 2 });
});

describe('inbox page by plan', () => {
  it('free: shows counts and a /plan link, never fetches or renders the comments', async () => {
    setRestaurant('canceled', null);

    const tree = await render();
    const all = elements(tree);

    expect(mocks.getAllFeedback).not.toHaveBeenCalled();
    expect(all.some((el) => el.type === FeedbackInbox)).toBe(false);
    const text = textOf(tree);
    expect(text).toContain('Comentarios bloqueados');
    expect(text.replace(/\s+/g, ' ')).toContain('Tienes 5 comentarios (2 nuevos). Activa tu plan para leerlos.');
    expect(all.some((el) => (el.props as { href?: string }).href === '/plan')).toBe(true);
    // Every rendered string and every plain prop of every element.
    const serialized = [
      text,
      ...all.flatMap((el) => Object.values(el.props as Record<string, unknown>)
        .filter((v) => typeof v === 'string' || typeof v === 'number')),
    ].join(' ');
    for (const secret of [ROW.customerName, ROW.customerEmail, ROW.feedback, 'grosero']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ['trial', 'trialing', null],
    ['paid', 'active', null],
    ['Grupo location', 'active', 'grupo-estancia'],
    ['Grupo location, lapsed (blocked, never redacted)', 'canceled', 'grupo-estancia'],
  ])('%s: the full inbox, unchanged', async (_label, status, groupKey) => {
    setRestaurant(status, groupKey);

    const inbox = elements(await render()).find((el) => el.type === FeedbackInbox);

    expect(mocks.getFeedbackCounts).not.toHaveBeenCalled();
    expect(inbox).toBeDefined();
    expect((inbox!.props as { initialFeedback: Array<{ feedback: string }> }).initialFeedback[0].feedback)
      .toBe(ROW.feedback);
  });
});
