import { NextRequest } from 'next/server';
import { getRestaurantBySlug } from '@/lib/queries';

/**
 * GET /api/logo/[slug] — a restaurant's uploaded logo, as bytes.
 *
 * Public on purpose: the same URL is used by the guest pages, the printed QR
 * sheets and the waiter cards, none of which carry a session (a guest tapping
 * an NFC card or scanning a QR is anonymous).
 *
 * The stored value is a data URL the settings PATCH already validated
 * (PNG/JPEG/WebP, <= 280 KB), so this route only has to decode it. Anything
 * that does not decode — a slug that is not a restaurant, a restaurant with no
 * logo, a legacy value — is a 404, never an error page: callers fall back to
 * the hardcoded brand logo themselves.
 *
 * Each URL is versioned (`?v=<hash>`), so the response can be cached and
 * revalidated in the background rather than re-fetched on every guest tap.
 */

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  const logoDataUrl = restaurant?.logoDataUrl ?? null;
  if (!logoDataUrl) return notFound();

  const match = DATA_URL_PATTERN.exec(logoDataUrl);
  if (!match) return notFound();

  const [, contentType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return notFound();

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  });
}
