'use client';

import React from 'react';
import {
  SUPPORT_WHATSAPP_URL,
  SUPPORT_WHATSAPP_PAYMENT_URL,
  SUPPORT_WHATSAPP_REACTIVATION_URL,
} from '@/lib/support';

export default function SubscriptionBlocked({
  status,
  restaurantName,
  billingProvider,
}: {
  status: 'canceled' | 'past_due' | string;
  restaurantName: string;
  billingProvider?: string | null;
}) {
  const isPastDue = status === 'past_due';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base, #f5f0eb)',
        padding: '2rem 1rem',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#ffffff',
          border: '1px solid #1c1917',
          padding: '2.5rem 2rem',
          boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}
      >
        <img
          src="/logos/ratetap_logo_transparent_background.png"
          alt="RateTap"
          style={{ height: 48, display: 'block', margin: '0 auto 1.5rem' }}
        />

        <div
          style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#a8a29e',
            marginBottom: '0.75rem',
          }}
        >
          {restaurantName}
        </div>

        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: '#1c1917',
            letterSpacing: '-0.02em',
            margin: '0 0 0.75rem',
          }}
        >
          {isPastDue ? 'Problema con tu pago' : 'Cuenta desactivada'}
        </h1>

        <p style={{ color: '#57534e', fontSize: '0.95rem', lineHeight: 1.55, margin: '0 0 0.5rem' }}>
          {isPastDue
            ? 'No pudimos cobrar tu tarjeta — puede ser una tarjeta vencida o un rechazo temporal del banco.'
            : 'Tu prueba terminó sin confirmar pago. Puedes reactivar tu cuenta cuando quieras.'}
        </p>

        {isPastDue && (
          <p style={{ color: '#78716c', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 1.5rem' }}>
            Tus datos y reseñas están seguros. En cuanto actualices tu método de pago, todo vuelve a funcionar de inmediato.
          </p>
        )}

        {!isPastDue && (
          <p style={{ color: '#78716c', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 1.5rem' }}>
            Escríbenos por WhatsApp y te reactivamos en minutos.
          </p>
        )}

        {isPastDue ? (
          <UpdatePaymentButton billingProvider={billingProvider} />
        ) : (
          <a
            href={SUPPORT_WHATSAPP_URL}
            style={{
              display: 'block',
              padding: '0.85rem',
              background: '#1c1917',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '0.8rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
            }}
          >
            Reactivar por WhatsApp →
          </a>
        )}

        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            style={{
              display: 'block',
              width: '100%',
              padding: '0.6rem',
              background: 'transparent',
              color: '#78716c',
              border: 'none',
              textDecoration: 'underline',
              fontWeight: 500,
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}

function UpdatePaymentButton({ billingProvider }: { billingProvider?: string | null }) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');

  async function handleClick() {
    setState('loading');

    const endpoint =
      billingProvider === 'mercadopago'
        ? '/api/billing/mercadopago/subscribe'
        : '/api/stripe/portal';

    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return; // navigation starts — no state update needed
      }
    } catch {
      /* portal unreachable */
    }

    // Portal failed — show explicit error state with WhatsApp option
    setState('error');
  }

  if (state === 'error') {
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '0.85rem', color: '#b91c1c', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          No pudimos abrir el portal de pago. Escríbenos y lo resolvemos en minutos:
        </p>
        <a
          href={SUPPORT_WHATSAPP_PAYMENT_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            padding: '0.85rem',
            background: '#1c1917',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: '0.8rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Contactar por WhatsApp →
        </a>
      </div>
    );
  }

  return (
    <button
      id="ratetap-update-payment"
      onClick={handleClick}
      disabled={state === 'loading'}
      style={{
        display: 'block',
        width: '100%',
        padding: '0.85rem',
        background: '#1c1917',
        color: '#fff',
        border: 'none',
        fontWeight: 700,
        fontSize: '0.8rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: '0.75rem',
        cursor: state === 'loading' ? 'not-allowed' : 'pointer',
        opacity: state === 'loading' ? 0.7 : 1,
      }}
    >
      {state === 'loading' ? 'Abriendo portal…' : 'ACTUALIZAR TARJETA →'}
    </button>
  );
}

