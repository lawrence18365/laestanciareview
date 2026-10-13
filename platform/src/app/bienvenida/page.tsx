import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import BienvenidaClient, { type StatusResponse } from './BienvenidaClient';
import { goalQuestionFor, readyMode, readyProfileFields } from './ready-data';
import { SIGNUP_ACCESS_COOKIE } from '@/lib/signup-access';
import { PILOT_TRIAL_DAYS } from '@/lib/pilot';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { generateQrDataUrl, reviewUrlFor } from '@/lib/qr';
import { reviewUrlFor as googleReviewUrlFor } from '@/lib/google-review';

type BienvenidaPageProps = {
  searchParams: Promise<{ signup_id?: string | string[]; token?: string | string[] }>;
};

/**
 * Reload/revisit: the one-time signup cookie is gone, so the QR and the
 * tailored CTA are rebuilt from the session's restaurant. Returns null (the
 * short "tu cuenta ya está lista" card) for legacy restaurants, which keep
 * today's behavior exactly, and for anything that fails to load.
 */
async function loadReadyForSession(slug: string): Promise<StatusResponse | null> {
  try {
    const r = await getRestaurantBySlug(slug);
    if (!r) return null;
    const fields = readyProfileFields(r);
    if (readyMode(fields) === 'legacy') return null;
    return {
      ready: true,
      slug: r.slug,
      restaurantName: r.name,
      reviewUrl: reviewUrlFor(r.slug),
      qrDataUrl: await generateQrDataUrl(r.slug),
      googleConnected: googleReviewUrlFor(r) !== null,
      ...fields,
      ...goalQuestionFor(r),
    };
  } catch {
    return null;
  }
}

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
  const hasSignupAccess = jar.has(SIGNUP_ACCESS_COOKIE);
  // The signup-access cookie is single-use: the status endpoint deletes it once
  // the account is ready. On a reload we fall back to the session it created.
  const session = await verifySession();
  const panelHref = session?.role === 'owner' || session?.role === 'regional' ? '/overview' : '/dashboard';
  // Only a restaurant (gm) session maps to one restaurant's QR; owner and
  // regional sessions span several and keep the short card.
  const initialReady =
    !hasSignupAccess && session?.role === 'gm' ? await loadReadyForSession(session.slug) : null;
  // Passed from the server so the client component never imports lib/pilot
  // (which pulls in node:crypto and cannot be bundled for the browser).
  return (
    <BienvenidaClient
      hasSignupAccess={hasSignupAccess}
      sessionPanelHref={session ? panelHref : null}
      trialDays={PILOT_TRIAL_DAYS}
      initialReady={initialReady}
    />
  );
}
