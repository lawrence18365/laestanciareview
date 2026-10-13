'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import GooglePlaceSearch, {
  type PlaceSelection,
} from '@/components/GooglePlaceSearch';
import { getSessionId, track } from '@/lib/analytics-client';
import type { LocationsBand, TeamMode } from '@/lib/onboarding-profile';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';

export type Form = {
  businessName: string;
  googlePlaceId: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  locationsBand: '' | LocationsBand;
  teamMode: '' | TeamMode;
  password: string;
  line1: string;
  line2: string;
  addrCity: string;
  state: string;
  postalCode: string;
  notes: string;
};

const EMPTY: Form = {
  businessName: '',
  googlePlaceId: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  locationsBand: '',
  teamMode: '',
  password: '',
  line1: '',
  line2: '',
  addrCity: '',
  state: '',
  postalCode: '',
  notes: '',
};

/**
 * Picking the business from Google fills the business name and the city (and
 * state). Anything Google did not return keeps what the form already had.
 */
export function applyPlaceSelection(f: Form, place: PlaceSelection): Form {
  return {
    ...f,
    businessName: place.name || f.businessName,
    googlePlaceId: place.placeId,
    city: place.address.city || f.city,
    addrCity: place.address.city || f.addrCity,
    state: place.address.state || f.state,
  };
}

/** The first field on the page: the Google business search. */
export const FIRST_FIELD_ID = 'businessName';
const FIELD_FOCUSED_KEY = 'rt_signup_field_focused';

/**
 * `signup_field_focused` fires for the first field only, once per browser
 * session. The storage flag keeps a reload or a second visit from counting the
 * same visitor twice; when storage is blocked the caller's per-mount ref is the
 * only cap. Returns whether the event was emitted.
 */
export function trackFirstFieldFocus(
  targetId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  emit: () => void,
): boolean {
  if (targetId !== FIRST_FIELD_ID) return false;
  try {
    if (storage?.getItem(FIELD_FOCUSED_KEY)) return false;
    storage?.setItem(FIELD_FOCUSED_KEY, '1');
  } catch {
    // Storage blocked: still emit once; the component's ref caps the mount.
  }
  emit();
  return true;
}

function readMarketingPayload() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const get = (name: string) => params.get(name)?.trim() || undefined;
  const hasPilotParam = params.has('pilot');
  if (hasPilotParam) params.delete('pilot');
  const sanitizedSearch = hasPilotParam
    ? (params.size > 0 ? `?${params.toString()}` : '')
    : window.location.search;
  const landingPath = `${window.location.pathname}${sanitizedSearch}`;

  return {
    source: get('source_page') || get('source') || 'app_contacto',
    landingPath,
    utmSource: get('utm_source'),
    utmMedium: get('utm_medium'),
    utmCampaign: get('utm_campaign'),
    utmTerm: get('utm_term'),
    utmContent: get('utm_content'),
    offer: get('offer') || 'trial_checkout',
    metadata: {
      source_cluster: get('source_cluster') || null,
      cta_context: get('cta_context') || null,
      language: get('language') || 'es',
      referrer: document.referrer || null,
      landing_url: hasPilotParam ? `${window.location.origin}${landingPath}` : window.location.href,
    },
  };
}

