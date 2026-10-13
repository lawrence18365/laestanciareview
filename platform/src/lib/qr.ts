import QRCode from 'qrcode';

export function reviewUrlFor(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
  return `${base}/r/${slug}`;
}

export async function generateQrDataUrl(slug: string): Promise<string> {
  return QRCode.toDataURL(reviewUrlFor(slug), {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 512,
    color: { dark: '#111111', light: '#FFFFFF' },
  });
}

/** Vector QR for the restaurant's review page: stays sharp at any print size. */
export async function generateQrSvg(slug: string): Promise<string> {
  return QRCode.toString(reviewUrlFor(slug), {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
    color: { dark: '#111111', light: '#FFFFFF' },
  });
}

/** Personal scoreboard URL for one staff member, e.g. /m/estancia-leon/K12. */
export function meseroUrlFor(slug: string, code: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
  return `${base}/m/${slug}/${encodeURIComponent(code)}`;
}

/**
 * The exact URL a waiter's NFC card carries: the review page for the location
 * plus the waiter's card code. A guest who scans it lands on the same page with
 * the same attribution as a tap, so the QR is a stand-in for the card.
 */
export function cardUrlFor(slug: string, code: string): string {
  return `${reviewUrlFor(slug)}?card=${encodeURIComponent(code)}`;
}

export async function generateMeseroQrDataUrl(slug: string, code: string): Promise<string> {
  return QRCode.toDataURL(meseroUrlFor(slug, code), {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 512,
    color: { dark: '#111111', light: '#FFFFFF' },
  });
}
