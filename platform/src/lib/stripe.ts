import Stripe from 'stripe';

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _client = new Stripe(key.trim(), { apiVersion: '2026-03-25.dahlia' });
  return _client;
}

export const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID ?? '').trim();
export const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
export const TRIAL_DAYS = 30;

// One-time NFC card + onboarding/setup fee, charged at checkout (today).
// STRIPE_SETUP_PRICE_ID must point at a one-time (not recurring) Price in Stripe
// for SETUP_FEE_MXN. The fee is collected up front in `payment` mode and the
// saved card is reused to start the 30-day-trial subscription in the webhook.
export const STRIPE_SETUP_PRICE_ID = (process.env.STRIPE_SETUP_PRICE_ID ?? '').trim();
export const SETUP_FEE_MXN = 1500;
