import ContactoForm from './ContactoForm';
import { cookies } from 'next/headers';
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
