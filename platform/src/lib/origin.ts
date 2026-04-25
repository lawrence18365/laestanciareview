/**
 * Origin/Referer check for CSRF protection on state-changing requests.
 *
 * Cookies are SameSite=Strict, but enforcement happens in the browser.
 * Validating Origin server-side gives us defence-in-depth that doesn't
 * rely on browser behaviour or the user agent honouring SameSite.
 */

function allowedHosts(): string[] {
  const hosts = new Set<string>();

  // The configured public base URL is always allowed. The env value sometimes
  // ships with a literal `\n` suffix (other call sites strip it the same way).
  const baseRaw = process.env.NEXT_PUBLIC_BASE_URL;
  if (baseRaw) {
    const base = baseRaw.replace(/\\n/g, '').trim();
    try {
      hosts.add(new URL(base).host);
    } catch {
      // ignore malformed env value
    }
  }

  // Vercel deploy host (preview + production). VERCEL_URL is bare host.
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) hosts.add(vercel);

  // Local dev — accept localhost on any port.
  if (process.env.NODE_ENV !== 'production') {
    hosts.add('localhost:3000');
    hosts.add('127.0.0.1:3000');
  }

  return [...hosts];
}

/**
 * Returns true if the request's Origin/Referer matches one of our deploy hosts.
 * Falls back to allowing requests without Origin only when Referer matches —
 * this protects against form-style CSRF without breaking server-side fetches.
 */
export function isSameOrigin(req: Request): boolean {
  const allowed = allowedHosts();

  // Local dev fallback: if no allowed host is configured at all, accept the
  // request's own host. Production must set NEXT_PUBLIC_BASE_URL.
  const hostHeader = req.headers.get('host');
  if (allowed.length === 0 && hostHeader) {
    allowed.push(hostHeader);
  }

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return allowed.includes(originHost);
    } catch {
      return false;
    }
  }

  // No Origin header (e.g. some same-origin GETs upgraded to POSTs by a buggy
  // client). Fall back to Referer.
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      return allowed.includes(refererHost);
    } catch {
      return false;
    }
  }

  // No Origin and no Referer on a state-changing request — refuse.
  return false;
}

/** Standard 403 response for CSRF rejections. */
export function csrfFailureResponse() {
  return Response.json(
    { error: 'Cross-origin request blocked' },
    { status: 403 },
  );
}

/**
 * Convenience guard: returns a Response if the request must be rejected,
 * or null if it may proceed.
 */
export function requireSameOrigin(req: Request): Response | null {
  return isSameOrigin(req) ? null : csrfFailureResponse();
}
