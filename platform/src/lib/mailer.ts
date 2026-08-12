import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';

const DEFAULT_FROM = 'RateTap <hello@ratetapmx.com>';
const OVERALL_SEND_TIMEOUT_MS = 30_000;

/** Strip stray whitespace/newlines from env vars (Vercel CLI sometimes injects \n). */
const clean = (value: string | undefined, fallback: string) =>
  (value ?? fallback).replace(/\\n/g, '').trim();

export const FROM = clean(process.env.EMAIL_FROM, DEFAULT_FROM);

interface SendMailParams {
  from?: string;
  to: string | string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  replyTo?: string;
}

export interface MailerError {
  message: string;
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
}

export interface SendMailResult {
  success: boolean;
  skipped: boolean;
  messageId: string | null;
  response: string | null;
  error: MailerError | null;
}

interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  emailFrom: string;
}

let transport: Transporter<SMTPPool.SentMessageInfo, SMTPPool.Options> | null = null;
let warnedAboutMissingConfig = false;

function getConfig(): MailerConfig | null {
  const host = clean(process.env.SMTP_HOST, 'mail.spacemail.com');
  const portValue = Number.parseInt(clean(process.env.SMTP_PORT, '465'), 10);
  const port = Number.isFinite(portValue) ? portValue : 465;
  const user = clean(process.env.SMTP_USER, '');
  const pass = clean(process.env.SMTP_PASS, '');
  const emailFrom = clean(process.env.EMAIL_FROM, FROM);

  if (!user || !pass) {
    if (!warnedAboutMissingConfig) {
      console.warn('[mailer] SMTP_USER or SMTP_PASS not set — skipping email');
      warnedAboutMissingConfig = true;
    }
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    emailFrom,
  };
}

function parseMailbox(value: string): { name?: string; address: string } {
  const match = value.match(/^\s*(.*?)\s*<\s*([^<>]+)\s*>\s*$/);
  if (!match) return { address: value.trim() };

  const name = match[1].trim().replace(/^"(.*)"$/, '$1');
  return {
    ...(name ? { name } : {}),
    address: match[2].trim(),
  };
}

function normalizeError(error: unknown): MailerError {
  const details = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};

  return {
    message: error instanceof Error ? error.message : String(error),
    ...(typeof details.code === 'string' ? { code: details.code } : {}),
    ...(typeof details.responseCode === 'number' ? { responseCode: details.responseCode } : {}),
    ...(typeof details.response === 'string' ? { response: details.response } : {}),
    ...(typeof details.command === 'string' ? { command: details.command } : {}),
  };
}

function getTransport(config: MailerConfig) {
  if (!transport) {
    const options: SMTPPool.Options & { maxRequeues: number } = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      maxRequeues: 1,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    };
    transport = nodemailer.createTransport(options);
  }

  return transport;
}

export function closeMailer() {
  if (!transport) return;

  const activeTransport = transport;
  transport = null;
  try {
    activeTransport.close();
  } catch (error) {
    console.error(`[mailer] SMTP pool close failed ${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
    })}`);
  }
}

async function sendWithTimeout(
  activeTransport: Transporter<SMTPPool.SentMessageInfo, SMTPPool.Options>,
  options: Parameters<typeof activeTransport.sendMail>[0],
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      activeTransport.sendMail(options),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          closeMailer();
          reject(Object.assign(
            new Error(`SMTP send timed out after ${OVERALL_SEND_TIMEOUT_MS}ms`),
            { code: 'ETIMEDOUT', command: 'SEND' },
          ));
        }, OVERALL_SEND_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function sendMail({
  from,
  to,
  subject,
  html,
  headers,
  replyTo,
}: SendMailParams): Promise<SendMailResult> {
  const config = getConfig();
  if (!config) {
    return {
      success: false,
      skipped: true,
      messageId: null,
      response: null,
      error: null,
    };
  }

  const requestedFrom = parseMailbox(clean(from, config.emailFrom));
  const fromDiffers = requestedFrom.address.toLowerCase() !== config.user.toLowerCase();
  const enforcedFrom = requestedFrom.name
    ? { name: requestedFrom.name, address: config.user }
    : config.user;
  const explicitReplyTo = clean(replyTo, '') || undefined;
  const enforcedReplyTo = explicitReplyTo
    ?? (fromDiffers ? requestedFrom.address : undefined);

  try {
    const info = await sendWithTimeout(getTransport(config), {
      from: enforcedFrom,
      to,
      subject,
      html,
      headers,
      replyTo: enforcedReplyTo,
      envelope: {
        from: config.user,
        to: Array.isArray(to) ? to.join(', ') : to,
      },
    });

    return {
      success: true,
      skipped: false,
      messageId: info.messageId ?? null,
      response: typeof info.response === 'string' ? info.response : null,
      error: null,
    };
  } catch (error) {
    const normalizedError = normalizeError(error);
    console.error(`[mailer] SMTP send failed ${JSON.stringify({
      to,
      subject,
      message: normalizedError.message,
      ...(normalizedError.code ? { code: normalizedError.code } : {}),
      ...(normalizedError.responseCode != null
        ? { responseCode: normalizedError.responseCode }
        : {}),
      ...(normalizedError.command ? { command: normalizedError.command } : {}),
    })}`);
    return {
      success: false,
      skipped: false,
      messageId: null,
      response: normalizedError.response ?? null,
      error: normalizedError,
    };
  }
}
