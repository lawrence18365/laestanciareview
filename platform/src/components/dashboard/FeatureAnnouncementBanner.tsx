'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';
import { Smartphone, X } from 'lucide-react';

const DISMISS_KEY = 'ratetap_push_announcement_dismissed';

// Only show for these restaurants during testing
const ENABLED_SLUGS = ['estancia-leon'];

function getIsDismissed() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(DISMISS_KEY) === '1';
}

const subscribe = () => () => {};

export default function FeatureAnnouncementBanner({ slug }: { slug: string }) {
  const dismissed = useSyncExternalStore(subscribe, getIsDismissed, () => true);
  const [manualDismiss, setManualDismiss] = useState(false);
  const enabled = ENABLED_SLUGS.includes(slug);
  const visible = enabled && !dismissed && !manualDismiss;

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1');
    setManualDismiss(true);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      margin: '16px 16px 0',
      padding: '20px',
      background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
      borderRadius: '14px',
      color: 'white',
      position: 'relative',
    }}>
      <button
        onClick={handleDismiss}
        aria-label="Cerrar"
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(255,255,255,0.15)',
          border: 'none',
          borderRadius: '50%',
          width: '28px',
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'white',
        }}
      >
        <X size={16} />
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Smartphone size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-block',
            padding: '2px 8px',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            marginBottom: '8px',
            textTransform: 'uppercase',
          }}>
            Nuevo
          </div>
          <h3 style={{
            margin: '0 0 6px',
            fontSize: '17px',
            fontWeight: 700,
          }}>
            Notificaciones push en tu celular
          </h3>
          <p style={{
            margin: '0',
            fontSize: '14px',
            opacity: 0.9,
            lineHeight: '1.5',
          }}>
            Ahora puedes recibir alertas instantáneas cuando un cliente deje una reseña negativa — directo en tu iPhone, como WhatsApp.
          </p>
          <p style={{
            margin: '10px 0 0',
            fontSize: '13px',
            opacity: 0.75,
            lineHeight: '1.4',
          }}>
            Activa las notificaciones con el botón amarillo abajo.
          </p>
        </div>
      </div>
    </div>
  );
}
