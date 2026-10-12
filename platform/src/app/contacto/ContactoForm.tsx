'use client';

import Script from 'next/script';
import { useState } from 'react';
import GooglePlaceSearch, {
  GOOGLE_PLACES_BROWSER_KEY,
  type PlaceSelection,
} from '@/components/GooglePlaceSearch';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';

type Form = {
  businessName: string;
  googlePlaceId: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
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
  password: '',
  line1: '',
  line2: '',
  addrCity: '',
  state: '',
  postalCode: '',
  notes: '',
};

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
  const [loading, setLoading] = useState(false);

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Picking the restaurant from Google is what captures its Place ID — the same
  // widget the dashboard uses (see components/GooglePlaceSearch.tsx). The city
  // and state Google returns prefill the address block; anything the guest has
  // already typed wins.
  function handlePlaceSelected(place: PlaceSelection) {
    setForm((f) => ({
      ...f,
      businessName: place.name || f.businessName,
      googlePlaceId: place.placeId,
      city: place.address.city || f.city,
      addrCity: place.address.city || f.addrCity,
      state: place.address.state || f.state,
    }));
  }

  // Everyone who submits this form is provisioned immediately: the restaurant
  // is live with a 30-day trial the moment the request lands. The API records
  // the commercial lead as part of provisioning (no separate lead call), so we
  // go straight to the activation request and then the welcome page.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

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
          ...readMarketingPayload(),
          ...(shippingAddress ? { shippingAddress } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        const friendly =
          res.status >= 500
            ? 'No pudimos activar tu cuenta en este momento. Inténtalo de nuevo en unos minutos o escríbenos por WhatsApp.'
            : data.error || 'No pudimos activar tu cuenta. Revisa los datos e intenta de nuevo.';
        setError(friendly);
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
        fbq('init', '${PIXEL_ID}'); fbq('track', 'PageView');
      `}</Script>

      {/* Google Places — injected by GooglePlaceSearch, which owns the key. */}

      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base, #f5f0eb)',
        padding: '2rem 1rem',
        fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <img
              src="/logos/ratetap_logo_transparent_background.png"
              alt="RateTap"
              style={{ height: 72, display: 'block', margin: '0 auto 1.5rem' }}
            />
            <h1 style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: 'var(--text-main, #1c1917)',
              letterSpacing: '-0.02em',
              margin: '0 0 0.5rem',
            }}>
              {pilotOffer
                ? 'Piloto fundador: empieza por $0 hoy'
                : '30 días gratis. Sin tarjeta, sin pagos, sin envíos.'}
            </h1>
            <p style={{ color: 'var(--text-muted, #57534e)', fontSize: '0.95rem', margin: 0 }}>
              {pilotOffer
                ? 'Piloto fundador: $0 hoy · 30 días gratis. Las tarjetas NFC se envían cuando decides continuar.'
                : 'Tu cuenta y tu QR quedan listos hoy mismo. Las tarjetas NFC se envían cuando decides continuar.'}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{
              background: 'var(--panel-bg, #ffffff)',
              border: '1px solid var(--border-dark, #1c1917)',
              padding: '2rem 1.75rem',
              boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
            }}
          >
            <SectionTitle>Tu negocio</SectionTitle>
            <Field label="Nombre del restaurante">
              {GOOGLE_PLACES_BROWSER_KEY ? (
                <GooglePlaceSearch
                  value={form.businessName}
                  onChange={(v) => update('businessName', v)}
                  onSelect={handlePlaceSelected}
                  inputId="businessName"
                  required
                  placeholder="Escribe el nombre y selecciona de la lista"
                  style={inputStyle}
                />
              ) : (
                <input
                  required
                  value={form.businessName}
                  onChange={(e) => update('businessName', e.target.value)}
                  placeholder="Nombre del restaurante"
                  style={inputStyle}
                  autoComplete="off"
                />
              )}
              {form.googlePlaceId && (
                <small style={{ fontSize: '0.7rem', color: '#16a34a', marginTop: 4, display: 'block' }}>
                  ✓ Ubicación verificada en Google
                </small>
              )}
            </Field>
            <Field label="Ciudad">
              <input
                required
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                placeholder="Ciudad"
                style={inputStyle}
              />
            </Field>

            <Divider />
            <SectionTitle>Tu contacto</SectionTitle>
            <Field label="Tu nombre">
              <input
                required
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Nombre y apellido"
                style={inputStyle}
              />
            </Field>
            <Field label="Email">
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="tu@email.com"
                style={inputStyle}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                required
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="+52 55 1234 5678"
                style={inputStyle}
              />
            </Field>
            <Field label="Contraseña (para tu panel)">
              <input
                required
                type="password"
                minLength={8}
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="Mínimo 8 caracteres"
                style={inputStyle}
              />
            </Field>

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
                : (pilotOffer ? 'ACTIVAR MI PILOTO GRATIS' : 'Activar ahora')}
            </button>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim, #a8a29e)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
              No necesitas tarjeta. Cuando terminen tus 30 días, tú decides si continúas.{' '}
              Al continuar aceptas la{' '}
              <a href="/privacy" style={{ color: '#1c1917', fontWeight: 700 }}>Política de Privacidad</a>, los{' '}
              <a href="/terms" style={{ color: '#1c1917', fontWeight: 700 }}>Términos</a> y la{' '}
              <a href="/cookies" style={{ color: '#1c1917', fontWeight: 700 }}>Política de Cookies</a>.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: 'var(--text-dim, #a8a29e)',
      marginBottom: '1rem',
    }}>
      {children}
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
