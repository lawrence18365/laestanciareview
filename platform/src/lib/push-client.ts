'use client';

import {
  classifyPushDevice,
  type PushDeviceKind,
} from '@/lib/push-device';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
const SERVICE_WORKER_READY_TIMEOUT_MS = 5_000;
const REMEMBERED_PUSH_ENDPOINT_KEY = 'ratetap_push_endpoint';

export type PushSubscribeFailureReason =
  | 'no_vapid_key'
  | 'permission_denied'
  | 'sw_register_failed'
  | 'subscribe_threw'
  | 'post_failed';

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: PushSubscribeFailureReason };

type PushPersistenceResult =
  | { ok: true }
  | { ok: false; reason: 'device_conflict' | 'failed' };

export type PushHealOutcome =
  | 'not_needed'
  | 'healed'
  | 'device_conflict'
  | 'failed';

function rememberPushEndpoint(endpoint: string): void {
  try {
    window.localStorage.setItem(REMEMBERED_PUSH_ENDPOINT_KEY, endpoint);
  } catch {
    // Private browsing and storage policies must not break enrollment.
  }
}

function clearRememberedPushEndpoint(): void {
  try {
    window.localStorage.removeItem(REMEMBERED_PUSH_ENDPOINT_KEY);
  } catch {
    // Storage cleanup is best-effort.
  }
}

function getRememberedPushEndpoint(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_PUSH_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

/**
 * Atomically consume a previously enrolled endpoint when browser permission is
 * no longer granted. Consuming before reporting makes reconciliation one-shot.
 */
export function consumePermissionRevokedEndpoint(): string | null {
  if (
    typeof window === 'undefined' ||
    typeof Notification === 'undefined' ||
    Notification.permission === 'granted'
  ) {
    return null;
  }

  try {
    const endpoint = window.localStorage.getItem(REMEMBERED_PUSH_ENDPOINT_KEY);
    if (!endpoint) return null;
    window.localStorage.removeItem(REMEMBERED_PUSH_ENDPOINT_KEY);
    return endpoint;
  } catch {
    return null;
  }
}

/** Report a detected permission revocation without throwing into the banner. */
export async function reportPermissionRevoked(endpoint: string): Promise<void> {
  try {
    const response = await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, reason: 'permission_revoked' }),
    });
    if (!response.ok) {
      console.error(
        '[push] Permission revocation reconciliation failed with status:',
        response.status,
      );
    }
  } catch (err) {
    console.error('[push] Permission revocation reconciliation failed:', err);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Check if the device supports push and has granted permission. */
export function getPushState(): 'unsupported' | 'prompt' | 'granted' | 'denied' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
}

/** Check if the app is running as an installed PWA (standalone mode). */
export function isInstalledPWA(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

/** Check if the device is iOS. */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const kind = getPushDeviceKind();
  return kind === 'ios_pwa' || kind === 'ios_safari';
}

/** Device family used consistently by enrollment and banner analytics. */
export function getPushDeviceKind(): PushDeviceKind {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unknown';
  return classifyPushDevice(
    navigator.userAgent,
    isInstalledPWA() ? 'standalone' : 'browser',
  );
}

async function serviceWorkerReadyWithTimeout(): Promise<ServiceWorkerRegistration> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Service worker readiness timed out')),
          SERVICE_WORKER_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function postPushSubscription(
  subscription: PushSubscription,
): Promise<PushPersistenceResult> {
  const json = subscription.toJSON();
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      display_mode: isInstalledPWA() ? 'standalone' : 'browser',
    }),
  });
  if (!response.ok) {
    if (response.status === 409) {
      try {
        const result: unknown = await response.json();
        if (
          result &&
          typeof result === 'object' &&
          (result as { code?: unknown }).code === 'push_device_conflict'
        ) {
          return { ok: false, reason: 'device_conflict' };
        }
      } catch {
        // A malformed conflict response is a normal persistence failure.
      }
    }
    return { ok: false, reason: 'failed' };
  }

  rememberPushEndpoint(subscription.endpoint);
  return { ok: true };
}

/** Register SW and subscribe to push notifications. Sends subscription to server. */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[push] Missing public VAPID key, skipping browser subscription');
    return { ok: false, reason: 'no_vapid_key' };
  }

  let registration: ServiceWorkerRegistration;
  try {
    const registered = await navigator.serviceWorker.register('/sw.js');
    registration = registered.active ? registered : await serviceWorkerReadyWithTimeout();
  } catch (err) {
    console.error('[push] Service worker registration failed:', err);
    return { ok: false, reason: 'sw_register_failed' };
  }

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    console.error('[push] Permission request failed:', err);
    return { ok: false, reason: 'subscribe_threw' };
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
    });
  } catch (err) {
    console.error('[push] Browser subscription failed:', err);
    return { ok: false, reason: 'subscribe_threw' };
  }

  try {
    const persisted = await postPushSubscription(subscription);
    if (!persisted.ok) {
      return { ok: false, reason: 'post_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[push] Subscription persistence failed:', err);
    return { ok: false, reason: 'post_failed' };
  }
}

/** Unsubscribe from push notifications. */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const rememberedEndpoint = getRememberedPushEndpoint();
    let subscription: PushSubscription | null = null;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
    } catch (err) {
      if (!rememberedEndpoint) throw err;
      console.warn(
        '[push] Browser subscription lookup failed; revoking remembered server endpoint:',
        err,
      );
    }

    const endpoint = subscription?.endpoint ?? rememberedEndpoint;
    if (!endpoint) {
      clearRememberedPushEndpoint();
      return true;
    }

    const response = await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        reason: 'user_unsubscribe',
      }),
    });
    if (!response.ok) return false;

    clearRememberedPushEndpoint();
    if (!subscription) return true;
    try {
      const unsubscribed = await subscription.unsubscribe();
      if (!unsubscribed) {
        console.error(
          '[push] Browser unsubscribe returned false after server revocation; browser subscription may remain active',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error(
        '[push] Browser unsubscribe failed after server revocation; browser subscription remains active:',
        err,
      );
      return false;
    }
  } catch (err) {
    console.error('[push] Unsubscribe failed:', err);
    return false;
  }
}

/** Read the browser's current subscription without waiting on SW.ready. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Check if already subscribed. */
export async function isSubscribed(): Promise<boolean> {
  return (await getPushSubscription()) !== null;
}

/**
 * Restore a missing server row for an existing browser subscription. The
 * result distinguishes account ownership conflicts from ordinary failures so
 * callers can record the refusal without retrying or changing the UI.
 */
export async function healPushSubscriptionIfOrphaned(
  subscription: PushSubscription,
): Promise<PushHealOutcome> {
  try {
    const query = new URLSearchParams({ endpoint: subscription.endpoint });
    const response = await fetch(`/api/push/subscribe?${query.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) return 'failed';

    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== 'object' ||
      typeof (result as { active?: unknown }).active !== 'boolean'
    ) {
      return 'failed';
    }
    if ((result as { active: boolean }).active) return 'not_needed';

    const persisted = await postPushSubscription(subscription);
    if (persisted.ok) return 'healed';
    return persisted.reason === 'device_conflict' ? 'device_conflict' : 'failed';
  } catch {
    return 'failed';
  }
}
