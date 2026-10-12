import { NextRequest } from 'next/server';
import { getRestaurantLogoDataUrl } from '@/lib/queries';

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
 * The data URL is read with its own single-column query, so the ~280 KB image
 * never rides along with any other restaurant column.
 *
 * Each URL is versioned (`?v=<md5 prefix of the image>`). With a `v` the bytes
 * can never go stale for that URL, so the response is cached immutably; without
 * one (a hand-typed or legacy URL) it keeps the short policy and revalidates.
 */

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_SHORT = 'public, max-age=300, stale-while-revalidate=86400';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const logoDataUrl = await getRestaurantLogoDataUrl(slug);
  if (!logoDataUrl) return notFound();

  const match = DATA_URL_PATTERN.exec(logoDataUrl);
  if (!match) return notFound();

  const [, contentType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return notFound();

  // A present-but-empty `v` cannot version anything, so it is not treated as
  // one: only a real tag lets the bytes be cached forever for that URL.
  const version = req.nextUrl.searchParams.get('v');

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': version ? CACHE_IMMUTABLE : CACHE_SHORT,
    },
  });
}
