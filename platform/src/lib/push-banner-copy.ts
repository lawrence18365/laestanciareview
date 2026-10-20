import type { PushSubscribeFailureReason } from '@/lib/push-client';
import type { PushDeviceKind } from '@/lib/push-device';

/**
 * Banner copy for push-alert enrollment. Pure and dependency-free so the
 * wording is testable without a browser: every failure used to render the same
 * "Revisa tu conexión" line, which is wrong for a missing VAPID key (not the
 * device's problem), for a 409 device conflict (the device is registered to
 * another account) and for a service worker that never came up.
 */

export interface PushErrorCopy {
  title: string;
  body: string;
  /** Whether the same tap can plausibly succeed — controls the retry button. */
  retry: boolean;
}

export function errorCopy(reason: PushSubscribeFailureReason): PushErrorCopy {
  switch (reason) {
    case 'no_vapid_key':
      return {
        title: 'Alertas no disponibles por ahora',
        body: 'Avísale a RateTap. No es un problema de tu dispositivo.',
        retry: false,
      };
    case 'post_failed':
      return {
        title: 'No pudimos registrar este dispositivo',
        body: 'Tu dispositivo aceptó, pero el registro no llegó. Revisa tu conexión y reintenta.',
        retry: true,
      };
    case 'sw_register_failed':
    case 'subscribe_threw':
      return {
        title: 'No se pudieron activar las alertas',
        body: 'Cierra y vuelve a abrir RateTap desde su ícono y reintenta.',
        retry: true,
      };
    // These three normally have their own banner states; the copy here is the
    // fallback if one is ever rendered through the generic error state.
    case 'permission_denied':
      return {
        title: 'Notificaciones bloqueadas',
        body: 'Permite las notificaciones para RateTap y vuelve a intentarlo.',
        retry: false,
      };
    case 'unsupported':
      return {
        title: 'Este navegador no admite alertas',
        body: 'Abre RateTap en Chrome o Safari actualizados.',
        retry: false,
      };
    case 'device_conflict':
      return {
        title: 'Este dispositivo recibe alertas de otra cuenta',
        body: 'Actívalo en esta cuenta para recibir aquí las alertas.',
        retry: false,
      };
  }
}

/** How to re-enable notifications after the permission was denied. */
export function deniedCopy(kind: PushDeviceKind): string {
  switch (kind) {
    case 'ios_pwa':
    case 'ios_safari':
      return 'Abre Ajustes → Notificaciones → RateTap y activa «Permitir notificaciones».';
    case 'android':
      return 'Mantén presionado el ícono de RateTap → Información de la app → Notificaciones y actívalas.';
    default:
      return 'Haz clic en el candado junto a la dirección web y permite las notificaciones.';
  }
}

/** Why push cannot work here, and what would make it work. */
export function unsupportedCopy(kind: PushDeviceKind, installed: boolean): string {
  const isIOSDevice = kind === 'ios_pwa' || kind === 'ios_safari';
  if (isIOSDevice && installed) {
    return 'Actualiza tu iPhone o iPad a iOS 16.4 o superior para recibir alertas.';
  }
  return 'Este navegador no admite alertas. Abre RateTap en Chrome o Safari actualizados.';
}

/** The device's endpoint belongs to another account; it can be moved here. */
export const conflictCopy = {
  title: 'Este dispositivo recibe alertas de otra cuenta',
  body: 'Tócalo para recibir aquí las alertas de esta cuenta.',
  button: 'Usar en esta cuenta',
} as const;
