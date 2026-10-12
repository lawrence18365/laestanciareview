/**
 * GET /api/cron/expire-trials — a trial lapse must never be silent.
 *
 * Every restaurant flipped to `canceled` gets one "Tu prueba terminó" email to
 * its manager (when it has one), and the founders get exactly ONE summary
 * alert listing all expired slugs. A mail failure never fails the cron.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-cron-secret';
  return {
    returningRows: [] as Array<Record<string, unknown>>,
    sendTrialEndedEmail: vi.fn(),
    sendFounderTrialsExpiredAlert: vi.fn(),
  };
});

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.returningRows),
        })),
      })),
    })),
  },
}));
vi.mock('@/lib/email', () => ({
  sendTrialEndedEmail: mocks.sendTrialEndedEmail,
  sendFounderTrialsExpiredAlert: mocks.sendFounderTrialsExpiredAlert,
}));

import { GET } from '@/app/api/cron/expire-trials/route';

function cronRequest(secret = 'test-cron-secret') {
  return new NextRequest('https://app.ratetapmx.com/api/cron/expire-trials', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  mocks.returningRows.length = 0;
  mocks.sendTrialEndedEmail.mockReset();
  mocks.sendTrialEndedEmail.mockResolvedValue(undefined);
  mocks.sendFounderTrialsExpiredAlert.mockReset();
  mocks.sendFounderTrialsExpiredAlert.mockResolvedValue(undefined);
});

describe('GET /api/cron/expire-trials notifications', () => {
  it('emails each expired owner and sends one founder alert listing every slug', async () => {
    mocks.returningRows.push(
      { id: 1, name: 'Taquería Uno', slug: 'taqueria-uno', managerEmail: 'uno@example.com' },
      { id: 2, name: 'Cocina Dos', slug: 'cocina-dos', managerEmail: 'dos@example.com' },
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.expired).toBe(2);
    expect(mocks.sendTrialEndedEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendTrialEndedEmail).toHaveBeenCalledWith({
      to: 'uno@example.com',
      restaurantName: 'Taquería Uno',
    });
    expect(mocks.sendTrialEndedEmail).toHaveBeenCalledWith({
      to: 'dos@example.com',
      restaurantName: 'Cocina Dos',
    });
    expect(mocks.sendFounderTrialsExpiredAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendFounderTrialsExpiredAlert).toHaveBeenCalledWith(['taqueria-uno', 'cocina-dos']);
  });

  it('skips the owner email when there is no manager email but still alerts the founders', async () => {
    mocks.returningRows.push({ id: 3, name: 'Sin Correo', slug: 'sin-correo', managerEmail: null });

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(mocks.sendTrialEndedEmail).not.toHaveBeenCalled();
    expect(mocks.sendFounderTrialsExpiredAlert).toHaveBeenCalledWith(['sin-correo']);
  });

  it('sends nothing when no trial expired', async () => {
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body.expired).toBe(0);
    expect(mocks.sendTrialEndedEmail).not.toHaveBeenCalled();
    expect(mocks.sendFounderTrialsExpiredAlert).not.toHaveBeenCalled();
  });

  it('does not fail the cron when a mail send throws, and keeps notifying the rest', async () => {
    mocks.returningRows.push(
      { id: 1, name: 'Uno', slug: 'uno', managerEmail: 'uno@example.com' },
      { id: 2, name: 'Dos', slug: 'dos', managerEmail: 'dos@example.com' },
    );
    mocks.sendTrialEndedEmail.mockRejectedValueOnce(new Error('smtp down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(mocks.sendTrialEndedEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendFounderTrialsExpiredAlert).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('rejects a wrong cron secret without sending anything', async () => {
    mocks.returningRows.push({ id: 1, name: 'Uno', slug: 'uno', managerEmail: 'uno@example.com' });

    const response = await GET(cronRequest('nope'));

    expect(response.status).toBe(401);
    expect(mocks.sendTrialEndedEmail).not.toHaveBeenCalled();
  });
});
