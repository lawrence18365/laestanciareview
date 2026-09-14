import Link from 'next/link';

/**
 * Shown when a quote id does not resolve for the signed-in restaurant.
 *
 * Rendered directly by the page rather than via notFound(). A segment-level
 * not-found.tsx under (app)/quotes does NOT bind here — the build emits only
 * the global _not-found boundary — so notFound() produced HTTP 200 with an
 * empty content area inside the dashboard layout: nav chrome and nothing else.
 * That is what "the quotes section is broken" looked like from the outside.
 */
export default function QuoteMissing({ quoteRef }: { quoteRef?: string }) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '4rem 1.25rem', textAlign: 'center' }}>
      <div
        style={{
          border: '2px solid var(--border-dark)',
          background: 'var(--panel-bg)',
          padding: '2.5rem 1.75rem',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(24px, 6vw, 32px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 0.75rem',
          }}
        >
          Cotización no encontrada
        </h1>
        <div style={{ width: 40, height: 1, background: '#D97706', margin: '0 auto 1.25rem' }} />
        <p style={{ margin: '0 0 1.75rem', fontSize: 15, lineHeight: 1.6, color: '#444' }}>
          {quoteRef
            ? `La cotización ${quoteRef} ya no existe o pertenece a otra sucursal.`
            : 'Esta cotización ya no existe o pertenece a otra sucursal.'}{' '}
          Si la eliminaste, no se puede recuperar. Puedes crear una nueva desde
          la lista.
        </p>
        <Link
          href="/quotes"
          style={{
            display: 'inline-block',
            padding: '0.7rem 1.4rem',
            border: '2px solid var(--border-dark)',
            background: 'var(--border-dark)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          Ver mis cotizaciones
        </Link>
      </div>
    </div>
  );
}
