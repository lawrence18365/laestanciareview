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
