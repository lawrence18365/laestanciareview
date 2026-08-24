'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Share, Plus, X } from 'lucide-react';
import {
  getPushState,
  isInstalledPWA,
  isIOS,
  subscribeToPush,
  isSubscribed,
  getPushDeviceKind,
  consumePermissionRevokedEndpoint,
  reportPermissionRevoked,
} from '@/lib/push-client';
import { track } from '@/lib/analytics-client';

type BannerState =
  | 'loading'
  | 'subscribed'       // Already receiving notifications
  | 'ios-install'      // iOS but not installed — show Add to Home Screen guide
  | 'prompt'           // Can ask for permission
  | 'denied'           // User blocked notifications
  | 'error'            // Retryable enrollment failure
  | 'unsupported'      // Browser doesn't support push
  | 'dismissed';       // User dismissed for this session

type ShownBannerState = 'prompt' | 'ios-install' | 'denied';
type VisibleBannerState = ShownBannerState | 'error';

function isShownBannerState(state: BannerState): state is ShownBannerState {
  return state === 'prompt' || state === 'ios-install' || state === 'denied';
}

function isVisibleBannerState(state: BannerState): state is VisibleBannerState {
  return isShownBannerState(state) || state === 'error';
}

const DISMISS_KEY = 'ratetap_push_dismissed';

export default function PushNotificationBanner() {
  const [state, setState] = useState<BannerState>('loading');
  const [subscribing, setSubscribing] = useState(false);
  const [deviceKind] = useState(getPushDeviceKind);
  const shownTracked = useRef(false);

  useEffect(() => {
    let active = true;

    const revokedEndpoint = consumePermissionRevokedEndpoint();
    if (revokedEndpoint) {
      track('push_permission_revoked_detected', { device_kind: deviceKind });
      void reportPermissionRevoked(revokedEndpoint);
    }

    async function check() {
      try {
        // If dismissed this session, don't show
        if (sessionStorage.getItem(DISMISS_KEY)) {
          if (active) setState('dismissed');
          return;
        }

        const pushState = getPushState();

        if (pushState === 'unsupported') {
          // On iOS, unsupported likely means not installed
          if (active) setState(isIOS() ? 'ios-install' : 'unsupported');
          return;
        }

        if (pushState === 'denied') {
          if (active) setState('denied');
          return;
        }

        if (pushState === 'granted') {
          const sub = await isSubscribed();
          if (active) setState(sub ? 'subscribed' : 'prompt');
          return;
        }

        // iOS requires installation first for push
        if (isIOS() && !isInstalledPWA()) {
          if (active) setState('ios-install');
          return;
        }

        if (active) setState('prompt');
      } catch (err) {
        console.error('[push] Banner state check failed:', err);
        if (active) setState('prompt');
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, [deviceKind]);

  useEffect(() => {
    if (!shownTracked.current && isShownBannerState(state)) {
      shownTracked.current = true;
      track('push_banner_shown', { state, device_kind: deviceKind });
    }
  }, [deviceKind, state]);

  const handleSubscribe = useCallback(async () => {
    track('push_subscribe_click', { device_kind: deviceKind });
    setSubscribing(true);
    try {
      const result = await subscribeToPush();
      if (typeof Notification !== 'undefined') {
        track('push_permission_result', {
          result: Notification.permission,
          device_kind: deviceKind,
        });
      }

      if (result.ok) {
        setState('subscribed');
      } else {
        track('push_subscribe_failed', {
          reason: result.reason,
          device_kind: deviceKind,
        });
        const permissionDenied =
          result.reason === 'permission_denied' &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'denied';
        setState(permissionDenied ? 'denied' : 'error');
      }
    } catch (err) {
      console.error('[push] Unexpected subscription failure:', err);
      track('push_subscribe_failed', {
        reason: 'subscribe_threw',
        device_kind: deviceKind,
      });
      setState('error');
    } finally {
      setSubscribing(false);
    }
  }, [deviceKind]);

  const handleDismiss = useCallback(() => {
    if (isVisibleBannerState(state)) {
      track('push_banner_dismissed', { state, device_kind: deviceKind });
    }
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // The state still dismisses when session storage is unavailable.
    }
    setState('dismissed');
  }, [deviceKind, state]);

  if (state === 'loading' || state === 'subscribed' || state === 'unsupported' || state === 'dismissed') {
    return null;
  }

  return (
    <div style={{
      margin: '16px',
      padding: '16px 20px',
      background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
      borderRadius: '12px',
      border: '1px solid #f59e0b',
      position: 'relative',
    }}>
      <button
        onClick={handleDismiss}
        aria-label="Cerrar"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          color: '#92400e',
        }}
      >
        <X size={18} />
      </button>

      {state === 'ios-install' && <IOSInstallGuide />}
      {state === 'prompt' && (
        <PromptBanner onSubscribe={handleSubscribe} subscribing={subscribing} />
      )}
      {state === 'denied' && <DeniedBanner />}
      {state === 'error' && (
        <ErrorBanner onRetry={handleSubscribe} subscribing={subscribing} />
      )}
    </div>
  );
}

