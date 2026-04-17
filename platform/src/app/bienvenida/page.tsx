'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SUPPORT_WHATSAPP_URL } from '@/lib/support';


interface StatusResponse {
  ready: boolean;
  slug?: string;
  restaurantName?: string;
  reviewUrl?: string;
  qrDataUrl?: string;
  trialEndsAt?: string;
}

export default function BienvenidaPage() {
  return (
    <Suspense fallback={<Shell><div style={{ textAlign: 'center', color: '#57534e' }}>Cargando…</div></Shell>}>
      <BienvenidaInner />
    </Suspense>
  );
}

function BienvenidaInner() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/signup/status?session_id=${encodeURIComponent(sessionId!)}`);
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (data.ready) {
          setStatus(data);
          return;
        }
      } catch {
        /* swallow and retry */
      }
    }

    poll();
    const pollId = setInterval(poll, 2000);
    // Hard timeout: 30 seconds. Payment succeeded — webhook is just slow.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setTimedOut(true);
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, [sessionId]);

  if (!sessionId) {
    return <Shell>
      <h1 style={h1Style}>Falta información</h1>
      <p>No encontramos tu sesión de pago. <a href="/contacto" style={{ color: '#1c1917', fontWeight: 600 }}>Intenta de nuevo</a>.</p>
    </Shell>;
  }

  if (!status?.ready) {
    if (timedOut) {
      return <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✉️</div>
          <h1 style={h1Style}>Tu pago fue exitoso</h1>
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

  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
        <h1 style={h1Style}>¡Listo, {status.restaurantName}!</h1>
        <p style={{ color: '#57534e', marginBottom: '1.5rem' }}>
          Tu prueba gratis de 15 días ya está activa. Usa este QR desde hoy.
        </p>
      </div>

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
      </div>

      {status.qrDataUrl && (
        <a
          href={status.qrDataUrl}
          download={`ratetap-qr-${status.slug}.png`}
          style={{
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
            marginBottom: '0.75rem',
          }}
        >
          Descargar QR
        </a>
      )}

      <a
        href="/dashboard"
        style={{
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
        }}
      >
        Ir a mi panel →
      </a>

      <p style={{ fontSize: '0.75rem', color: '#a8a29e', textAlign: 'center', marginTop: '1rem' }}>
        Revisa tu email: te mandamos una copia del QR y los datos de acceso.
      </p>
    </Shell>
  );
}

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
