'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';
const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_BROWSER_KEY ?? '';

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

export default function ContactoPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const businessRef = useRef<HTMLInputElement | null>(null);
  const autocompleteReady = useRef(false);

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function initAutocomplete() {
    if (autocompleteReady.current || !businessRef.current) return;
    type AddressComponent = { types: string[]; long_name: string };
    type PlaceResult = {
      place_id?: string;
      name?: string;
      address_components?: AddressComponent[];
    };
    type AutocompleteInstance = {
      addListener: (event: string, cb: () => void) => void;
      getPlace: () => PlaceResult;
    };
    interface GoogleNS {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: Record<string, unknown>,
          ) => AutocompleteInstance;
        };
      };
    }
    const g = (window as unknown as { google?: GoogleNS }).google;
    if (!g?.maps?.places) return;
    const ac = new g.maps.places.Autocomplete(businessRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'mx' },
      fields: ['place_id', 'name', 'address_components'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const name = place.name ?? '';
      const placeId = place.place_id ?? '';
      let city = '';
      let state = '';
      for (const comp of place.address_components ?? []) {
        if (comp.types.includes('locality')) city = comp.long_name;
        else if (comp.types.includes('administrative_area_level_1')) state = comp.long_name;
      }
      setForm((f) => ({
        ...f,
        businessName: name || f.businessName,
        googlePlaceId: placeId,
        city: city || f.city,
        addrCity: city || f.addrCity,
        state: state || f.state,
      }));
    });
    autocompleteReady.current = true;
  }

  useEffect(() => {
    const onLoad = () => initAutocomplete();
    if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) initAutocomplete();
    window.addEventListener('gmaps:loaded', onLoad);
    return () => window.removeEventListener('gmaps:loaded', onLoad);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
    if (fbq) fbq('track', 'Lead', { value: 0, currency: 'MXN' });

    try {
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
          shippingAddress: {
            line1: form.line1,
            line2: form.line2 || undefined,
            city: form.addrCity,
            state: form.state,
            postalCode: form.postalCode,
            notes: form.notes || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || 'No pudimos iniciar el pago. Revisa los datos e intenta de nuevo.');
        setLoading(false);
        return;
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

      {/* Google Places */}
      {GMAPS_KEY && (
        <Script
          strategy="afterInteractive"
          src={`https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places&language=es&region=MX`}
          onLoad={() => window.dispatchEvent(new Event('gmaps:loaded'))}
        />
      )}

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
              Empieza tu prueba gratis de 15 días
            </h1>
            <p style={{ color: 'var(--text-muted, #57534e)', fontSize: '0.95rem', margin: 0 }}>
              Registra tu tarjeta. No te cobramos nada hasta el día 15. Cancela cuando quieras.
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
              <input
                ref={businessRef}
                required
                value={form.businessName}
                onChange={(e) => update('businessName', e.target.value)}
                onFocus={initAutocomplete}
                placeholder={GMAPS_KEY ? 'Escribe el nombre y selecciona de la lista' : 'Nombre del restaurante'}
                style={inputStyle}
                autoComplete="off"
              />
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
            <SectionTitle>Envío de tarjetas NFC</SectionTitle>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #57534e)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
              Te enviamos las tarjetas físicas cuando confirmes tu pago el día 15. Tu QR digital ya queda activo hoy.
            </p>
            <Field label="Dirección">
              <input
                required
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
                  required
                  value={form.addrCity}
                  onChange={(e) => update('addrCity', e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="Estado">
                <input
                  required
                  value={form.state}
                  onChange={(e) => update('state', e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="CP">
                <input
                  required
                  value={form.postalCode}
                  onChange={(e) => update('postalCode', e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </Row>

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
              {loading ? 'REDIRIGIENDO A STRIPE…' : 'INICIAR MI PRUEBA DE 15 DÍAS'}
            </button>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim, #a8a29e)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
              Pago seguro con Stripe. Después del día 15 se cobran $700 MXN/mes automáticamente. Cancela cuando quieras desde tu panel.
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
