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
export const TRIAL_DAYS = 15;
