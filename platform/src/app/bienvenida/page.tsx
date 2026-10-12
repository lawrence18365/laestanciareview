import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import BienvenidaClient from './BienvenidaClient';
import { SIGNUP_ACCESS_COOKIE } from '@/lib/signup-access';
import { PILOT_TRIAL_DAYS } from '@/lib/pilot';
import { verifySession } from '@/lib/session';

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
  // The signup-access cookie is single-use: the status endpoint deletes it once
  // the account is ready. On a reload we fall back to the session it created.
  const session = await verifySession();
  const panelHref = session?.role === 'owner' || session?.role === 'regional' ? '/overview' : '/dashboard';
  // Passed from the server so the client component never imports lib/pilot
  // (which pulls in node:crypto and cannot be bundled for the browser).
  return (
    <BienvenidaClient
      hasSignupAccess={jar.has(SIGNUP_ACCESS_COOKIE)}
      sessionPanelHref={session ? panelHref : null}
      trialDays={PILOT_TRIAL_DAYS}
    />
  );
}
