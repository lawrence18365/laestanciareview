import type { Metadata } from 'next';
import ContactoForm from './ContactoForm';
import { cookies } from 'next/headers';

// Ad link scrapers (Meta) read these tags; without them the page exposes
// almost no server-rendered text and language detection fails.
export const metadata: Metadata = {
  title: 'Prueba RateTap 30 días gratis | Más reseñas en Google',
  description:
    'Tu cliente escanea tu QR y califica en 10 segundos. Activa tu restaurante hoy: 30 días gratis, sin tarjeta.',
  openGraph: {
    title: 'Prueba RateTap 30 días gratis',
    description: 'Más reseñas en Google, todos los días. 30 días gratis, sin tarjeta.',
    locale: 'es_MX',
    type: 'website',
    siteName: 'RateTap',
  },
};
import { redirect } from 'next/navigation';
import { isValidPilotAccessToken, PILOT_ACCESS_COOKIE } from '@/lib/pilot';

type ContactoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContactoPage({ searchParams }: ContactoPageProps) {
  const params = await searchParams;
  const { pilot } = params;
  const candidate = Array.isArray(pilot) ? pilot[0] : pilot;
  if (candidate) {
    const cleanParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'pilot' || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) cleanParams.append(key, item);
    }
    const cleanPath = `/contacto${cleanParams.size ? `?${cleanParams.toString()}` : ''}`;
    redirect(`/api/signup/pilot-access?pilot=${encodeURIComponent(candidate)}&return_to=${encodeURIComponent(cleanPath)}`);
  }

  const jar = await cookies();
  const accessToken = jar.get(PILOT_ACCESS_COOKIE)?.value;

  return <ContactoForm pilotOffer={isValidPilotAccessToken(accessToken)} />;
}
