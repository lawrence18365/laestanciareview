'use client';

import Script from 'next/script';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '1578821303344121';

interface PilotCtaProps {
  restaurantName: string;
}

export function PilotCta({ restaurantName }: PilotCtaProps) {
  const message = `Hola Lawrence, vi la auditoría de ${restaurantName} y quiero el lugar piloto.`;
  const whatsappUrl = `https://wa.me/5212228822360?text=${encodeURIComponent(message)}`;

  const handleClick = () => {
    const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
    if (fbq) {
      fbq('track', 'Lead');
    }
  };

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

      <div
        style={{
          background: '#1E293B',
          border: '2px solid rgba(251, 191, 36, 0.4)',
          borderRadius: '16px',
          padding: '24px',
          marginBottom: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            background: 'rgba(251, 191, 36, 0.15)',
            color: '#FBBF24',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            padding: '5px 12px',
            borderRadius: '100px',
            marginBottom: '12px',
          }}
        >
          Lugares limitados
        </div>
        <h2
          style={{
            color: '#F8FAFC',
            fontSize: '20px',
            fontWeight: 700,
            margin: '0 0 6px',
          }}
        >
          Sé uno de 3 lugares piloto
        </h2>
        <p
          style={{
            color: '#94A3B8',
            fontSize: '14px',
            margin: '0 0 18px',
          }}
        >
          RateTap 30 días gratis · $0 hoy · sin tarjeta
        </p>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          style={{
            display: 'inline-block',
            background: '#FBBF24',
            color: '#0F172A',
            textAlign: 'center',
            padding: '14px 28px',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 4px 24px rgba(251, 191, 36, 0.25)',
          }}
        >
          Quiero mi lugar piloto →
        </a>
      </div>
    </>
  );
}
