import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackAlertReview } from '@/lib/feedback-alerts';

const mocks = vi.hoisted(() => ({
  sendFeedbackAlert: vi.fn(),
  sendSMSAlert: vi.fn(),
  sendWhatsAppAlert: vi.fn(),
  sendPushToRestaurant: vi.fn(),
  updatedValues: [] as Record<string, unknown>[],
  escalationAccounts: [] as Record<string, unknown>[],
}));

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => mocks.escalationAccounts),
      })),
    })),
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
    customerName: 'Cliente',
    customerEmail: 'cliente@example.com',
    feedback: 'La comida llegó fría',
    status: 'new',
    reviewedAt: null,
    resolvedAt: null,
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

describe('dispatchFeedbackAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedValues.length = 0;
    mocks.escalationAccounts = [];
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

  it('never calls WhatsApp by default even when the account flag is enabled', async () => {
    mocks.escalationAccounts = [{
      id: 99,
      isOwner: true,
      managerEmail: null,
      managerPhone: '+525500000099',
      alertPreference: 'all',
      whatsappAlerts: true,
      googleThreshold: 4,
    }];

    const result = await dispatchFeedbackAlerts(
      makeReview(),
      makeRestaurant({ whatsappAlerts: true }),
    );

    expect(mocks.sendWhatsAppAlert).not.toHaveBeenCalled();
    expect(result.channels.whatsapp).toEqual({ ok: false, skipped: 'disabled' });
    expect(result.channels.owner_whatsapp).toEqual({ ok: false, skipped: 'disabled' });
  });

  it('escalates a 2★ review to an owner on threshold preference and skips a 5★ review', async () => {
    const owner = {
      id: 99,
      isOwner: true,
      managerEmail: 'owner@example.com',
      managerPhone: null,
      alertPreference: 'threshold',
      whatsappAlerts: false,
      googleThreshold: 4,
    };
    mocks.escalationAccounts = [owner];
    const restaurant = makeRestaurant({ alertPreference: 'off', managerEmail: null, smsAlerts: false });

    const low = await dispatchFeedbackAlerts(makeReview({ rating: 2 }), restaurant);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeedbackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com', restaurantName: 'La Estancia Centro' }),
    );
    expect(low.channels.owner_email).toEqual({ ok: true });
    expect(low.anySuccess).toBe(true);

    vi.clearAllMocks();
    mocks.updatedValues.length = 0;

    const high = await dispatchFeedbackAlerts(makeReview({ rating: 5 }), restaurant);
    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(high.channels.owner_email).toEqual({ ok: false, skipped: 'preference' });
    expect(high.anySuccess).toBe(false);
  });

  it('records no_channel for an owner without email or phone', async () => {
    mocks.escalationAccounts = [{
      id: 99,
      isOwner: true,
      managerEmail: null,
      managerPhone: null,
      alertPreference: 'all',
      whatsappAlerts: true,
      googleThreshold: 4,
    }];
    const restaurant = makeRestaurant({ alertPreference: 'off' });

    const result = await dispatchFeedbackAlerts(makeReview({ rating: 1 }), restaurant);

    expect(mocks.sendFeedbackAlert).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppAlert).not.toHaveBeenCalled();
    expect(result.channels.owner_email).toEqual({ ok: false, skipped: 'no_channel' });
  });

  it('records owner_push success when at least one owner device is targeted', async () => {
    mocks.escalationAccounts = [{
      id: 99,
      isOwner: true,
      managerEmail: null,
      managerPhone: null,
      alertPreference: 'all',
      whatsappAlerts: false,
      googleThreshold: 4,
    }];

    const result = await dispatchFeedbackAlerts(
      makeReview({ feedback: 'x'.repeat(150) }),
      makeRestaurant({ alertPreference: 'off' }),
    );

    expect(result.channels.owner_push).toEqual({ ok: true });
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      99,
      {
        title: '⚠️ La Estancia Centro: 2 estrellas',
        body: `${'x'.repeat(99)}…`,
        url: '/overview',
        tag: 'review-42',
      },
      { kind: 'low_review', subjectType: 'review', subjectId: 42 },
    );
  });

  it('records owner_push no_devices when no owner device is targeted', async () => {
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 0, sent: 0, failed: 0 });
    mocks.escalationAccounts = [{
      id: 99,
      isOwner: true,
      managerEmail: 'owner@example.com',
      managerPhone: null,
      alertPreference: 'all',
      whatsappAlerts: false,
      googleThreshold: 4,
    }];

    const result = await dispatchFeedbackAlerts(
      makeReview(),
      makeRestaurant({ alertPreference: 'off' }),
    );

    expect(result.channels.owner_push).toEqual({ ok: false, skipped: 'no_devices' });
    expect(result.channels.owner_email).toEqual({ ok: true });
  });
});
