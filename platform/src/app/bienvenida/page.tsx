import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import BienvenidaClient from './BienvenidaClient';
import { SIGNUP_ACCESS_COOKIE } from '@/lib/signup-access';

type BienvenidaPageProps = {
  searchParams: Promise<{ signup_id?: string | string[]; token?: string | string[] }>;
};

export default async function BienvenidaPage({ searchParams }: BienvenidaPageProps) {
  const params = await searchParams;
  const signupId = Array.isArray(params.signup_id) ? params.signup_id[0] : params.signup_id;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (signupId || token) {
    const exchangeParams = new URLSearchParams();
    if (signupId) exchangeParams.set('signup_id', signupId);
    if (token) exchangeParams.set('token', token);
    redirect(`/api/signup/access?${exchangeParams.toString()}`);
  }

  const jar = await cookies();
  return <BienvenidaClient hasSignupAccess={jar.has(SIGNUP_ACCESS_COOKIE)} />;
}
