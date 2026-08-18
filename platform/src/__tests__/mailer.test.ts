import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { closeTransportMock, createTransportMock, transportSendMailMock } = vi.hoisted(() => ({
  closeTransportMock: vi.fn(),
  createTransportMock: vi.fn(),
  transportSendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

const mail = {
  from: 'RateTap <hello@ratetapmx.com>',
  to: 'recipient@example.com',
  subject: 'Test subject',
  html: '<p>Test</p>',
};

describe('sendMail', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('SMTP_PORT', '');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    vi.stubEnv('EMAIL_FROM', '');
    createTransportMock.mockReturnValue({
      close: closeTransportMock,
      sendMail: transportSendMailMock,
    });
    transportSendMailMock.mockResolvedValue({
      messageId: 'smtp-message-id',
      response: '250 Message accepted',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('strips literal \\n sequences from SMTP_HOST and SMTP_PASS', async () => {
    vi.stubEnv('SMTP_HOST', 'mail.spacemail.com\\n ');
    vi.stubEnv('SMTP_PORT', '465\\n');
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com\\n');
    vi.stubEnv('SMTP_PASS', 'secret-password\\n ');

    const { sendMail } = await import('@/lib/mailer');
    const result = await sendMail(mail);

    expect(result).toEqual({
      success: true,
      skipped: false,
      messageId: 'smtp-message-id',
      response: '250 Message accepted',
      error: null,
    });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'mail.spacemail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      maxRequeues: 1,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: {
        user: 'hello@ratetapmx.com',
        pass: 'secret-password',
      },
    });
  });

  it('warns once and no-ops when SMTP credentials are missing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sendMail } = await import('@/lib/mailer');

    const first = await sendMail(mail);
    const second = await sendMail(mail);

    expect(first).toEqual({
      success: false,
      skipped: true,
      messageId: null,
      response: null,
      error: null,
    });
    expect(second).toEqual(first);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      '[mailer] SMTP_USER or SMTP_PASS not set — skipping email',
    );
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(transportSendMailMock).not.toHaveBeenCalled();
  });

  it('preserves the display name while enforcing SMTP_USER as the sender', async () => {
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com');
    vi.stubEnv('SMTP_PASS', 'secret-password');

    const { sendMail } = await import('@/lib/mailer');
    await sendMail({
      ...mail,
      from: 'RateTap Sales <sales@ratetapmx.com>',
    });

    expect(transportSendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: {
        name: 'RateTap Sales',
        address: 'hello@ratetapmx.com',
      },
      replyTo: 'sales@ratetapmx.com',
      envelope: {
        from: 'hello@ratetapmx.com',
        to: 'recipient@example.com',
      },
    }));
  });

  it('preserves an explicit replyTo when the requested From address differs', async () => {
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com');
    vi.stubEnv('SMTP_PASS', 'secret-password');

    const { sendMail } = await import('@/lib/mailer');
    await sendMail({
      ...mail,
      from: 'RateTap Sales <sales@ratetapmx.com>',
      replyTo: 'owner@ratetapmx.com',
    });

    expect(transportSendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      replyTo: 'owner@ratetapmx.com',
    }));
  });

  it('cleans EMAIL_FROM when no explicit From address is supplied', async () => {
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com');
    vi.stubEnv('SMTP_PASS', 'secret-password');
    vi.stubEnv('EMAIL_FROM', 'RateTap Alerts <hello@ratetapmx.com>\\n ');

    const { sendMail } = await import('@/lib/mailer');
    await sendMail({
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
    });

    expect(transportSendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: {
        name: 'RateTap Alerts',
        address: 'hello@ratetapmx.com',
      },
    }));
  });

  it('logs SMTP failures with recipient, subject, response code, and command', async () => {
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com');
    vi.stubEnv('SMTP_PASS', 'secret-password');
    const failure = Object.assign(new Error('Authentication failed'), {
      code: 'EAUTH',
      responseCode: 535,
      command: 'AUTH LOGIN',
    });
    transportSendMailMock.mockRejectedValue(failure);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { sendMail } = await import('@/lib/mailer');
    const result = await sendMail(mail);

    expect(result.success).toBe(false);
    expect(errorLog).toHaveBeenCalledWith(
      '[mailer] SMTP send failed {"to":"recipient@example.com","subject":"Test subject","message":"Authentication failed","code":"EAUTH","responseCode":535,"command":"AUTH LOGIN"}',
    );
  });

  it('bounds the overall send and closes a pathological pooled transport', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SMTP_USER', 'hello@ratetapmx.com');
    vi.stubEnv('SMTP_PASS', 'secret-password');
    transportSendMailMock.mockReturnValue(new Promise(() => {}));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { sendMail } = await import('@/lib/mailer');
    const resultPromise = sendMail(mail);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({
      success: false,
      skipped: false,
      error: expect.objectContaining({
        code: 'ETIMEDOUT',
        command: 'SEND',
      }),
    }));
    expect(closeTransportMock).toHaveBeenCalledTimes(1);
  });
});
