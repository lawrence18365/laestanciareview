'use client';

import { useEffect, useState } from 'react';
import { meseroUrlFor } from '@/lib/qr';

interface Props {
  slug: string;
  member: { name: string; code: string };
  onClose: () => void;
}

export default function MeseroQrModal({ slug, member, onClose }: Props) {
  const url = meseroUrlFor(slug, member.code);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Lazy-load the QR encoder only when the modal opens.
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((m) =>
        m.default.toDataURL(url, {
          errorCorrectionLevel: 'H',
          margin: 1,
          width: 512,
          color: { dark: '#111111', light: '#FFFFFF' },
        }),
      )
      .then((d) => alive && setQr(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — link is still visible to copy manually */
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-dark)',
          borderRadius: 0,
          padding: '1.5rem',
          width: '100%',
          maxWidth: 340,
          textAlign: 'center',
        }}
      >
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.05rem', margin: 0, color: 'var(--text-main)' }}>
          {member.name}
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 1rem' }}>
          Tablero personal · código {member.code}
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', minHeight: 200, alignItems: 'center' }}>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`QR de ${member.name}`} style={{ width: 200, height: 200 }} />
          ) : (
            <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Generando QR…</span>
          )}
        </div>

        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
            margin: '0.75rem 0 1rem',
          }}
        >
          {url}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={copy} style={btn}>
            {copied ? '¡Copiado!' : 'Copiar enlace'}
          </button>
          {qr && (
            <a href={qr} download={`tablero-${member.code}.png`} style={{ ...btn, textDecoration: 'none' }}>
              Descargar QR
            </a>
          )}
          <button onClick={onClose} style={{ ...btn, background: 'var(--panel-bg)', color: 'var(--text-main)', border: '1px solid var(--border-dark)' }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: 'none',
  background: 'var(--text-main)',
  color: 'var(--panel-bg)',
  fontWeight: 700,
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 0,
};
