'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { SUPPORT_WHATSAPP_URL } from '@/lib/support';
import GooglePlaceSearch, { type PlaceSelection } from '@/components/GooglePlaceSearch';
import { track } from '@/lib/analytics-client';
import { t } from '@/lib/i18n';
import { QrFullscreenButton, whatsappCustomersHref } from '@/components/dashboard/QrShare';
import { goalOptions, qrPlacementTip, staffNoun, type SignupGoal } from '@/lib/onboarding-profile';
import { personalLine, readyMode, type GoalQuestion, type ReadyProfileFields } from './ready-data';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';

export interface StatusResponse extends Partial<ReadyProfileFields> {
  ready: boolean;
  slug?: string;
  restaurantName?: string;
  reviewUrl?: string;
  qrDataUrl?: string;
  trialEndsAt?: string;
  pilot?: boolean;
  googleConnected?: boolean;
  signupId?: string;
  /** Present only for a self-serve restaurant that has not answered yet. */
  goalQuestion?: GoalQuestion;
}

export default function BienvenidaClient({
  hasSignupAccess,
  sessionPanelHref,
  trialDays,
  initialReady = null,
}: {
  hasSignupAccess: boolean;
  /** Panel URL when a valid session exists (signup cookie already consumed), else null. */
  sessionPanelHref: string | null;
  trialDays: number;
  /**
   * Reload/revisit with a session: the ready payload loaded server-side from
   * the session's restaurant (the one-time cookie is gone). Only set for
   * restaurants with an onboarding profile; legacy ones keep the short screen.
   */
  initialReady?: StatusResponse | null;
}) {
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        if(location.hostname.endsWith('ratetapmx.com'))fbq('init', '${PIXEL_ID}'); fbq('track', 'PageView');
      `}</Script>
      <BienvenidaInner
        hasSignupAccess={hasSignupAccess}
        sessionPanelHref={sessionPanelHref}
        trialDays={trialDays}
        initialReady={initialReady}
      />
    </>
  );
}

function BienvenidaInner({
  hasSignupAccess,
  sessionPanelHref,
  trialDays,
  initialReady,
}: {
  hasSignupAccess: boolean;
  sessionPanelHref: string | null;
  trialDays: number;
  initialReady: StatusResponse | null;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pixelFiredRef = useRef(false);
  // Onboarding funnel: one event per step, per mount.
  const readyShownRef = useRef(false);
  const timedOutTrackedRef = useRef(false);

  // Step 1 of the onboarding screen: the account is ready.
  useEffect(() => {
    if (!status?.ready || readyShownRef.current) return;
    readyShownRef.current = true;
    track('onboarding_ready_shown', {
      google_connected: Boolean(status.googleConnected),
      pilot: Boolean(status.pilot),
    });
  }, [status?.ready, status?.googleConnected, status?.pilot]);

  // The 30s poll timeout fired: the account was not ready in time. This is the
  // only onboarding step the visitor reaches before the session cookie is set.
  useEffect(() => {
    if (!timedOut || timedOutTrackedRef.current) return;
    timedOutTrackedRef.current = true;
    track('onboarding_timed_out');
  }, [timedOut]);

  useEffect(() => {
    const signupId = status?.signupId;
    if (!status?.ready || pixelFiredRef.current || !signupId) return;
    const key = `rt_creg_fired:${signupId}`;
    try {
      if (sessionStorage.getItem(key)) { pixelFiredRef.current = true; return; }
      sessionStorage.setItem(key, '1');
    } catch { /* sessionStorage blocked — fall through */ }
    const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
    if (fbq) fbq('track', 'CompleteRegistration', { value: 0, currency: 'MXN' }, { eventID: signupId });
    const dl = (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
    if (Array.isArray(dl)) {
      dl.push({
        event: 'signup_completed',
        event_id: signupId,
        plan_type: status.pilot ? 'pilot' : 'trial',
        signup_method: status.pilot ? 'pilot_code' : 'self_serve',
      });
    }
    pixelFiredRef.current = true;
  }, [status?.ready, status?.pilot, status?.signupId]);

  useEffect(() => {
    if (!hasSignupAccess) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/signup/status');
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (data.ready) {
          // The ready response consumes the one-time signup cookie, so every
          // later poll would 400. Stop polling (and the timeout) once we have it.
          clearInterval(pollId);
          clearTimeout(timeoutId);
          setStatus(data);
          return;
        }
      } catch {
        /* swallow and retry */
      }
    }

    // Declared before the first poll() so poll can clear them on ready.
    const pollId = setInterval(poll, 2000);
    // Hard timeout: 30 seconds. Signup went through — provisioning is just slow.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setTimedOut(true);
    }, 30_000);
    poll();

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, [hasSignupAccess]);

  if (!hasSignupAccess && sessionPanelHref) {
    // Reload with a session: the same tailored ready screen (QR + CTA), loaded
    // server-side. Legacy restaurants get no initialReady and keep this card.
    if (initialReady?.ready) {
      return <Shell>
        <ReadyView status={initialReady} trialDays={trialDays} panelHref={sessionPanelHref} />
      </Shell>;
    }
    return <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
        <h1 style={h1Style}>Tu cuenta ya está lista</h1>
        <a
          href={sessionPanelHref}
          style={{ ...primaryButtonStyle, marginTop: '1.25rem' }}
          onClick={() => track('onboarding_cta_click', { target: 'panel' })}
        >
          Ir a mi panel →
        </a>
      </div>
    </Shell>;
  }

  if (!hasSignupAccess) {
    return <Shell>
      <h1 style={h1Style}>Falta información</h1>
      <p>No encontramos tu registro. <a href="/contacto" style={{ color: '#1c1917', fontWeight: 600 }}>Intenta de nuevo</a>.</p>
    </Shell>;
  }

  if (!status?.ready) {
    if (timedOut) {
      return <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✉️</div>
          <h1 style={h1Style}>Recibimos tu registro</h1>
          <p style={{ color: '#57534e', lineHeight: 1.6, marginBottom: '1.25rem' }}>
            Estamos terminando de activar tu cuenta — normalmente tarda menos de 5 minutos.
            Te enviamos un email con tu QR y el acceso a tu panel en cuanto esté lista.
          </p>
          <p style={{ color: '#a8a29e', fontSize: '0.8rem' }}>
            ¿No recibes el email? Revisa tu carpeta de spam o escríbenos por{' '}
            <a href={SUPPORT_WHATSAPP_URL} style={{ color: '#1c1917', fontWeight: 600 }}>WhatsApp</a>.
          </p>
        </div>
      </Shell>;
    }

    return <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48,
          height: 48,
          border: '3px solid #e7e5e4',
          borderTopColor: '#1c1917',
          borderRadius: '50%',
          margin: '0 auto 1rem',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <h1 style={h1Style}>Activando tu cuenta…</h1>
        <p style={{ color: '#57534e' }}>
          Estamos configurando tu panel. Esto tarda unos segundos.
        </p>
      </div>
    </Shell>;
  }

  return <Shell><ReadyView status={status} trialDays={trialDays} panelHref={null} /></Shell>;
}

/**
 * The "account ready" screen. Branches on the onboarding profile:
 * solo / team / group (6+) get a tailored header line and CTA; a restaurant
 * with no profile (legacy, incl. all of Grupo Estancia) gets today's screen.
 * Exported so the per-mode markup can be rendered in tests.
 */
export function ReadyView({
  status,
  trialDays,
  panelHref,
}: {
  status: StatusResponse;
  trialDays: number;
  /** Set on a reload: replaces the "use /login" footer with a panel link. */
  panelHref: string | null;
}) {
  const [googleConnected, setGoogleConnected] = useState(Boolean(status.googleConnected));
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeSaving, setPlaceSaving] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const googleSearchRef = useRef(false);
  const personalTrackedRef = useRef(false);

  const fields = {
    teamMode: status.teamMode ?? null,
    locationsBand: status.locationsBand ?? null,
    googleReviewCount: status.googleReviewCount ?? null,
    googleProfile: status.googleProfile ?? null,
  };
  const mode = readyMode(fields);
  const staffNeedsNoun = staffNoun(fields.googleProfile) === 'tu equipo';
  const line = mode === 'legacy' ? null : personalLine(fields);
  const reload = panelHref !== null;

  // Which pieces of the personal line showed. Once per mount, and not on a
  // reload (the funnel counts the first time the screen is seen).
  useEffect(() => {
    if (reload || personalTrackedRef.current || !line || line.pieces.length === 0) return;
    personalTrackedRef.current = true;
    track('onboarding_personal_line_shown', { mode, pieces: line.pieces });
  }, [reload, line, mode]);

  function handlePlaceQueryChange(value: string) {
    setPlaceQuery(value);
    if (!googleSearchRef.current && value.trim()) {
      googleSearchRef.current = true;
      track('onboarding_google_search');
    }
  }

  async function handlePlaceSelected(place: PlaceSelection) {
    if (!place.placeId || placeSaving) return;
    setPlaceSaving(true);
    setPlaceError('');
    try {
      // Same endpoint Settings uses; the server derives the review URL from the place ID.
      const res = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googlePlaceId: place.placeId }),
      });
      if (!res.ok) throw new Error('save-failed');
      setGoogleConnected(true);
      track('onboarding_google_saved');
    } catch {
      track('onboarding_google_save_failed');
      setPlaceError('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setPlaceSaving(false);
    }
  }

  // Click tracking: legacy keeps today's `{ target }`; tailored adds the mode.
  function clicked(target: string) {
    track('onboarding_cta_click', mode === 'legacy' ? { target } : { target, mode });
  }

  // Solo and team are the self-serve shapes: no printer needed for the first
  // step. Legacy (NULL team_mode, Grupo Estancia) and 6+ groups are unchanged.
  const selfServe = mode === 'solo' || mode === 'team';
  const restaurantName = status.restaurantName ?? '';
  const whatsappCustomersUrl = whatsappCustomersHref(restaurantName, status.reviewUrl ?? '');

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
        <h1 style={h1Style}>¡Listo, {status.restaurantName}!</h1>
        {mode === 'legacy' ? (
          <p style={{ color: '#57534e', marginBottom: '1.5rem' }}>
            Tu prueba gratis de {trialDays} días ya está activa. Usa este QR desde hoy.
          </p>
        ) : (
          <p style={{ color: '#57534e', marginBottom: '1.5rem' }}>
            {line && line.sentences.length > 0
              ? line.sentences.join(' ')
              : 'Usa este QR desde hoy.'}
          </p>
        )}
      </div>

      {status.goalQuestion && <GoalQuestionView teamMode={status.goalQuestion.teamMode} />}

      <div style={{
        textAlign: 'center',
        padding: '1.5rem',
        background: '#faf8f6',
        border: '1px solid #e7e5e4',
        marginBottom: '1.25rem',
      }}>
        {status.qrDataUrl && (
          <img
            src={status.qrDataUrl}
            alt="Tu código QR"
            style={{ width: 240, height: 240, display: 'block', margin: '0 auto 0.75rem', background: '#fff', padding: 8 }}
          />
        )}
        <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#78716c', marginBottom: 6 }}>
          Tu enlace
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, wordBreak: 'break-all', color: '#1c1917' }}>
          {status.reviewUrl}
        </div>
        {mode !== 'legacy' && (
          <p style={{ fontSize: '0.8rem', color: '#57534e', margin: '0.75rem 0 0' }}>
            {qrPlacementTip(fields.googleProfile, fields.teamMode)}
          </p>
        )}
      </div>

      {googleConnected ? (
        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#15803d', textAlign: 'center', margin: '0 0 1.25rem' }}>
          ✓ Google conectado
        </p>
      ) : (
        <div style={{ border: '1px solid #1c1917', padding: '1rem', marginBottom: '1.25rem' }}>
          <label
            htmlFor="bienvenida-place"
            style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, color: '#1c1917', marginBottom: 6 }}
          >
            Conecta tu restaurante en Google
          </label>
          <GooglePlaceSearch
            inputId="bienvenida-place"
            value={placeQuery}
            onChange={handlePlaceQueryChange}
            onSelect={handlePlaceSelected}
            placeholder="Escribe el nombre y elígelo"
            style={{
              width: '100%',
              padding: '0.65rem 0.75rem',
              border: '1px solid #d6d3d1',
              fontSize: '0.9rem',
              boxSizing: 'border-box',
            }}
          />
          {placeSaving && (
            <p style={{ fontSize: '0.8rem', color: '#78716c', margin: '0.4rem 0 0' }}>Guardando…</p>
          )}
          {placeError && (
            <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{placeError}</p>
          )}
        </div>
      )}

      {selfServe && (
        <>
          {status.qrDataUrl && (
            <QrFullscreenButton
              placement="bienvenida"
              restaurantName={restaurantName}
              qrSrc={status.qrDataUrl}
              style={primaryButtonOnButton}
            >
              {t.qrShare.showQr}
            </QrFullscreenButton>
          )}
          <a
            href={whatsappCustomersUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              clicked('whatsapp_share');
              track('whatsapp_share_clicked', { placement: 'bienvenida' });
            }}
            style={secondaryButtonStyle}
          >
            {t.qrShare.whatsapp}
          </a>
          <p style={{ fontSize: '0.8rem', color: '#57534e', textAlign: 'center', margin: '0.4rem 0 0' }}>
            {t.qrShare.whatsappHelper}
          </p>
          <p style={{ textAlign: 'center', margin: '0.9rem 0 0' }}>
            <a href="/qr-codes/letrero" style={textLinkStyle} onClick={() => clicked('letrero')}>
              {t.qrShare.printSign}
            </a>
          </p>
        </>
      )}

      {mode === 'team' && (
        <>
          <a href="/staff" onClick={() => clicked('staff')} style={{ ...secondaryButtonStyle, marginTop: '1.25rem' }}>
            {staffNeedsNoun ? 'Agrega a tu equipo →' : 'Agrega a tus meseros →'}
          </a>
          <p style={{ textAlign: 'center', margin: '0.75rem 0 0' }}>
            <a href="/qr-codes" onClick={() => clicked('qr')} style={textLinkStyle}>
              {staffNeedsNoun ? 'Descargar QR por persona' : 'Descargar QR por mesero'}
            </a>
          </p>
        </>
      )}

      {mode === 'group' && (
        <>
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={primaryButtonStyle}
            onClick={() => clicked('call')}
          >
            Agenda una llamada →
          </a>
          <a href="/staff" onClick={() => clicked('staff')} style={secondaryButtonStyle}>
            {staffNeedsNoun ? 'Agrega a tu equipo' : 'Agrega a tus meseros'}
          </a>
        </>
      )}

      {mode === 'legacy' && (
        <>
          <a href="/staff" style={primaryButtonStyle} onClick={() => clicked('staff')}>
            {staffNeedsNoun ? 'Agrega a tu equipo →' : 'Agrega a tus meseros →'}
          </a>
          <a href="/qr-codes" onClick={() => clicked('qr')} style={secondaryButtonStyle}>
            {staffNeedsNoun ? 'Descargar QR por persona' : 'Descargar QR por mesero'}
          </a>
        </>
      )}

      <p style={{ fontSize: '0.75rem', color: '#a8a29e', textAlign: 'center', marginTop: '1rem' }}>
        {reload ? (
          <a href={panelHref} style={{ color: '#1c1917', fontWeight: 600 }}>Ir a mi panel →</a>
        ) : (
          <>
            Para volver a entrar, usa tu contraseña en{' '}
            <a href="/login" style={{ color: '#1c1917', fontWeight: 600 }}>/login</a>.
          </>
        )}
      </p>
    </>
  );
}

/**
 * One optional, tap-only question. Tapping a chip saves it and swaps the chips
 * for "✓ Gracias"; it never blocks the CTAs, and a failed save just lets the
 * visitor tap again. The server stops offering it once answered.
 */
export function GoalQuestionView({ teamMode }: { teamMode: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');

  async function choose(goal: SignupGoal) {
    if (state !== 'idle') return;
    setState('saving');
    setError('');
    try {
      const res = await fetch('/api/onboarding/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      // 409 = already answered (another tab): same outcome for the visitor.
      if (!res.ok && res.status !== 409) throw new Error('save-failed');
      setState('done');
    } catch {
      setState('idle');
      setError('No se pudo guardar. Intenta de nuevo.');
    }
  }

  if (state === 'done') {
    return (
      <div style={{ marginBottom: '1.25rem' }}>
        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#15803d', textAlign: 'center', margin: '0 0 0.75rem' }}>
          ✓ Gracias
        </p>
        <ExpectationField />
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby="goal-question" style={{ marginBottom: '1.25rem' }}>
      <div id="goal-question" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1c1917', marginBottom: 8, textAlign: 'center' }}>
        ¿Qué quieres lograr?
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {goalOptions(teamMode).map(({ goal, label }) => (
          <button
            key={goal}
            type="button"
            disabled={state === 'saving'}
            onClick={() => choose(goal)}
            style={{
              minHeight: 44,
              padding: '0.5rem 0.9rem',
              border: '1px solid #1c1917',
              background: '#fff',
              color: '#1c1917',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', textAlign: 'center', margin: '0.5rem 0 0' }}>{error}</p>}
    </div>
  );
}

/**
 * Optional free text shown after a goal chip. One answer per restaurant: a
 * 409 (already answered in another tab) hides it, same as a successful save
 * ends it with "¡Gracias!".
 */
function ExpectationField() {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'hidden'>('idle');
  const [error, setError] = useState('');

  if (state === 'hidden') return null;
  if (state === 'saved') {
    return (
      <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#15803d', textAlign: 'center', margin: 0 }}>
        ¡Gracias!
      </p>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || state === 'saving') return;
    setState('saving');
    setError('');
    try {
      const res = await fetch('/api/onboarding/expectation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (res.status === 409) {
        setState('hidden');
        return;
      }
      if (!res.ok) throw new Error('save-failed');
      setState('saved');
    } catch {
      setState('idle');
      setError('No se pudo guardar. Intenta de nuevo.');
    }
  }

  return (
    <form onSubmit={send} style={{ maxWidth: 420, margin: '0 auto' }}>
      <label htmlFor="expectation-input" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#1c1917', marginBottom: 6, textAlign: 'center' }}>
        ¿Qué esperabas lograr? (opcional)
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="expectation-input"
          type="text"
          value={text}
          maxLength={280}
          placeholder="Ej. salir primero en Google Maps"
          disabled={state === 'saving'}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minHeight: 44, padding: '0.5rem 0.75rem', border: '1px solid #d6d3d1', fontSize: '0.9rem' }}
        />
        <button
          type="submit"
          disabled={state === 'saving' || text.trim().length === 0}
          style={{ minHeight: 44, padding: '0.5rem 0.9rem', border: '1px solid #1c1917', background: '#fff', color: '#1c1917', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Enviar
        </button>
      </div>
      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', textAlign: 'center', margin: '0.5rem 0 0' }}>{error}</p>}
    </form>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'block',
  textAlign: 'center',
  padding: '0.9rem',
  background: '#1c1917',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: '0.85rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

// The primary action when it is a <button> (the full-screen QR), not a link.
const primaryButtonOnButton: React.CSSProperties = {
  ...primaryButtonStyle,
  width: '100%',
  minHeight: 44,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const textLinkStyle: React.CSSProperties = {
  color: '#1c1917',
  fontWeight: 600,
  fontSize: '0.85rem',
  textDecoration: 'underline',
};

const secondaryButtonStyle: React.CSSProperties = {
  display: 'block',
  textAlign: 'center',
  padding: '0.75rem',
  border: '1px solid #1c1917',
  color: '#1c1917',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: '0.75rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  marginTop: '0.75rem',
};

const h1Style: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 800,
  color: '#1c1917',
  letterSpacing: '-0.02em',
  margin: '0 0 0.5rem',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f5f0eb',
      padding: '2rem 1rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: '#ffffff',
        border: '1px solid #1c1917',
        padding: '2.5rem 2rem',
        boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
      }}>
        <img
          src="/logos/ratetap_logo_transparent_background.png"
          alt="RateTap"
          style={{ height: 48, display: 'block', margin: '0 auto 1.5rem' }}
        />
        {children}
      </div>
    </div>
  );
}
