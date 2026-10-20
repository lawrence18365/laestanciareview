import { describe, expect, it } from 'vitest';
import {
  conflictCopy,
  deniedCopy,
  errorCopy,
  unsupportedCopy,
} from '@/lib/push-banner-copy';
import type { PushSubscribeFailureReason } from '@/lib/push-client';
import type { PushDeviceKind } from '@/lib/push-device';

const REASONS: PushSubscribeFailureReason[] = [
  'no_vapid_key',
  'permission_denied',
  'unsupported',
  'sw_register_failed',
  'subscribe_threw',
  'device_conflict',
  'post_failed',
];

describe('errorCopy', () => {
  it('has copy for every failure reason', () => {
    for (const reason of REASONS) {
      const copy = errorCopy(reason);
      expect(copy.title.trim(), reason).not.toBe('');
      expect(copy.body.trim(), reason).not.toBe('');
      expect(typeof copy.retry, reason).toBe('boolean');
    }
  });

  it('never blames the connection for a server-side misconfiguration', () => {
    const copy = errorCopy('no_vapid_key');

    expect(copy.title).toBe('Alertas no disponibles por ahora');
    expect(copy.body).toContain('No es un problema de tu dispositivo');
    expect(copy.retry).toBe(false);
  });

  it('offers a retry when the device accepted but the registration did not land', () => {
    const copy = errorCopy('post_failed');

    expect(copy.title).toBe('No pudimos registrar este dispositivo');
    expect(copy.body).toContain('Revisa tu conexión');
    expect(copy.retry).toBe(true);
  });

  it('offers a retry after a service worker or subscribe failure', () => {
    for (const reason of ['sw_register_failed', 'subscribe_threw'] as const) {
      const copy = errorCopy(reason);
      expect(copy.title).toBe('No se pudieron activar las alertas');
      expect(copy.body).toContain('Cierra y vuelve a abrir RateTap');
      expect(copy.retry).toBe(true);
    }
  });

  it('does not offer a pointless retry for a device conflict', () => {
    expect(errorCopy('device_conflict').retry).toBe(false);
  });
});

describe('deniedCopy', () => {
  it('points iOS users at Settings → Notifications', () => {
    for (const kind of ['ios_pwa', 'ios_safari'] as const) {
      expect(deniedCopy(kind)).toContain('Ajustes → Notificaciones → RateTap');
    }
  });

  it('points Android users at the app info screen', () => {
    expect(deniedCopy('android')).toContain('Información de la app → Notificaciones');
  });

  it('differs per device family', () => {
    const ios = deniedCopy('ios_safari');
    const android = deniedCopy('android');
    const desktop = deniedCopy('desktop');

    expect(new Set([ios, android, desktop]).size).toBe(3);
    expect(desktop).toContain('candado');
  });
});

describe('unsupportedCopy', () => {
  it('asks for an OS update on an installed iOS device', () => {
    const copy = unsupportedCopy('ios_pwa', true);
    expect(copy).toContain('16.4');
  });

  it('asks for a modern browser everywhere else', () => {
    const kinds: Array<[PushDeviceKind, boolean]> = [
      ['ios_safari', false],
      ['android', false],
      ['desktop', false],
      ['unknown', false],
    ];

    for (const [kind, installed] of kinds) {
      const copy = unsupportedCopy(kind, installed);
      expect(copy).toContain('Chrome o Safari');
      expect(copy).not.toContain('16.4');
    }
  });
});

describe('conflictCopy', () => {
  it('explains the conflict and names the action', () => {
    expect(conflictCopy.title).toBe('Este dispositivo recibe alertas de otra cuenta');
    expect(conflictCopy.body).toBe('Tócalo para recibir aquí las alertas de esta cuenta.');
    expect(conflictCopy.button).toBe('Usar en esta cuenta');
  });
});
