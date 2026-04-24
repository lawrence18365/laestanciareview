'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Share, Plus, X } from 'lucide-react';
import {
  getPushState,
  isInstalledPWA,
  isIOS,
  subscribeToPush,
  isSubscribed,
} from '@/lib/push-client';

type BannerState =
  | 'loading'
  | 'subscribed'       // Already receiving notifications
  | 'ios-install'      // iOS but not installed — show Add to Home Screen guide
  | 'prompt'           // Can ask for permission
  | 'denied'           // User blocked notifications
  | 'unsupported'      // Browser doesn't support push
  | 'dismissed';       // User dismissed for this session

const DISMISS_KEY = 'ratetap_push_dismissed';

export default function PushNotificationBanner({ slug: _slug }: { slug: string }) {
  const [state, setState] = useState<BannerState>('loading');
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {

    async function check() {
      // If dismissed this session, don't show
      if (sessionStorage.getItem(DISMISS_KEY)) {
        setState('dismissed');
        return;
      }

      const pushState = getPushState();

      if (pushState === 'unsupported') {
        // On iOS, unsupported likely means not installed
        if (isIOS()) {
          setState('ios-install');
        } else {
          setState('unsupported');
        }
        return;
      }

      if (pushState === 'denied') {
        setState('denied');
        return;
      }

      if (pushState === 'granted') {
        const sub = await isSubscribed();
        setState(sub ? 'subscribed' : 'prompt');
        return;
      }

      // iOS requires installation first for push
      if (isIOS() && !isInstalledPWA()) {
        setState('ios-install');
        return;
      }

      setState('prompt');
    }
    check();
  }, []);

  const handleSubscribe = useCallback(async () => {
    setSubscribing(true);
    const ok = await subscribeToPush();
    setState(ok ? 'subscribed' : 'denied');
    setSubscribing(false);
  }, []);

  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setState('dismissed');
  }, []);

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
