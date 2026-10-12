'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cardUrlFor } from '@/lib/qr';
import { renderWaiterCard } from '@/lib/qr-card';
import { track } from '@/lib/analytics-client';

interface StaffMember {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

interface Props {
  staff: StaffMember[];
  slug: string;
  restaurantName: string;
  logo: string;
  logoDarkBg: boolean;
}

type ShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

export default function CardQrGrid({ staff, slug, restaurantName, logo, logoDarkBg }: Props) {
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // One rendered card per waiter, shared by the preview, Descargar and Compartir.
  const blobsRef = useRef(new Map<number, Blob>());

  const renderCard = useCallback(
    async (member: StaffMember): Promise<Blob> => {
      const cached = blobsRef.current.get(member.id);
      if (cached) return cached;
      const blob = await renderWaiterCard({
        url: cardUrlFor(slug, member.code),
        waiterName: member.name,
        restaurantName,
        logoSrc: logo,
        logoDarkBg,
      });
      blobsRef.current.set(member.id, blob);
      return blob;
    },
    [slug, restaurantName, logo, logoDarkBg],
  );

  // Render every card once, one at a time: each one is a 1080x1920 canvas.
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    (async () => {
      for (const member of staff) {
        try {
          const blob = await renderCard(member);
          if (!alive) break;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setPreviews((prev) => ({ ...prev, [member.id]: url }));
        } catch {
          /* leave the "Generando…" placeholder in place */
        }
      }
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [staff, renderCard]);

  // Sharing a PNG file is Chromium/Android and Safari 15+; never assume it.
  useEffect(() => {
    const nav = navigator as ShareNavigator;
    if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return;
    try {
      const probe = new File([new Blob([''], { type: 'image/png' })], 'probe.png', {
        type: 'image/png',
      });
      setCanShareFiles(nav.canShare({ files: [probe] }) === true);
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  async function download(member: StaffMember) {
    setBusyId(member.id);
    try {
      const blob = await renderCard(member);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-${member.code}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      track('card_qr_downloaded', { staff_id: member.id });
    } catch {
      /* download is best-effort */
    } finally {
      setBusyId(null);
    }
  }

  async function share(member: StaffMember) {
    const nav = navigator as ShareNavigator;
    const shareFn = nav.share;
    if (typeof shareFn !== 'function') return;
    setBusyId(member.id);
    try {
      const blob = await renderCard(member);
      const file = new File([blob], `qr-${member.code}.png`, { type: 'image/png' });
      await shareFn.call(nav, { files: [file], title: member.name });
      track('card_qr_shared', { staff_id: member.id });
    } catch {
      /* the share sheet is dismissible — silence is correct */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={sectionTitle}>Códigos QR</h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Cada mesero guarda su código y lo muestra al cliente.
          </p>
        </div>
        <a href="/qr-codes/print" target="_blank" rel="noreferrer" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
          Imprimir todos
        </a>
      </div>

      {staff.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Agrega meseros en{' '}
          <a href="/staff" style={{ color: 'var(--text-main)', fontWeight: 700 }}>
            Personal
          </a>
          .
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {staff.map((member) => (
            <div key={member.id} style={cardStyle}>
              <div
                style={{
                  width: '100%',
                  aspectRatio: '9 / 16',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-base)',
                  overflow: 'hidden',
                }}
              >
                {previews[member.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previews[member.id]}
                    alt={`Tarjeta QR de ${member.name}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Generando…</span>
                )}
              </div>

              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', textAlign: 'center' }}>
                {member.name}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {member.code}
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => download(member)} disabled={busyId === member.id} style={btnSecondary}>
                  Descargar
                </button>
                {canShareFiles && (
                  <button onClick={() => share(member)} disabled={busyId === member.id} style={btnSecondary}>
                    Compartir
                  </button>
                )}
                <a href={`/qr-codes/print?id=${member.id}`} target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                  Imprimir
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--panel-bg)',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.5rem',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1.1rem',
  fontWeight: 600,
  color: 'var(--text-main)',
  margin: 0,
};

const btnPrimary: React.CSSProperties = {
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

const btnSecondary: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  border: '1px solid var(--border-dark)',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 0,
};
