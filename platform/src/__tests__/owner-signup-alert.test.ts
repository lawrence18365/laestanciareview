import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
}));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

const base = {
  restaurantName: 'Tacos Ana',
  contactName: 'Ana',
  email: 'ana@example.com',
  phone: '+52 55 1234 5678',
  city: 'León',
  slug: 'tacos-ana',
};

describe('founder signup alert: Place ID', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('OWNER_NOTIFICATION_EMAIL', 'founders@example.com');
    mocks.sendMail.mockClear();
  });

  it('shows the Place ID when the signup has one', async () => {
    const { sendOwnerSignupNotification } = await import('@/lib/email');
    await sendOwnerSignupNotification({ ...base, googlePlaceId: 'ChIJabc' });
    const { subject, html } = mocks.sendMail.mock.calls[0][0];
    expect(subject).toBe('🎉 Nuevo signup: Tacos Ana');
    expect(html).toContain('<code>ChIJabc</code>');
    expect(html).not.toContain('SIN PLACE ID');
  });

  it('flags a missing Place ID in the subject and the body instead of omitting the row', async () => {
    const { sendOwnerSignupNotification } = await import('@/lib/email');
    await sendOwnerSignupNotification(base);
    const { subject, html } = mocks.sendMail.mock.calls[0][0];
    expect(subject).toBe('⚠️ Nuevo signup: Tacos Ana (sin Place ID)');
    expect(html).toContain('SIN PLACE ID');
  });
});
