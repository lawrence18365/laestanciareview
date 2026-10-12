import { createHash } from 'node:crypto';
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
 * Each URL is versioned (`?v=<md5 prefix of the image>`), and the tag is only
 * trusted when it EQUALS the hash of the bytes we are about to serve: an
 * immutable cache entry for a stale `v` (an old tag kept in a bookmark, a
 * cached HTML page) would pin the wrong logo for a year. A mismatched or
 * missing `v` therefore gets the short, revalidating policy instead.
 */

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_SHORT = 'public, max-age=300, stale-while-revalidate=86400';

const notFound = () => new Response('Not found', { status: 404 });

/**
 * The same version tag the queries compute in Postgres
 * (`substr(md5(logo_data_url), 1, 8)`), computed here over the stored data URL
 * string. md5 is not a security primitive here, only a cache key, and it must
 * match Postgres' md5 exactly or every versioned URL would stop being cached.
 */
function logoVersion(logoDataUrl: string): string {
  return createHash('md5').update(logoDataUrl, 'utf8').digest('hex').slice(0, 8);
}

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

  // Only a `v` that matches this image's own tag may be cached forever; a
  // present-but-empty or stale `v` cannot prove the bytes never change.
  const version = req.nextUrl.searchParams.get('v');
  const versioned = version !== null && version === logoVersion(logoDataUrl);

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': versioned ? CACHE_IMMUTABLE : CACHE_SHORT,
    },
  });
}
