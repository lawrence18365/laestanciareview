interface Props {
  status: 'canceled' | 'past_due' | string;
  restaurantName: string;
}

export default function SubscriptionBlocked({ status, restaurantName }: Props) {
  const isPastDue = status === 'past_due';
  const title = isPastDue ? 'Problema con tu pago' : 'Cuenta desactivada';
  const body = isPastDue
    ? 'No pudimos cobrar tu tarjeta. Actualiza tu método de pago para reactivar tu panel.'
    : 'Tu prueba terminó sin confirmar pago. Puedes volver a activar tu cuenta cuando quieras.';

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
          style={{ height: 48, margin: '0 auto 1.5rem' }}
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
          {title}
        </h1>

        <p style={{ color: '#57534e', fontSize: '0.95rem', lineHeight: 1.55, margin: '0 0 1.5rem' }}>
          {body}
        </p>

        <a
          href="https://wa.me/5215512345678"
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
          Contactar soporte por WhatsApp
        </a>

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
