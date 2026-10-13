'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cardUrlFor, reviewUrlFor } from '@/lib/qr';
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
  /** PNG data URL of the restaurant's own review QR. */
  restaurantQr: string;
  /** 'solo' hides the waiter grid; NULL/'team' keep it exactly as before. */
  teamMode: string | null;
}

type ShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

export default function CardQrGrid({
  staff,
  slug,
  restaurantName,
  logo,
  logoDarkBg,
  restaurantQr,
  teamMode,
}: Props) {
  const solo = teamMode === 'solo';
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
  // Previews are data URLs, not object URLs: there is nothing to revoke, so a
  // cleanup can never leave the <img> pointing at a dead blob (on iPhone Safari
  // that showed as an empty box with the alt text).
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const member of staff) {
        try {
          const blob = await renderCard(member);
          if (!alive) break;
          const dataUrl = await blobToDataUrl(blob);
          if (!alive) break;
          setPreviews((prev) => ({ ...prev, [member.id]: dataUrl }));
        } catch {
          /* leave the "Generando…" placeholder in place */
        }
      }
    })();
    return () => {
      alive = false;
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

  function downloadRestaurantQr() {
    try {
      const a = document.createElement('a');
      a.href = restaurantQr;
      a.download = `qr-${slug}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      track('restaurant_qr_downloaded');
    } catch {
      /* download is best-effort */
    }
  }

  // The share sheet carries the PNG when the browser can; otherwise a plain
  // WhatsApp link with the review URL. Either way: a plain ask, no incentive.
  async function shareRestaurantQr() {
    const text = `${restaurantName}: ¿Cómo te fue? Déjanos tu reseña en Google ${reviewUrlFor(slug)}`;
    const nav = navigator as ShareNavigator;
    try {
      if (canShareFiles && typeof nav.share === 'function') {
        const blob = await (await fetch(restaurantQr)).blob();
        const file = new File([blob], `qr-${slug}.png`, { type: 'image/png' });
        await nav.share.call(nav, { files: [file], text, title: restaurantName });
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
      track('restaurant_qr_shared');
    } catch {
      /* the share sheet is dismissible — silence is correct */
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
          {!solo && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Cada mesero guarda su código y lo muestra al cliente.
            </p>
          )}
        </div>
        {!solo && (
          <a href="/qr-codes/print" target="_blank" rel="noreferrer" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
            Imprimir todos
          </a>
        )}
      </div>

      <div style={{ ...cardStyle, marginTop: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={restaurantQrThumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={restaurantQr}
            alt={`Código QR de ${restaurantName}`}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>
        <div style={infoStyle}>
          <div style={nameStyle}>{restaurantName}</div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <a
              href="/qr-codes/letrero"
              target="_blank"
              rel="noreferrer"
              style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}
            >
              Imprimir letrero
            </a>
            <button onClick={downloadRestaurantQr} style={btnSecondary}>
              Descargar PNG
            </button>
            <button onClick={shareRestaurantQr} style={btnSecondary}>
              Compartir por WhatsApp
            </button>
          </div>
        </div>
      </div>

      {solo ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          ¿Contratas meseros? Agrégalos en{' '}
          <a href="/staff" style={{ color: 'var(--text-main)', fontWeight: 700 }}>
            Personal
          </a>
          .
        </p>
      ) : staff.length === 0 ? (
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {staff.map((member) => (
            <div key={member.id} style={cardStyle}>
              <div style={thumbStyle}>
                {previews[member.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previews[member.id]}
                    alt={`Tarjeta QR de ${member.name}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>Generando…</span>
                )}
              </div>

              <div style={infoStyle}>
                <div style={nameStyle}>{member.name}</div>
                <div style={codeStyle}>{member.code}</div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A horizontal tile on every screen size: a 96px thumbnail on the left, the
// waiter's name/code and actions on the right. A full-width 9:16 preview used
// to fill a phone screen and push the buttons below the fold.
const cardStyle: React.CSSProperties = {
  background: 'var(--panel-bg)',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '1rem',
};

const thumbStyle: React.CSSProperties = {
  width: '96px',
  flex: '0 0 96px',
  aspectRatio: '9 / 16',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-base)',
  overflow: 'hidden',
};

const restaurantQrThumb: React.CSSProperties = {
  width: '112px',
  flex: '0 0 112px',
  aspectRatio: '1 / 1',
  background: '#fff',
  overflow: 'hidden',
};

const infoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.4rem',
};

const nameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--text-main)',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
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

/** Read a rendered Blob as a data URL — unlike an object URL, nothing to revoke. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('FileReader did not return a data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
