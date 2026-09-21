import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackAlertReview } from '@/lib/feedback-alerts';

const mocks = vi.hoisted(() => ({
  sendFeedbackAlert: vi.fn(),
  sendSMSAlert: vi.fn(),
  sendWhatsAppAlert: vi.fn(),
  sendPushToRestaurant: vi.fn(),
  updatedValues: [] as Record<string, unknown>[],
  selectCalls: 0,
}));

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    // Nothing in this module may look up other accounts any more. The stub
    // records the call so a test can assert it never happens.
    select: vi.fn(() => {
      mocks.selectCalls++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
          limit: vi.fn(async () => []),
        })),
      };
    }),
  },
}));

vi.mock('@/lib/email', () => ({ sendFeedbackAlert: mocks.sendFeedbackAlert }));
vi.mock('@/lib/sms', () => ({ sendSMSAlert: mocks.sendSMSAlert }));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppAlert: mocks.sendWhatsAppAlert }));
vi.mock('@/lib/push', () => ({ sendPushToRestaurant: mocks.sendPushToRestaurant }));

import { dispatchFeedbackAlerts } from '@/lib/feedback-alerts';

function makeReview(overrides: Partial<FeedbackAlertReview> = {}): FeedbackAlertReview {
  return {
    id: 42,
    restaurantId: 7,
    staffId: null,
    staffCode: null,
    staffName: 'Ana',
    rating: 2,
    feedbackTokenHash: 'hash',
    deviceHash: null,
    customerName: 'Cliente',
    customerEmail: 'cliente@example.com',
    feedback: 'La comida llegó fría',
    status: 'new',
    reviewedAt: null,
    reviewedVia: null,
    resolvedAt: null,
    resolution: null,
    escalatedAt: null,
    sentToGoogle: false,
    alertSentAt: null,
    alertError: null,
    alertChannels: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRestaurant(overrides: Record<string, unknown> = {}) {
  return {
    name: 'La Estancia Centro',
    managerEmail: 'gm@example.com',
    managerPhone: '+525512345678',
    alertPreference: 'all',
    smsAlerts: true,
    whatsappAlerts: false,
    googleThreshold: 4,
    region: 'centro',
    ...overrides,
  } as Parameters<typeof dispatchFeedbackAlerts>[1];
}

const emailSuccess = {
  success: true,
  skipped: false,
  messageId: 'msg-1',
  response: null,
  error: null,
};

/** Channel keys that must never appear: escalation is complaint-sla's job. */
function escalationChannelKeys(channels: Record<string, unknown>): string[] {
  return Object.keys(channels).filter(
    (key) => key.startsWith('owner') || key.startsWith('regional'),
  );
}

describe('dispatchFeedbackAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedValues.length = 0;
    mocks.selectCalls = 0;
    delete process.env.SMS_ALERTS_ENABLED;
    delete process.env.WHATSAPP_ALERTS_ENABLED;
    mocks.sendFeedbackAlert.mockResolvedValue(emailSuccess);
    mocks.sendSMSAlert.mockResolvedValue(undefined);
    mocks.sendWhatsAppAlert.mockResolvedValue(undefined);
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 1, sent: 1, failed: 0 });
  });

  it('never calls Telnyx when SMS_ALERTS_ENABLED is unset and still marks alertSentAt when email succeeds', async () => {
    const result = await dispatchFeedbackAlerts(makeReview(), makeRestaurant());

    expect(mocks.sendSMSAlert).not.toHaveBeenCalled();
    expect(result.channels.sms).toEqual({ ok: false, skipped: 'disabled' });
    expect(result.channels.email).toEqual({ ok: true });
    expect(result.anySuccess).toBe(true);

    expect(mocks.updatedValues).toHaveLength(1);
    const written = mocks.updatedValues[0];
    expect(written.alertSentAt).toBeInstanceOf(Date);
    expect(written.alertError).toBeNull();
    expect(written.alertChannels).toMatchObject({
      sms: { ok: false, skipped: 'disabled' },
      email: { ok: true },
    });
  });

  it('records email failure without hiding a push success', async () => {
    mocks.sendFeedbackAlert.mockResolvedValue({
      success: false,
      skipped: false,
      messageId: null,
      response: null,
      error: { message: 'SMTP down' },
    });

    const result = await dispatchFeedbackAlerts(makeReview(), makeRestaurant());

    expect(result.anySuccess).toBe(true);
    expect(result.channels.push).toEqual({ ok: true });
    expect(result.channels.email).toEqual({ ok: false, error: 'SMTP down' });

    const written = mocks.updatedValues[0];
    expect(written.alertSentAt).toBeInstanceOf(Date);
    expect(written.alertError).toContain('email');
    expect(written.alertError).toContain('SMTP down');
    expect(written.alertError).not.toContain('push');
  });

  it('notifies the location account only and records the SLA handoff', async () => {
    const result = await dispatchFeedbackAlerts(makeReview(), makeRestaurant());

    // No owner/regional lookup, no owner/regional channel.
    expect(mocks.selectCalls).toBe(0);
    expect(escalationChannelKeys(result.channels)).toEqual([]);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledTimes(1);
    expect(mocks.sendPushToRestaurant.mock.calls[0][0]).toBe(7);
    expect(mocks.sendPushToRestaurant.mock.calls[0][1]).toMatchObject({
      rid: 42,
      url: '/inbox?rid=42',
    });
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert.mock.calls[0][0]).toMatchObject({
      to: 'gm@example.com',
      reviewId: 42,
    });

    // The row still shows what happened to the escalation branch.
    expect(result.channels.escalation).toEqual({ ok: false, skipped: 'deferred_to_sla' });
    expect(mocks.updatedValues[0].alertChannels).toMatchObject({
      escalation: { ok: false, skipped: 'deferred_to_sla' },
    });
    // A skip is not a failure.
    expect(mocks.updatedValues[0].alertError).toBeNull();
  });

  it('notifies the GM of a 5★ complaint at a threshold=5 unit, where the star count alone would filter it out', async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview({
        id: 5,
        rating: 5,
        feedback: 'La sopa no tenía sabor, deberían cuidar la calidad.',
      }),
      makeRestaurant({ alertPreference: 'threshold', googleThreshold: 5 }),
    );

    expect(result.classification.actionable).toBe(true);
    expect(result.classification.severity).not.toBe('praise');

    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert.mock.calls[0][0]).toMatchObject({
      to: 'gm@example.com',
      severity: result.classification.severity,
    });
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: expect.not.stringContaining('positivo') }),
      expect.objectContaining({ kind: 'low_review' }),
    );
    expect(result.anySuccess).toBe(true);
  });

  it('still respects the preference for praise: a 5★ "Todo excelente" at a threshold=5 unit is not sent', async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview({ id: 6, rating: 5, feedback: 'Todo excelente, gracias' }),
      makeRestaurant({ alertPreference: 'threshold', googleThreshold: 5 }),
    );

    expect(result.classification.actionable).toBe(false);
    expect(mocks.sendPushToRestaurant).not.toHaveBeenCalled();
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSAlert).not.toHaveBeenCalled();
    expect(result.channels.push).toBeUndefined();
    expect(result.channels.email).toBeUndefined();
    expect(result.anySuccess).toBe(false);
    expect(result.channels.escalation).toEqual({ ok: false, skipped: 'deferred_to_sla' });
  });

  it("treats 'off' as absolute: an explicit opt-out is never overridden by actionability", async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview({ id: 7, rating: 2, feedback: 'La comida llegó fría y esperamos demasiado' }),
      makeRestaurant({ alertPreference: 'off' }),
    );

    expect(result.classification.actionable).toBe(true);
    expect(mocks.sendPushToRestaurant).not.toHaveBeenCalled();
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSAlert).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppAlert).not.toHaveBeenCalled();
    expect(result.anySuccess).toBe(false);

    // The row still records the handoff and the silence.
    const written = mocks.updatedValues[0];
    expect(written.alertSentAt).toBeNull();
    expect(written.alertChannels).toMatchObject({
      escalation: { ok: false, skipped: 'deferred_to_sla' },
    });
  });

  it('never calls WhatsApp by default even when the account flag is enabled', async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview(),
      makeRestaurant({ whatsappAlerts: true }),
    );

    expect(mocks.sendWhatsAppAlert).not.toHaveBeenCalled();
    expect(result.channels.whatsapp).toEqual({ ok: false, skipped: 'disabled' });
    expect(escalationChannelKeys(result.channels)).toEqual([]);
  });

  it('records no_devices for the location push while the email still succeeds', async () => {
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 0, sent: 0, failed: 0 });

    const result = await dispatchFeedbackAlerts(makeReview(), makeRestaurant());

    expect(result.channels.push).toEqual({ ok: false, skipped: 'no_devices' });
    expect(result.channels.email).toEqual({ ok: true });
    expect(result.anySuccess).toBe(true);
  });
});

