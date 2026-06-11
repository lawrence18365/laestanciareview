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

/** Personal scoreboard URL for one staff member, e.g. /m/estancia-leon/K12. */
export function meseroUrlFor(slug: string, code: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
  return `${base}/m/${slug}/${encodeURIComponent(code)}`;
}

export async function generateMeseroQrDataUrl(slug: string, code: string): Promise<string> {
  return QRCode.toDataURL(meseroUrlFor(slug, code), {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 512,
    color: { dark: '#111111', light: '#FFFFFF' },
  });
}