export default function ContactoForm({ pilotOffer }: { pilotOffer: boolean }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [loading, setLoading] = useState(false);
  // Funnel instrumentation: each of these fires at most once per mount, so a
  // re-render or a second focus never inflates the step counts.
  const formStartedRef = useRef(false);
  const fieldFocusedRef = useRef(false);
  const placeSelectedRef = useRef(false);
  // The city field only appears when Google did not give us one (place without
  // a locality, or a name typed by hand). Otherwise the pick fills it.
  const [cityRevealed, setCityRevealed] = useState(false);
  const shapeSelectedRef = useRef(false);

  // Step 1 of the funnel: the form page was viewed. Only booleans and the UTM
  // keys are recorded — never anything the visitor typed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const get = (name: string) => params.get(name)?.trim() || undefined;
    const properties: Record<string, unknown> = { pilot: pilotOffer };
    const utmSource = get('utm_source');
    const utmMedium = get('utm_medium');
    const utmCampaign = get('utm_campaign');
    const utmContent = get('utm_content');
    if (utmSource) properties.utm_source = utmSource;
    if (utmMedium) properties.utm_medium = utmMedium;
    if (utmCampaign) properties.utm_campaign = utmCampaign;
    if (utmContent) properties.utm_content = utmContent;
    track('signup_page_view', properties);
  }, [pilotOffer]);

  function markFormStarted() {
    if (formStartedRef.current) return;
    formStartedRef.current = true;
    track('signup_form_started');
  }

  // Capture-phase focus on the form: the first-field event for the start rate,
  // and the manual-city fallback when the visitor moves on without a pick.
  function handleFormFocus(e: React.FocusEvent<HTMLFormElement>) {
    markFormStarted();
    const el = e.target as HTMLElement;
    if (!fieldFocusedRef.current && el.id === FIRST_FIELD_ID) {
      fieldFocusedRef.current = true;
      let storage: Storage | null = null;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = null;
      }
      trackFirstFieldFocus(el.id, storage, () =>
        track('signup_field_focused', { field: 'place_search' }),
      );
    }
    // Only inputs: a tap on a result button must not shift the layout.
    if (el.tagName === 'INPUT' && el.id !== FIRST_FIELD_ID && !form.city.trim()) {
      setCityRevealed(true);
    }
  }

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // The two tap questions. The funnel event fires once, when both are answered,
  // and carries only the two enum values (never anything typed).
  function pickShape(key: 'locationsBand' | 'teamMode', value: string) {
    const next = { ...form, [key]: value } as Form;
    setForm(next);
    if (next.locationsBand && next.teamMode && !shapeSelectedRef.current) {
      shapeSelectedRef.current = true;
      track('signup_shape_selected', {
        locations_band: next.locationsBand,
        team_mode: next.teamMode,
      });
    }
  }

  // Picking the restaurant from Google is what captures its Place ID — the same
  // widget the dashboard uses (see components/GooglePlaceSearch.tsx). The city
  // and state Google returns prefill the address block; anything the guest has
  // already typed wins.
  function handlePlaceSelected(place: PlaceSelection) {
    if (!placeSelectedRef.current) {
      placeSelectedRef.current = true;
      track('signup_place_selected', { has_place_id: Boolean(place.placeId) });
    }
    if (!place.address.city) setCityRevealed(true);
    setForm((f) => applyPlaceSelection(f, place));
  }

  // Everyone who submits this form is provisioned immediately: the restaurant
  // is live with a 30-day trial the moment the request lands. The API records
  // the commercial lead as part of provisioning (no separate lead call), so we
  // go straight to the activation request and then the welcome page.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoginUrl('');
    if (!form.city.trim()) {
      // The city is hidden while Google supplies it; if it did not, ask now.
      setCityRevealed(true);
      setError('Escribe tu ciudad.');
      return;
    }
    setLoading(true);
    track('signup_submit', { has_place_id: Boolean(form.googlePlaceId) });

    try {
      const shippingAddress = form.line1.trim()
        ? {
            line1: form.line1,
            line2: form.line2 || undefined,
            city: form.addrCity || form.city || undefined,
            state: form.state || undefined,
            postalCode: form.postalCode || undefined,
            notes: form.notes || undefined,
          }
        : undefined;

      const res = await fetch('/api/signup/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          contactName: form.contactName,
          email: form.email,
          phone: form.phone,
          city: form.city,
          password: form.password,
          googlePlaceId: form.googlePlaceId || undefined,
          locationsBand: form.locationsBand || undefined,
          teamMode: form.teamMode || undefined,
          analyticsSessionId: getSessionId() ?? undefined,
          ...readMarketingPayload(),
          ...(shippingAddress ? { shippingAddress } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        track('signup_submit_failed', { status: res.status });
        const friendly =
          res.status >= 500
            ? 'No pudimos activar tu cuenta en este momento. Inténtalo de nuevo en unos minutos o escríbenos por WhatsApp.'
            : data.error || 'No pudimos activar tu cuenta. Revisa los datos e intenta de nuevo.';
        setError(friendly);
        if (typeof data.loginUrl === 'string') setLoginUrl(data.loginUrl);
        setLoading(false);
        return;
      }
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (fbq) {
        fbq('trackCustom', pilotOffer ? 'PilotStarted' : 'TrialStarted', {
          value: 0,
          currency: 'MXN',
        });
      }
      window.location.href = data.url;
    } catch {
      track('signup_submit_failed', { status: null, network: true });
      setError('Error de red. Intenta de nuevo.');
      setLoading(false);
    }
  }

  return (
    <>
      {/* Meta Pixel */}
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        if(location.hostname.endsWith('ratetapmx.com'))fbq('init', '${PIXEL_ID}'); fbq('track', 'PageView');
      `}</Script>

      {/* Google Places — injected by GooglePlaceSearch, which owns the key. */}

      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base, #f5f0eb)',
        padding: '1rem 1rem 2rem',
        fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {/* Header: kept short so the first form field is on screen on a phone. */}
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <img
              src="/logos/ratetap_logo_transparent_background.png"
              alt="RateTap"
              style={{ height: 36, display: 'block', margin: '0 auto 0.75rem' }}
            />
            <h1 style={{
              fontSize: '1.5rem',
              lineHeight: 1.15,
              fontWeight: 800,
              color: 'var(--text-main, #1c1917)',
              letterSpacing: '-0.02em',
              margin: '0 0 0.4rem',
            }}>
              {pilotOffer
                ? 'Piloto fundador: empieza por $0 hoy'
                : 'Más reseñas en Google, todos los días.'}
            </h1>
            <p style={{ color: 'var(--text-muted, #57534e)', fontSize: '0.95rem', margin: 0 }}>
              {pilotOffer
                ? 'Piloto fundador: $0 hoy · 30 días gratis. Las tarjetas NFC se envían cuando decides continuar.'
                : '30 días gratis. Sin tarjeta. Listo en 2 minutos.'}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            onFocusCapture={handleFormFocus}
            onInputCapture={markFormStarted}
            style={{
              background: 'var(--panel-bg, #ffffff)',
              border: '1px solid var(--border-dark, #1c1917)',
              padding: '1.25rem 1.25rem 1.5rem',
              boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
            }}
          >
            <Field label="Busca tu negocio en Google">
              <GooglePlaceSearch
                value={form.businessName}
                onChange={(v) => update('businessName', v)}
                onSelect={handlePlaceSelected}
                inputId={FIRST_FIELD_ID}
                city={form.city}
                required
                placeholder="Nombre de tu negocio"
                style={inputStyle}
              />
              {form.googlePlaceId && (
                <small style={{ fontSize: '0.7rem', color: '#16a34a', marginTop: 4, display: 'block' }}>
                  ✓ Ubicación verificada en Google
                </small>
              )}
            </Field>
            {cityRevealed && (
              <Field label="Ciudad">
                <input
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder="Ciudad"
                  style={inputStyle}
                />
              </Field>
            )}
            <ChoiceGroup
              legend="¿Cuántas sucursales tienes?"
              name="locationsBand"
              value={form.locationsBand}
              options={LOCATION_OPTIONS}
              onChange={(v) => pickShape('locationsBand', v)}
            />
            <ChoiceGroup
              legend="¿Quién atiende a tus clientes?"
              name="teamMode"
              value={form.teamMode}
              options={TEAM_OPTIONS}
              onChange={(v) => pickShape('teamMode', v)}
            />

            <Field label="Tu nombre">
              <input
                required
                autoComplete="name"
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Nombre y apellido"
                style={inputStyle}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                required
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="+52 55 1234 5678"
                style={inputStyle}
              />
            </Field>
            <Field label="Email">
              <input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="tu@email.com"
                style={inputStyle}
              />
            </Field>
            <Field label="Contraseña (para tu panel)">
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="Mínimo 8 caracteres"
                style={inputStyle}
              />
            </Field>

            {/* Self-serve trials are QR-only; only founder pilots still collect a card address. */}
            {pilotOffer && (<>
            <Divider />
            <details style={{ marginBottom: '1.25rem' }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--text-dim, #a8a29e)',
              }}>
                Dirección para tarjetas NFC (opcional)
              </summary>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #57534e)', margin: '1rem 0' }}>
                Las tarjetas NFC se envían cuando decides continuar. Puedes dejarla en blanco ahora.
              </p>
              <Field label="Dirección">
                <input
                  value={form.line1}
                  onChange={(e) => update('line1', e.target.value)}
                  placeholder="Calle y número"
                  style={inputStyle}
                />
              </Field>
              <Field label="Colonia / interior (opcional)">
                <input
                  value={form.line2}
                  onChange={(e) => update('line2', e.target.value)}
                  placeholder="Colonia, depto, referencias"
                  style={inputStyle}
                />
              </Field>
              <Row>
                <Field label="Ciudad">
                  <input
                    value={form.addrCity}
                    onChange={(e) => update('addrCity', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Estado">
                  <input
                    value={form.state}
                    onChange={(e) => update('state', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="CP">
                  <input
                    value={form.postalCode}
                    onChange={(e) => update('postalCode', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </Row>
            </details>
            </>)}

            {error && (
              <div style={{
                padding: '0.6rem 0.75rem',
                marginTop: '1rem',
                border: '1px solid #b91c1c',
                background: '#fee2e2',
                color: '#b91c1c',
                fontSize: '0.85rem',
                fontWeight: 500,
              }}>
                {error}
                {loginUrl && (
                  <>
                    {' '}
                    <a href={loginUrl} style={{ color: '#b91c1c', fontWeight: 700, textDecoration: 'underline' }}>
                      Iniciar sesión
                    </a>
                  </>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.9rem',
                border: 'none',
                borderRadius: 0,
                background: 'var(--text-main, #1c1917)',
                color: 'var(--panel-bg, #ffffff)',
                fontWeight: 700,
                fontSize: '0.85rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                marginTop: '1.5rem',
              }}
            >
              {loading
                ? (pilotOffer ? 'ACTIVANDO TU PILOTO…' : 'ACTIVANDO TU CUENTA…')
                : (pilotOffer ? 'ACTIVAR MI PILOTO GRATIS' : 'Crear mi cuenta gratis')}
            </button>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim, #a8a29e)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
              {pilotOffer
                ? 'No necesitas tarjeta. Cuando terminen tus 30 días, tú decides si continúas.'
                : 'Después de 30 días, MX$700/mes por sucursal si decides continuar.'}{' '}
              Al continuar aceptas la{' '}
              <a href="/privacy" style={{ color: '#1c1917', fontWeight: 700 }}>Política de Privacidad</a>, los{' '}
              <a href="/terms" style={{ color: '#1c1917', fontWeight: 700 }}>Términos</a> y la{' '}
              <a href="/cookies" style={{ color: '#1c1917', fontWeight: 700 }}>Política de Cookies</a>.
            </p>
          </form>

          {!pilotOffer && <ProofBlock />}
        </div>
      </div>
    </>
  );
}

/**
 * Proof + how-it-works. Cold Meta traffic reads the form first; this block sits
 * below it so the form is the first thing on screen and the evidence is one
 * scroll away.
 */
function ProofBlock() {
  return (
        <div style={{
          background: 'var(--panel-bg, #ffffff)',
          border: '1px solid var(--border-dark, #1c1917)',
          padding: '1.25rem',
          boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
          marginTop: '1.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <img
              src="/contacto/guest-choice-mobile.webp"
              alt="Pantalla del cliente: califica y elige Google o comentario privado"
              width={96}
              height={208}
              style={{
                width: 96,
                height: 208,
                flexShrink: 0,
                display: 'block',
                borderRadius: 12,
                border: '1px solid var(--border-dark, #1c1917)',
                objectFit: 'cover',
                objectPosition: 'top',
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: '1.6rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                color: 'var(--text-main, #1c1917)',
              }}>
                {'< 1 → 3–8'}
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #57534e)', margin: '0.4rem 0 0', lineHeight: 1.4 }}>
                reseñas nuevas en Google al día, por restaurante.
              </p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim, #a8a29e)', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
                11 restaurantes reales, antes vs. después.{' '}
                <a
                  href="https://ratetapmx.com/methodology#velocity"
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--text-muted, #57534e)', fontWeight: 700, textDecoration: 'underline' }}
                >
                  Cómo lo medimos
                </a>
              </p>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '0.5rem',
            marginTop: '1.25rem',
          }}>
            {[
              { n: '1', label: 'Tu cliente escanea tu QR' },
              { n: '2', label: 'Califica en 2 toques' },
              { n: '3', label: 'Elige Google o nota privada' },
            ].map((step) => (
              <div key={step.n} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--text-main, #1c1917)',
                  color: 'var(--panel-bg, #ffffff)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 0.4rem',
                }}>
                  {step.n}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #57534e)', lineHeight: 1.35 }}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{
        display: 'block',
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #78716c)',
        marginBottom: '0.4rem',
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const LOCATION_OPTIONS: { value: LocationsBand; label: string }[] = [
  { value: '1', label: '1' },
  { value: '2-5', label: '2 a 5' },
  { value: '6+', label: '6 o más' },
];

const TEAM_OPTIONS: { value: TeamMode; label: string }[] = [
  { value: 'solo', label: 'Solo yo' },
  { value: 'team', label: 'Tengo meseros' },
];

// Tap-only required choice: real radio inputs (native `required`, keyboard and
// screen-reader support) styled as large touch buttons.
function ChoiceGroup<V extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: '' | V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem', minWidth: 0 }}>
      <style>{'.rt-choice:focus-within{outline:2px solid #1c1917;outline-offset:2px}'}</style>
      <legend style={{
        padding: 0,
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #78716c)',
        marginBottom: '0.4rem',
      }}>
        {legend}
      </legend>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <label
              key={opt.value}
              className="rt-choice"
              style={{
                position: 'relative',
                flex: 1,
                minHeight: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.5rem',
                textAlign: 'center',
                border: '1px solid var(--border-dark, #1c1917)',
                background: selected ? 'var(--text-main, #1c1917)' : 'var(--panel-bg, #ffffff)',
                color: selected ? 'var(--panel-bg, #ffffff)' : 'var(--text-main, #1c1917)',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                required
                onChange={() => onChange(opt.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--panel-border, #e7e5e4)', margin: '1.5rem 0 1.25rem' }} />;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.75rem',
  border: '1px solid var(--border-dark, #1c1917)',
  borderRadius: 0,
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  background: 'var(--panel-bg, #ffffff)',
  color: 'var(--text-main, #1c1917)',
  boxSizing: 'border-box',
};
