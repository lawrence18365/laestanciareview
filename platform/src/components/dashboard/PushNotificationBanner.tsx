'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Share, Plus, X } from 'lucide-react';
import {
  getPushState,
  isInstalledPWA,
  isIOS,
  subscribeToPush,
  replaceDeviceSubscription,
  getPushSubscription,
  healPushSubscriptionIfOrphaned,
  getPushDeviceKind,
  consumePermissionRevokedEndpoint,
  reportPermissionRevoked,
  type PushHealOutcome,
  type PushSubscribeFailureReason,
  type PushSubscribeResult,
} from '@/lib/push-client';
import { conflictCopy, deniedCopy, errorCopy, unsupportedCopy } from '@/lib/push-banner-copy';
import { track } from '@/lib/analytics-client';

type BannerState =
  | 'loading'
  | 'subscribed'       // Server confirmed this device's alert registration
  | 'ios-install'      // iOS but not installed — show Add to Home Screen guide
  | 'prompt'           // Can ask for permission
  | 'denied'           // User blocked notifications
  | 'unsupported'      // Browser can't do push at all (dismissable)
  | 'conflict'         // Device's endpoint is registered to another account
  | 'error'            // Enrollment failure, carrying its reason
  | 'dismissed';       // User dismissed for this session

type ShownBannerState = 'prompt' | 'ios-install' | 'denied' | 'unsupported' | 'conflict';
type VisibleBannerState = ShownBannerState | 'error';

function isShownBannerState(state: BannerState): state is ShownBannerState {
  return (
    state === 'prompt' ||
    state === 'ios-install' ||
    state === 'denied' ||
    state === 'unsupported' ||
    state === 'conflict'
  );
}

function isVisibleBannerState(state: BannerState): state is VisibleBannerState {
  return isShownBannerState(state) || state === 'error';
}

const DISMISS_KEY = 'ratetap_push_dismissed';
const HEAL_ATTEMPT_KEY = 'ratetap_push_heal_attempted';

/** Only conclusive outcomes are stored; `failed` must retry on the next mount. */
function isStoredOutcome(value: string | null): value is PushHealOutcome {
  return value === 'healed' || value === 'not_needed' || value === 'device_conflict';
}

