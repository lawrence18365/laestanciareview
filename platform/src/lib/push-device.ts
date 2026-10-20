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
  maxTouchPoints?: number,
): PushDeviceKind {
  if (!userAgent?.trim()) return 'unknown';

  // iPadOS 13+ Safari requests the desktop site and sends a Macintosh UA
  // without "Mobile". A real Mac reports 0 touch points, an iPad reports 5,
  // so touch support is the only reliable separator.
  const isIpadDesktopMode =
    /Macintosh/i.test(userAgent) && (maxTouchPoints ?? 0) > 1;
  const isAppleMobile =
    isIpadDesktopMode || /iPad|iPhone|iPod|Macintosh.*Mobile/i.test(userAgent);
  if (isAppleMobile) {
    return displayMode === 'standalone' ? 'ios_pwa' : 'ios_safari';
  }
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
