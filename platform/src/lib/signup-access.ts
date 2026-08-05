export const SIGNUP_ACCESS_COOKIE = 'ratetap_signup_access';
export const SIGNUP_ACCESS_TTL_SECONDS = 24 * 60 * 60;

export function serializeSignupAccess(signupId: string, token: string): string {
  return `${signupId}.${token}`;
}

export function parseSignupAccess(value: string | null | undefined): {
  signupId: string;
  token: string;
} | null {
  if (!value) return null;
  const separator = value.indexOf('.');
  if (separator < 1) return null;

  const signupId = value.slice(0, separator);
  const token = value.slice(separator + 1);
  if (!signupId.startsWith('ps_') || !token) return null;
  return { signupId, token };
}
