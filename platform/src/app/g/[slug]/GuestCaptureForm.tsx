'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';

const PREFERENCE_OPTIONS = [
  'Carne',
  'Vino',
  'Pescados',
  'Celebración',
  'Vegetariano',
];

const PROMO_LABELS: Record<string, string> = {
  wine: 'copa de vino',
  copa: 'copa de vino',
  dessert: 'postre',
  postre: 'postre',
};

interface IgHandle {
  handle: string;
  label: string;
}

interface Props {
  slug: string;
  restaurantName: string;
  brandSlug: string;
  brandLogo: string;
  brandDarkBg: boolean;
  promoType?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  igHandles: IgHandle[];
}

interface SuccessState {
  validationCode: string;
  eventId: string;
  name: string;
}

export default function GuestCaptureForm(props: Props) {
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [preferences, setPreferences] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const togglePreference = (p: string) => {
    setPreferences((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !whatsapp.trim() || !day || !month) {
      setError('Completa todos los campos obligatorios.');
      return;
    }
    const dd = day.padStart(2, '0');
    const mm = month.padStart(2, '0');
    const birthdayMmdd = `${dd}/${mm}`;

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/guests/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantSlug: props.slug,
          name: name.trim(),
          whatsapp: whatsapp.trim(),
          birthdayMmdd,
          preferences: preferences.length > 0 ? preferences : undefined,
          marketingConsent: consent,
          promoType: props.promoType,
          utmSource: props.utmSource,
          utmMedium: props.utmMedium,
          utmCampaign: props.utmCampaign,
        }),
      });

      if (res.status === 429) {
        setError('Demasiados envíos. Intenta de nuevo en unos minutos.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'Algo salió mal. Intenta de nuevo.');
        return;
      }

      const data = (await res.json()) as { validationCode: string; eventId: string };
      setSuccess({ validationCode: data.validationCode, eventId: data.eventId, name: name.trim() });
    } catch {
      setError('No pudimos enviar el formulario. Revisa tu conexión.');
    } finally {
      setSubmitting(false);
    }
  };

  // Fire Lead pixel on the confirmation view — deduped server-side by shared eventID.
  const pixelFiredRef = useRef(false);
  useEffect(() => {
    if (!success || pixelFiredRef.current) return;
    const key = `rt_lead_fired:${success.eventId}`;
    try {
      if (sessionStorage.getItem(key)) {
        pixelFiredRef.current = true;
        return;
      }
      sessionStorage.setItem(key, '1');
    } catch {
      /* sessionStorage unavailable — still fire once */
    }
    const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
    if (fbq) {
      fbq(
        'track',
        'Lead',
        {
          currency: 'MXN',
          value: 0,
          content_category: 'guest_capture',
          brand_slug: props.brandSlug,
          location_slug: props.slug,
          promo_type: props.promoType ?? null,
        },
        { eventID: success.eventId },
      );
    }
    pixelFiredRef.current = true;
  }, [success, props.brandSlug, props.slug, props.promoType]);

  const promoLabel = props.promoType ? PROMO_LABELS[props.promoType.toLowerCase()] : null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${PIXEL_ID}'); fbq('track', 'PageView');
      `}</Script>

      <main
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '2rem 1rem 3rem',
          background: '#FAFAF9',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: '#D97706',
            zIndex: 10,
          }}
        />

        <div
          style={{
            width: 120,
            height: 120,
            overflow: 'hidden',
            background: props.brandDarkBg ? '#111' : '#fff',
            border: '2px solid #111',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0.5rem 0 1.25rem',
            flexShrink: 0,
            boxShadow: '5px 5px 0 rgba(0,0,0,0.06)',
          }}
        >
          <img
            src={props.brandLogo}
            alt={props.restaurantName}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10 }}
          />
        </div>

        {success ? (
          <ConfirmationCard
            data={success}
            restaurantName={props.restaurantName}
            promoLabel={promoLabel}
            igHandles={props.igHandles}
          />
        ) : (
          <FormCard
            name={name}
            setName={setName}
            whatsapp={whatsapp}
            setWhatsapp={setWhatsapp}
            day={day}
            setDay={setDay}
            month={month}
            setMonth={setMonth}
            preferences={preferences}
            togglePreference={togglePreference}
            consent={consent}
            setConsent={setConsent}
            submitting={submitting}
            error={error}
            onSubmit={handleSubmit}
            restaurantName={props.restaurantName}
            promoLabel={promoLabel}
          />
        )}

        <footer
          style={{
            marginTop: '2rem',
            fontSize: '0.6rem',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#A3A3A3',
          }}
        >
          DESARROLLADO POR <span style={{ fontWeight: 700, color: '#111' }}>RATETAP</span>
        </footer>
      </main>
    </>
  );
}

function FormCard(props: {
  name: string;
  setName: (v: string) => void;
  whatsapp: string;
  setWhatsapp: (v: string) => void;
  day: string;
  setDay: (v: string) => void;
  month: string;
  setMonth: (v: string) => void;
  preferences: string[];
  togglePreference: (p: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  restaurantName: string;
  promoLabel: string | null;
}) {
  return (
    <div style={cardStyle}>
      <h1 style={h1Style}>Bienvenidos a {props.restaurantName}</h1>
      <p style={{ color: '#57534e', fontSize: '0.9rem', margin: '0 0 1.5rem', textAlign: 'center', lineHeight: 1.5 }}>
        {props.promoLabel
          ? `Déjanos tus datos y recibe una ${props.promoLabel} de cortesía.`
          : 'Déjanos tus datos y sé parte de la casa.'}
      </p>

      <form onSubmit={props.onSubmit}>
        <Label>Nombre</Label>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          required
          maxLength={255}
          placeholder="Tu nombre"
          autoComplete="given-name"
          style={inputStyle}
        />

        <Label>WhatsApp</Label>
        <input
          type="tel"
          value={props.whatsapp}
          onChange={(e) => props.setWhatsapp(e.target.value)}
          required
          inputMode="tel"
          placeholder="55 1234 5678"
          autoComplete="tel"
          style={inputStyle}
        />

        <Label>Cumpleaños</Label>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={props.day}
            onChange={(e) => props.setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="DD"
            style={{ ...inputStyle, textAlign: 'center', margin: 0, flex: 1 }}
            aria-label="Día"
          />
          <input
            type="text"
            value={props.month}
            onChange={(e) => props.setMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="MM"
            style={{ ...inputStyle, textAlign: 'center', margin: 0, flex: 1 }}
            aria-label="Mes"
          />
        </div>

        <Label>Preferencias <span style={{ fontWeight: 400, color: '#a8a29e' }}>(opcional)</span></Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.25rem' }}>
          {PREFERENCE_OPTIONS.map((opt) => {
            const active = props.preferences.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                onClick={() => props.togglePreference(opt)}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: `1.5px solid ${active ? '#111' : '#d6d3d1'}`,
                  background: active ? '#111' : '#fff',
                  color: active ? '#fff' : '#1c1917',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={props.consent}
            onChange={(e) => props.setConsent(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: '0.78rem', color: '#57534e', lineHeight: 1.4 }}>
            Acepto recibir promociones y comunicaciones por WhatsApp.
          </span>
        </label>

        {props.error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '0.6rem 0.75rem',
              fontSize: '0.8rem',
              marginBottom: '0.75rem',
            }}
          >
            {props.error}
          </div>
        )}

        <button
          type="submit"
          disabled={props.submitting}
          style={{
            width: '100%',
            padding: '0.95rem',
            background: props.submitting ? '#78716c' : '#111',
            color: '#fff',
            border: 'none',
            fontWeight: 700,
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: props.submitting ? 'wait' : 'pointer',
            marginBottom: '0.75rem',
          }}
        >
          {props.submitting ? 'Enviando…' : 'Enviar'}
        </button>

        <p style={{ fontSize: '0.68rem', color: '#a8a29e', textAlign: 'center', lineHeight: 1.45, margin: 0 }}>
          Al enviar, aceptas que guardemos tus datos para enviarte comunicaciones del restaurante.
          Puedes pedir que los eliminemos respondiendo BAJA por WhatsApp.
        </p>
      </form>
    </div>
  );
}

function ConfirmationCard({
  data,
  restaurantName,
  promoLabel,
  igHandles,
}: {
  data: SuccessState;
  restaurantName: string;
  promoLabel: string | null;
  igHandles: IgHandle[];
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.25rem' }}>🎉</div>
      <h1 style={{ ...h1Style, textAlign: 'center' }}>¡Gracias, {data.name}!</h1>
      <p style={{ color: '#57534e', textAlign: 'center', margin: '0 0 1.5rem', fontSize: '0.92rem', lineHeight: 1.5 }}>
        Muéstrale este código a tu mesero
        {promoLabel ? ` para recibir tu ${promoLabel}` : ''}.
      </p>

      <div
        style={{
          background: '#111',
          color: '#fff',
          padding: '1.5rem',
          textAlign: 'center',
          marginBottom: '1.5rem',
          letterSpacing: '0.5rem',
        }}
      >
        <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.4rem', color: '#a8a29e' }}>
          Tu código
        </div>
        <div style={{ fontSize: '3.25rem', fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {data.validationCode}
        </div>
      </div>

      {igHandles.length > 0 && (
        <>
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#57534e',
              textAlign: 'center',
              marginBottom: '0.6rem',
            }}
          >
            Síguenos en Instagram
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {igHandles.map((ig) => (
              <a
                key={ig.handle}
                href={`https://instagram.com/${ig.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 0.95rem',
                  border: '1.5px solid #111',
                  color: '#111',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                }}
              >
                <span style={{ color: '#78716c', fontSize: '0.72rem' }}>{ig.label}</span>
                <span>@{ig.handle}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <p style={{ fontSize: '0.72rem', color: '#a8a29e', textAlign: 'center', marginTop: '1.25rem', lineHeight: 1.5 }}>
        {restaurantName} · Tu mesero escaneará este código para confirmar tu beneficio.
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#57534e',
        marginBottom: '0.35rem',
      }}
    >
      {children}
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  background: '#ffffff',
  border: '1px solid #1c1917',
  padding: '1.75rem 1.5rem',
  boxShadow: '6px 6px 0 rgba(0,0,0,0.06)',
};

const h1Style: React.CSSProperties = {
  fontSize: '1.4rem',
  fontWeight: 800,
  color: '#1c1917',
  letterSpacing: '-0.02em',
  margin: '0 0 0.5rem',
  textAlign: 'center',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.75rem',
  border: '1.5px solid #d6d3d1',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  marginBottom: '1rem',
  background: '#fff',
  color: '#1c1917',
  outline: 'none',
  boxSizing: 'border-box',
};