export default function PushNotificationBanner({ accountKey }: { accountKey: string }) {
  const [state, setState] = useState<BannerState>('loading');
  const [failure, setFailure] = useState<PushSubscribeFailureReason>('post_failed');
  const [subscribing, setSubscribing] = useState(false);
  const [deviceKind] = useState(getPushDeviceKind);
  const resolutionTracked = useRef(false);
  const healAttempted = useRef(false);

  const healStorageKey = `${HEAL_ATTEMPT_KEY}:${accountKey}`;

  const readHealOutcome = useCallback((): PushHealOutcome | null => {
    try {
      const stored = sessionStorage.getItem(healStorageKey);
      return isStoredOutcome(stored) ? stored : null;
    } catch {
      return null;
    }
  }, [healStorageKey]);

  const storeHealOutcome = useCallback(
    (outcome: PushHealOutcome) => {
      try {
        sessionStorage.setItem(healStorageKey, outcome);
      } catch {
        // The mounted-instance ref remains the fallback when storage is unavailable.
      }
    },
    [healStorageKey],
  );

  const claimHealRun = useCallback(() => {
    if (healAttempted.current) return false;
    healAttempted.current = true;
    return true;
  }, []);

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
          // On iOS, unsupported most likely means "not installed yet".
          if (active) setState(isIOS() && !isInstalledPWA() ? 'ios-install' : 'unsupported');
          return;
        }

        if (pushState === 'denied') {
          if (active) setState('denied');
          return;
        }

        if (pushState === 'granted') {
          const subscription = await getPushSubscription();
          if (!active) return;
          if (!subscription) {
            setState('prompt');
            return;
          }

          // A browser subscription is not a registration: only the server row
          // proves this account will receive alerts.
          const stored = readHealOutcome();
          if (stored === 'healed' || stored === 'not_needed') {
            setState('subscribed');
            return;
          }
          if (stored === 'device_conflict') {
            setState('conflict');
            return;
          }
          if (!claimHealRun()) {
            // This instance already asked the server; stay quiet meanwhile.
            setState('subscribed');
            return;
          }

          const outcome = await healPushSubscriptionIfOrphaned(subscription);
          if (!active) return;
          if (outcome === 'healed' || outcome === 'not_needed') {
            storeHealOutcome(outcome);
            if (outcome === 'healed') {
              track('push_subscription_healed', { device_kind: deviceKind });
            }
            setState('subscribed');
            return;
          }
          if (outcome === 'device_conflict') {
            storeHealOutcome(outcome);
            track('push_device_conflict', { device_kind: deviceKind });
            setState('conflict');
            return;
          }
          // `failed` is deliberately not stored, so the next mount retries.
          setFailure('post_failed');
          setState('error');
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
  }, [claimHealRun, deviceKind, readHealOutcome, storeHealOutcome]);

  useEffect(() => {
    if (resolutionTracked.current || state === 'loading') return;

    if (isShownBannerState(state)) {
      resolutionTracked.current = true;
      track('push_banner_shown', { state, device_kind: deviceKind });
    } else if (state === 'subscribed' || state === 'dismissed') {
      resolutionTracked.current = true;
      track('push_banner_suppressed', { state, device_kind: deviceKind });
    }
  }, [deviceKind, state]);

  const applyResult = useCallback(
    (result: PushSubscribeResult) => {
      if (result.ok) {
        setState('subscribed');
        return;
      }
      track('push_subscribe_failed', {
        reason: result.reason,
        device_kind: deviceKind,
      });
      if (result.reason === 'device_conflict') {
        track('push_device_conflict', { device_kind: deviceKind });
        setState('conflict');
        return;
      }
      const permissionDenied =
        result.reason === 'permission_denied' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'denied';
      if (permissionDenied) {
        setState('denied');
        return;
      }
      setFailure(result.reason);
      setState('error');
    },
    [deviceKind],
  );

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
      applyResult(result);
    } catch (err) {
      console.error('[push] Unexpected subscription failure:', err);
      track('push_subscribe_failed', {
        reason: 'subscribe_threw',
        device_kind: deviceKind,
      });
      setFailure('subscribe_threw');
      setState('error');
    } finally {
      setSubscribing(false);
    }
  }, [applyResult, deviceKind]);

  /** "Usar en esta cuenta": drop the foreign endpoint and register this one. */
  const handleUseOnThisAccount = useCallback(async () => {
    track('push_subscribe_click', { device_kind: deviceKind, state: 'conflict' });
    setSubscribing(true);
    try {
      const result = await replaceDeviceSubscription();
      if (result.ok) {
        storeHealOutcome('healed');
        setState('subscribed');
        return;
      }
      track('push_subscribe_failed', {
        reason: result.reason,
        device_kind: deviceKind,
      });
      setFailure(result.reason);
      setState('error');
    } catch (err) {
      console.error('[push] Unexpected device replacement failure:', err);
      track('push_subscribe_failed', {
        reason: 'subscribe_threw',
        device_kind: deviceKind,
      });
      setFailure('subscribe_threw');
      setState('error');
    } finally {
      setSubscribing(false);
    }
  }, [deviceKind, storeHealOutcome]);

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

  if (state === 'loading' || state === 'subscribed' || state === 'dismissed') {
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
      {state === 'denied' && <MessageBanner title="Notificaciones bloqueadas" body={deniedCopy(deviceKind)} />}
      {state === 'unsupported' && (
        <MessageBanner
          title="Alertas no disponibles en este navegador"
          body={unsupportedCopy(deviceKind, isInstalledPWA())}
        />
      )}
      {state === 'error' && (
        <ErrorBanner
          reason={failure}
          onRetry={handleSubscribe}
          subscribing={subscribing}
        />
      )}
      {state === 'conflict' && (
        <ConflictBanner onUseHere={handleUseOnThisAccount} subscribing={subscribing} />
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

function MessageBanner({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>{title}</div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>{body}</div>
      </div>
    </div>
  );
}

function ErrorBanner({
  reason,
  onRetry,
  subscribing,
}: {
  reason: PushSubscribeFailureReason;
  onRetry: () => void;
  subscribing: boolean;
}) {
  const copy = errorCopy(reason);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          {copy.title}
        </div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>
          {copy.body}
        </div>
      </div>
      {copy.retry && (
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
      )}
    </div>
  );
}

function ConflictBanner({
  onUseHere,
  subscribing,
}: {
  onUseHere: () => void;
  subscribing: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <Bell size={24} style={{ color: '#92400e', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontWeight: 600, color: '#78350f', fontSize: '15px' }}>
          {conflictCopy.title}
        </div>
        <div style={{ color: '#92400e', fontSize: '13px', marginTop: '2px' }}>
          {conflictCopy.body}
        </div>
      </div>
      <button
        onClick={onUseHere}
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
        {subscribing ? 'Activando...' : conflictCopy.button}
      </button>
    </div>
  );
}
