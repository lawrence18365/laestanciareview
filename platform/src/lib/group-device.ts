import { cookies } from 'next/headers';
import { hmacSign } from './session';
import { timingSafeEqual } from './timing';
import { listGroupAccounts } from './queries';

/**
 * rt_group: a signed "this device belongs to group X" marker. It is the only
 * thing that unlocks the login dropdown, and the dropdown is the only place
 * that lists accounts, so an unmarked (or forged) request never sees a list.
 * Signed with the session key under its own prefix; value is `groupKey:hmac`.
 */
export const GROUP_COOKIE = 'rt_group';
const ONE_YEAR = 365 * 24 * 60 * 60; // seconds
const PREFIX = 'ratetap-group-device-v1:';

export async function signGroupMarker(groupKey: string): Promise<string> {
  return `${groupKey}:${await hmacSign(PREFIX + groupKey)}`;
}

/** The group_key inside a marker, or null when it is missing or not validly signed. */
export async function verifyGroupMarker(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const i = value.lastIndexOf(':');
  if (i <= 0) return null;
  const groupKey = value.slice(0, i);
  const expected = await hmacSign(PREFIX + groupKey);
  return timingSafeEqual(value.slice(i + 1), expected) ? groupKey : null;
}

/** Remember this device as belonging to the group. Logout never clears it. */
export async function setGroupMarker(groupKey: string): Promise<void> {
  const jar = await cookies();
  jar.set(GROUP_COOKIE, await signGroupMarker(groupKey), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
  });
}

/** The group this device is marked for (valid signature only), else null. */
export async function getKnownGroupKey(): Promise<string | null> {
  const jar = await cookies();
  return verifyGroupMarker(jar.get(GROUP_COOKIE)?.value);
}

/**
 * The accounts to offer in the login/forgot-password dropdown, or null for a
 * device with no valid marker (or a group with no accounts): those get the
 * text field. The marker check happens before any account query.
 */
export async function getKnownGroupAccounts(): Promise<Array<{ name: string; slug: string }> | null> {
  const groupKey = await getKnownGroupKey();
  if (!groupKey) return null;
  const accounts = await listGroupAccounts(groupKey);
  return accounts.length > 0 ? accounts : null;
}
