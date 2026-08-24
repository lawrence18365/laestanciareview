export type PushDeviceKind =
  | 'ios_pwa'
  | 'ios_safari'
  | 'android'
  | 'desktop'
  | 'unknown';

export type PushDisplayMode = 'browser' | 'standalone';

/** Classify the browser family without retaining more than the caller-provided UA. */
export function classifyPushDevice(
  userAgent: string | null | undefined,
  displayMode: PushDisplayMode = 'browser',
): PushDeviceKind {
  if (!userAgent?.trim()) return 'unknown';

  const isAppleMobile = /iPad|iPhone|iPod|Macintosh.*Mobile/i.test(userAgent);
  if (isAppleMobile) {
    return displayMode === 'standalone' ? 'ios_pwa' : 'ios_safari';
  }
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
