'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { track } from '@/lib/analytics-client';

/**
 * No-printer first step for self-serve restaurants: show the restaurant QR
 * full screen to the next guest, or send the review link by WhatsApp.
 * The copy is a plain ask: no incentive, no routing by rating (Google policy).
 */

export type QrSharePlacement = 'bienvenida' | 'qr_codes' | 'dashboard';

/** `https://wa.me/?text=` with the short neutral message and the /r/{slug} link. */
export function whatsappCustomersHref(restaurantName: string, reviewUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(t.qrShare.whatsappMessage(restaurantName, reviewUrl))}`;
}

interface WakeLockHandle {
  release: () => Promise<void>;
}
type WakeLockNavigator = { wakeLock?: { request: (type: 'screen') => Promise<WakeLockHandle> } };

/**
 * Keep the phone screen on while the QR is held up to a guest. Unsupported,
 * denied (battery saver, hidden tab) or throwing: all swallowed, the QR still
 * shows. Returns the lock, or null when there is none.
 */
export async function acquireWakeLock(
  nav: WakeLockNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Promise<WakeLockHandle | null> {
  try {
    if (!nav?.wakeLock) return null;
    return await nav.wakeLock.request('screen');
  } catch {
    return null;
  }
}

/** The full-screen view: max-size QR on white, the name, one neutral line, a close button. */
export function FullscreenQr({
  restaurantName,
  qrSrc,
  onClose,
}: {
  restaurantName: string;
  qrSrc: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    let lock: WakeLockHandle | null = null;

    async function hold() {
      const next = await acquireWakeLock();
      if (!alive) {
        // Closed while the request was pending.
        next?.release().catch(() => undefined);
        return;
      }
      lock = next;
    }
    void hold();

    // The browser drops the lock when the tab is hidden: take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void hold();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('keydown', onKey);
      lock?.release().catch(() => undefined);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={restaurantName}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#fff',
        color: '#1c1917',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '1rem',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '0.75rem',
          right: '0.75rem',
          minHeight: 44,
          minWidth: 44,
          padding: '0.5rem 1rem',
          border: '1px solid #1c1917',
          background: '#fff',
          color: '#1c1917',
          fontSize: '0.9rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {t.qrShare.close}
      </button>
      <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
        {restaurantName}
      </h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrSrc}
        alt={`Código QR de ${restaurantName}`}
        style={{
          width: 'min(88vw, 62vh)',
          height: 'min(88vw, 62vh)',
          background: '#fff',
          imageRendering: 'pixelated',
        }}
      />
      <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>{t.qrShare.fullscreenAsk}</p>
    </div>
  );
}

/** A button that opens the full-screen view and records where it was opened from. */
export function QrFullscreenButton({
  placement,
  restaurantName,
  qrSrc,
  style,
  children,
}: {
  placement: QrSharePlacement;
  restaurantName: string;
  qrSrc: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeFn = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        style={style}
        onClick={() => {
          track('qr_fullscreen_opened', { placement });
          setOpen(true);
        }}
      >
        {children ?? t.qrShare.showQr}
      </button>
      {open && <FullscreenQr restaurantName={restaurantName} qrSrc={qrSrc} onClose={closeFn} />}
    </>
  );
}
