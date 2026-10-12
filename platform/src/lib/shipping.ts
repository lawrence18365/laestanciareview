/**
 * Shipping address used by the "ship NFC cards" owner notification that fires
 * when a restaurant converts (first paid invoice/subscription payment).
 *
 * NFC cards only ship after conversion, and the address is optional when a
 * restaurant activates its trial, so this shape is shared by the Stripe and
 * Mercado Pago webhooks and always degrades to placeholders.
 */
export type OwnerConversionShipping = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  notes?: string;
};

const SHIPPING_KEYS = ['line1', 'line2', 'city', 'state', 'postalCode', 'notes'] as const;

/** Placeholder address used when a conversion has no shipping address on file. */
export function emptyShippingAddress(city?: string | null): OwnerConversionShipping {
  return { line1: '—', city: city ?? '—', state: '—', postalCode: '—' };
}

/**
 * Parse `restaurants.shipping_address` (JSON text, may be null/partial/hand-
 * edited). Only non-empty string fields override the placeholder, so a
 * half-filled address never produces an email with blanks in it.
 */
export function parseShippingAddress(
  raw: string | null | undefined,
  fallbackCity?: string | null,
): OwnerConversionShipping {
  const address = emptyShippingAddress(fallbackCity);
  if (!raw) return address;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return address;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return address;

  const record = parsed as Record<string, unknown>;
  for (const key of SHIPPING_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') address[key] = value;
  }
  return address;
}