/**
 * What the GM is told about a review, derived from one classification.
 *
 * Anchored on Harbor's Angelopolis #28768 (16 sep 2026): the GM's push said
 * "⭐ Comentario positivo de 4 estrellas" with kind positive_review while the
 * owner and regional manager got "⚠️ … 4 estrellas" with kind low_review.
 * Owner/regional recipients are no longer alerted from this module at all, so
 * these cases pin the GM's own view — and the earlier "every recipient agrees"
 * assertions became "there is exactly one recipient, and it is the GM".
 */
describe('the GM is told one consistent story about the review', () => {
  // This describe is a sibling of the one above, so it needs its own setup —
  // beforeEach does not cross describe boundaries.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedValues.length = 0;
    mocks.selectCalls = 0;
    delete process.env.SMS_ALERTS_ENABLED;
    delete process.env.WHATSAPP_ALERTS_ENABLED;
    mocks.sendFeedbackAlert.mockResolvedValue(emailSuccess);
    mocks.sendSMSAlert.mockResolvedValue(undefined);
    mocks.sendWhatsAppAlert.mockResolvedValue(undefined);
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 1, sent: 1, failed: 0 });
  });

  const REVIEW_28768 =
    'Pedimos la sopa de mariscos y estaba realmente mala, no tenía sabor, creo que si debería cuidar más la calidad de los alimentos \nEl servicio excelente! ';

  /** Every push title/kind pair produced during a dispatch. */
  function pushCalls() {
    return mocks.sendPushToRestaurant.mock.calls.map(([restaurantId, payload, meta]) => ({
      restaurantId: restaurantId as number,
      title: (payload as { title: string }).title,
      kind: (meta as { kind: string }).kind,
    }));
  }

  it('#28768 reaches the GM as actionable, not as a positive comment', async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview({ id: 28768, restaurantId: 9, rating: 4, feedback: REVIEW_28768 }),
      makeRestaurant({ name: "Harbor's Angelopolis", alertPreference: 'threshold', googleThreshold: 5 }),
    );

    expect(result.classification.severity).toBe('mixed');
    expect(result.classification.actionable).toBe(true);

    const gmPush = pushCalls().find((call) => call.restaurantId === 9);
    expect(gmPush).toBeDefined();
    expect(gmPush!.title).not.toContain('positivo');
    expect(gmPush!.kind).toBe('low_review');
  });

  it('#28768 is delivered to the GM and to nobody else', async () => {
    await dispatchFeedbackAlerts(
      makeReview({ id: 28768, restaurantId: 9, rating: 4, feedback: REVIEW_28768 }),
      makeRestaurant({ name: "Harbor's Angelopolis", alertPreference: 'threshold', googleThreshold: 5 }),
    );

    const calls = pushCalls();
    expect(calls.map((c) => c.restaurantId)).toEqual([9]);
    expect(new Set(calls.map((c) => c.kind))).toEqual(new Set(['low_review']));
    expect(new Set(calls.map((c) => c.title.includes('positivo')))).toEqual(new Set([false]));

    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert.mock.calls[0][0]).toMatchObject({ to: 'gm@example.com' });
    expect(mocks.selectCalls).toBe(0);
  });

  it('passes the shared severity to the GM alert email', async () => {
    await dispatchFeedbackAlerts(
      makeReview({ id: 28768, restaurantId: 9, rating: 4, feedback: REVIEW_28768 }),
      makeRestaurant({ name: "Harbor's Angelopolis", alertPreference: 'threshold', googleThreshold: 5 }),
    );

    const severities = mocks.sendFeedbackAlert.mock.calls.map(
      ([params]) => (params as { severity?: string }).severity,
    );
    expect(severities.length).toBeGreaterThanOrEqual(1);
    expect(new Set(severities)).toEqual(new Set(['mixed']));
  });

  it('a genuinely positive 4-star still reads as positive to the GM', async () => {
    const result = await dispatchFeedbackAlerts(
      makeReview({ id: 1, restaurantId: 9, rating: 4, feedback: 'Todo bien, muy amables' }),
      makeRestaurant({ name: "Harbor's Angelopolis", alertPreference: 'all' }),
    );

    expect(result.classification.severity).toBe('praise');

    const calls = pushCalls();
    expect(new Set(calls.map((c) => c.kind))).toEqual(new Set(['positive_review']));
    expect(new Set(calls.map((c) => c.title.includes('positivo')))).toEqual(new Set([true]));
    expect(mocks.sendPushToRestaurant.mock.calls[0][1]).toMatchObject({ url: '/inbox' });
    expect(mocks.sendPushToRestaurant.mock.calls[0][1]).not.toHaveProperty('rid');
  });

  it.each([
    ['4-star clear complaint', 4, 'La comida estaba fría'],
    ['5-star complaint', 5, 'La sopa no tenía sabor'],
    ['3-star', 3, 'Estuvo regular'],
    ['1-star', 1, 'Pésimo servicio'],
    ['empty comment', 4, ''],
  ])('%s: the GM gets exactly one push whose polarity matches the classification', async (_label, rating, feedback) => {
    const result = await dispatchFeedbackAlerts(
      makeReview({ id: 5, restaurantId: 9, rating, feedback }),
      makeRestaurant({ name: "Harbor's Angelopolis", alertPreference: 'all' }),
    );

    const calls = pushCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].restaurantId).toBe(9);
    expect(calls[0].title.includes('positivo')).toBe(
      result.classification.severity === 'praise',
    );
    expect(calls[0].kind).toBe(
      result.classification.severity === 'praise' ? 'positive_review' : 'low_review',
    );
  });
});
