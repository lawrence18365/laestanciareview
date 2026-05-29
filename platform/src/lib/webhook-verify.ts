/**
 * Inbound webhook signature verification.
 *
 * Both of our inbound webhooks (Twilio WhatsApp, Telnyx SMS) drive
 * outbound work — Twilio's fires an Anthropic completion on every POST,
 * Telnyx's mutates prospect pipeline state. Without signature checks they
 * are open endpoints: anyone who learns the URL can burn API spend or
 * forge delivery/reply events. These verifiers fail CLOSED — if the
 * verifying secret is absent or the signature is wrong, the request is
 * rejected.
 */
import crypto from 'crypto';
import { TelnyxWebhook } from 'telnyx/webhooks';
import { timingSafeEqual } from './timing';

/**
 * Validate a Twilio request signature (X-Twilio-Signature).
 * Algorithm: HMAC-SHA1, base64, over the full request URL with every
 * POST param appended in alphabetical key order as `key + value`.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
  authToken: string | undefined;
}): boolean {
  const { signature, url, params, authToken } = opts;
  if (!signature || !authToken) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return timingSafeEqual(signature, expected);
}

/**
 * Verify a Telnyx Ed25519 webhook signature (with replay-window check).
 * Uses TELNYX_PUBLIC_KEY (base64, from Telnyx Mission Control).
 * `rawBody` MUST be the exact bytes received — parse JSON only after this passes.
 */
export async function verifyTelnyxSignature(
  rawBody: string,
  headers: Headers,
): Promise<boolean> {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKey) {
    console.error('[webhook] TELNYX_PUBLIC_KEY not configured — rejecting Telnyx webhook');
    return false;
  }

  try {
    const verifier = new TelnyxWebhook(publicKey);
    await verifier.verify(rawBody, Object.fromEntries(headers) as Record<string, string>);
    return true;
  } catch (err) {
    console.error('[webhook] Telnyx signature verification failed:', err);
    return false;
  }
}