function PromptBanner({
  onSubscribe,
  subscribing,
}: {
  onSubscribe: () => void;
  subscribing: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          Recibe alertas instantáneas
        </div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>
          Te notificamos al instante cuando un cliente deja una reseña negativa
        </div>
      </div>
      <button
        onClick={onSubscribe}
        disabled={subscribing}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 16px',
          background: '#78350f',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: subscribing ? 'wait' : 'pointer',
          opacity: subscribing ? 0.7 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <Bell size={16} />
        {subscribing ? 'Activando...' : 'Activar Notificaciones'}
      </button>
    </div>
  );
}

function IOSInstallGuide() {
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
      }}>
        <Bell size={22} style={{ color: '#92400e' }} />
        <span style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          Activa las notificaciones push
        </span>
      </div>
      <p style={{
        color: '#92400e',
        fontSize: '13px',
        margin: '0 0 12px 0',
        lineHeight: '1.5',
      }}>
        Para recibir alertas instantáneas de reseñas negativas, primero agrega RateTap a tu pantalla de inicio:
      </p>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <Step number={1}>
          <span>Toca el botón </span>
          <Share size={16} style={{ display: 'inline', verticalAlign: 'middle', color: '#2563eb' }} />
          <span style={{ fontWeight: 600 }}> Compartir</span>
          <span> en la barra de Safari</span>
        </Step>
        <Step number={2}>
          <span>Desplázate y toca </span>
          <Plus size={16} style={{ display: 'inline', verticalAlign: 'middle', color: '#2563eb' }} />
          <span style={{ fontWeight: 600 }}> Agregar a pantalla de inicio</span>
        </Step>
        <Step number={3}>
          <span>Abre RateTap desde tu pantalla de inicio y activa notificaciones</span>
        </Step>
      </div>
    </div>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.6)',
      borderRadius: '8px',
    }}>
      <span style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        background: '#78350f',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {number}
      </span>
      <span style={{ color: '#78350f', fontSize: '14px' }}>
        {children}
      </span>
    </div>
  );
}

function DeniedBanner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          Notificaciones bloqueadas
        </div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>
          Abre Ajustes &rarr; Safari &rarr; Notificaciones y permite notificaciones para RateTap
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({
  onRetry,
  subscribing,
}: {
  onRetry: () => void;
  subscribing: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          No se pudieron activar las notificaciones
        </div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>
          Revisa tu conexión e inténtalo de nuevo
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={subscribing}
        style={{
          padding: '8px 16px',
          background: '#78350f',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: subscribing ? 'wait' : 'pointer',
          opacity: subscribing ? 0.7 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {subscribing ? 'Activando...' : 'Reintentar'}
      </button>
    </div>
  );
}
