import { describe, expect, it } from 'vitest';
import { classifyPushDevice } from '@/lib/push-device';

describe('classifyPushDevice', () => {
  const iosUserAgent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

  it('distinguishes an installed iOS PWA from iOS Safari', () => {
    expect(classifyPushDevice(iosUserAgent, 'standalone')).toBe('ios_pwa');
    expect(classifyPushDevice(iosUserAgent, 'browser')).toBe('ios_safari');
  });

  it('classifies Android and desktop browsers', () => {
    expect(classifyPushDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(classifyPushDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'desktop',
    );
  });

  it('uses unknown when no user agent can be parsed', () => {
    expect(classifyPushDevice(null)).toBe('unknown');
    expect(classifyPushDevice('   ')).toBe('unknown');
  });
});
