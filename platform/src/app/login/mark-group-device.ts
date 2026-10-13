'use server';

import { verifySession } from '@/lib/session';
import { getGroupKeyBySlug } from '@/lib/queries';
import { getKnownGroupKey, setGroupMarker } from '@/lib/group-device';

/**
 * Server components cannot set cookies, so the logged-in app layout calls this
 * (via GroupDeviceMarker) on a group account's device that has no valid marker
 * yet. Needs a valid session; marks the device for that account's own group
 * only, and does nothing when the marker is already right.
 */
export async function markGroupDevice(): Promise<void> {
  const session = await verifySession();
  if (!session) return;
  const groupKey = await getGroupKeyBySlug(session.slug);
  if (!groupKey) return;
  if ((await getKnownGroupKey()) === groupKey) return;
  await setGroupMarker(groupKey);
}
