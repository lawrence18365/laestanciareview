/**
 * Guest review session — the per-restaurant browser cache that lets a guest who
 * tapped a star, then reloaded or re-scanned the QR, resume the
 * Google-or-private-feedback choice without a second POST /api/reviews/submit.
 *
 * WHY THIS EXISTS. The previous local guard keyed on a bare timestamp
 * (`ratetap_rated_<slug>`) and could only ever *block*: for 12 h after one
 * successful tap it replaced the stars with "ya recibimos su opinión". A reload,
 * a re-scan on the same phone, or a shared phone therefore lost the choice
 * screen even though the star POST had already created the review row and minted
 * a feedback token — the choice was recoverable, the browser just never kept it.
 * Retiring that guard does not lower the bar: the server's 3-per-device/24 h cap
 * in /api/reviews/submit is the only authoritative limit, and it is the only
 * thing that still turns a guest away.
 *
 * WHAT A SESSION IS NOT. It is evidence that a *rating* was stored — never that
 * the guest reached Google and never that they sent private feedback. A restore
 * is resumable only: both choices are offered again and the guest picks, so a
 * guest who abandoned the choice after tapping a star can still complete either
 * path. Nothing here may be read as "this guest is done".
 *
 * TTL. 12 h measured from the ORIGINAL star tap. A restore never writes, and
 * re-saving the same review never moves `createdAt` forward, so a reload loop
 * can neither extend the window nor keep a session alive forever.
 *
 * SECURITY. The stored entry contains the opaque `feedbackToken`, which is the
 * credential for /api/reviews/feedback and both chose-* routes. It lives in
 * localStorage and must NEVER reach analytics — see
 * reviewResumeAnalyticsProperties(), the only session projection allowed to be
 * logged.
 *
 * This module is dependency-free and side-effect-free on import so it can be
 * unit-tested directly and imported from a client component without pulling
 * anything into the bundle.
 */

/** Bumped whenever the stored shape changes: an old version fails closed. */
export const REVIEW_SESSION_VERSION = 1;
export const REVIEW_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A `createdAt` this far in the future is corrupt data, not clock skew. */
export const REVIEW_SESSION_FUTURE_SKEW_MS = 60 * 1000;
export const REVIEW_SESSION_STORAGE_PREFIX = 'ratetap_review_session_';
/**
 * The retired timestamp-only guard marker. Nothing reads it any more; save()
 * removes it so it cannot linger as a second, session-less way to tell a guest
 * "already received".
 */
export const LEGACY_RATED_STORAGE_PREFIX = 'ratetap_rated_';
/** Mirrors submitFeedbackSchema's min(32)/max(256) and the chose-* routes. */
export const REVIEW_SESSION_TOKEN_MIN_LENGTH = 32;
export const REVIEW_SESSION_TOKEN_MAX_LENGTH = 256;
/**
 * The stored link is assigned to `window.location.href`, so only these
 * protocols are ever handed back: a tampered entry can drop the Google choice
 * but can never become a navigation to `javascript:`/`data:`.
 */
const ALLOWED_REVIEW_LINK_PROTOCOLS = new Set(['https:', 'http:']);
const MAX_REVIEW_LINK_LENGTH = 2048;

export interface ReviewSession {
  slug: string;
  reviewId: number;
  feedbackToken: string;
  googleReviewUrl: string | null;
  rating: number;
  /** Original star-tap time. Never refreshed by a restore. */
  createdAt: number;
}

export interface ReviewSessionInput {
  slug: string;
  reviewId: number;
  feedbackToken: string;
  /** Raw value from the submit response; only http(s) survives validation. */
  googleReviewUrl: unknown;
  rating: number;
  createdAt?: number;
}

export type ReviewEntry =
  /** No usable session: show the stars and let the guest rate. */
  | { kind: 'fresh' }
  /** Re-show the Google/feedback choice for the review this guest already made. */
  | { kind: 'resume'; session: ReviewSession };

export type SubmitOutcome =
  /** Server device cap. The guest may see "already received"; no session exists. */
  | { kind: 'limited' }
  /** A review row exists and both choices must be offered (and persisted). */
  | { kind: 'choice'; session: ReviewSession }
  /** Unusable response (missing/short token, bad review id): show the retry UI. */
  | { kind: 'invalid' };

export function reviewSessionStorageKey(slug: string): string {
  return `${REVIEW_SESSION_STORAGE_PREFIX}${slug}`;
}

/**
 * localStorage, or null. Property access itself throws in some browsers
 * (blocked cookies, private mode), and a storage exception must never be more
 * than "this device cannot remember" — never an error the guest sees.
 */
function reviewStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Only http(s) links are ever returned, from anywhere. */
export function isAllowedReviewLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > MAX_REVIEW_LINK_LENGTH) return false;
  try {
    return ALLOWED_REVIEW_LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Shape + freshness validation. Returns null for anything a guest must not
 * resume from, so a corrupt, foreign, future-dated or expired entry degrades to
 * "fresh" instead of to a navigation or a second POST.
 */
function normalizeSession(
  raw: unknown,
  slug: string,
  now: number,
): ReviewSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.version !== REVIEW_SESSION_VERSION) return null;
  // Slug separation: a session stored for one restaurant never resumes another.
  if (candidate.slug !== slug) return null;

  const reviewId = candidate.reviewId;
  if (typeof reviewId !== 'number' || !Number.isInteger(reviewId) || reviewId <= 0) {
    return null;
  }

  const feedbackToken = candidate.feedbackToken;
  if (typeof feedbackToken !== 'string') return null;
  if (feedbackToken.length < REVIEW_SESSION_TOKEN_MIN_LENGTH) return null;
  if (feedbackToken.length > REVIEW_SESSION_TOKEN_MAX_LENGTH) return null;

  const rating = candidate.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating)) return null;
  if (rating < 1 || rating > 5) return null;

  const createdAt = candidate.createdAt;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }
  if (createdAt - now > REVIEW_SESSION_FUTURE_SKEW_MS) return null;
  if (now - createdAt >= REVIEW_SESSION_TTL_MS) return null;

  // A link with a disallowed protocol is dropped, not trusted — but the session
  // survives: the guest still resumes the private-feedback choice rather than
  // being pushed back to the stars (which would mean a second POST).
  const googleReviewUrl = isAllowedReviewLink(candidate.googleReviewUrl)
    ? candidate.googleReviewUrl
    : null;

  return { slug, reviewId, feedbackToken, googleReviewUrl, rating, createdAt };
}

/** Read-only: restoring never writes, so it can never extend the TTL. */
export function readReviewSession(
  slug: string,
  now: number = Date.now(),
): ReviewSession | null {
  const storage = reviewStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(reviewSessionStorageKey(slug));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return normalizeSession(parsed, slug, now);
}

/**
 * Persist a session. Returns the stored session, or null when storage is
 * unavailable or the input is not something a later read would accept (nothing
 * unusable is ever written).
 *
 * Re-saving the same review keeps the ORIGINAL `createdAt`: a restore path that
 * happens to re-save cannot roll the 12 h window forward.
 */
export function saveReviewSession(
  input: ReviewSessionInput,
  now: number = Date.now(),
): ReviewSession | null {
  const storage = reviewStorage();
  if (!storage) return null;

  const existing = readReviewSession(input.slug, now);
  const requestedAt = typeof input.createdAt === 'number' ? input.createdAt : now;
  const createdAt =
    existing && existing.reviewId === input.reviewId
      ? Math.min(existing.createdAt, requestedAt)
      : requestedAt;

  const session = normalizeSession(
    {
      version: REVIEW_SESSION_VERSION,
      slug: input.slug,
      reviewId: input.reviewId,
      feedbackToken: input.feedbackToken,
      googleReviewUrl: input.googleReviewUrl,
      rating: input.rating,
      createdAt,
    },
    input.slug,
    now,
  );
  if (!session) return null;

  try {
    storage.setItem(
      reviewSessionStorageKey(session.slug),
      JSON.stringify({ version: REVIEW_SESSION_VERSION, ...session }),
    );
    try {
      storage.removeItem(`${LEGACY_RATED_STORAGE_PREFIX}${session.slug}`);
    } catch {
      // Leaving a dead marker behind is harmless: nothing reads it any more.
    }
    return session;
  } catch {
    // Quota/private mode: the guest keeps the choice for this page view and the
    // server device cap stays the only limit on a later tap.
    return null;
  }
}

/**
 * The decision the review screen mounts on, taken BEFORE any repeat UI: a valid
 * session resumes the existing review (no second POST, both choices); anything
 * else shows the stars.
 */
export function resolveReviewEntry(
  slug: string,
  now: number = Date.now(),
): ReviewEntry {
  const session = readReviewSession(slug, now);
  return session ? { kind: 'resume', session } : { kind: 'fresh' };
}

/**
 * Map a parsed POST /api/reviews/submit response onto what the guest sees.
 *
 * `limited:true` is the server's own cap and is terminal for this phone: show
 * "ya recibimos su opinión" and create NO session — there is no review row to
 * resume, and a session here would fake one.
 */
export function resolveSubmitOutcome(
  data: unknown,
  context: { slug: string; rating: number },
  now: number = Date.now(),
): SubmitOutcome {
  if (!data || typeof data !== 'object') return { kind: 'invalid' };
  const payload = data as Record<string, unknown>;

  if (payload.limited === true) return { kind: 'limited' };

  const session = normalizeSession(
    {
      version: REVIEW_SESSION_VERSION,
      slug: context.slug,
      reviewId: payload.reviewId,
      feedbackToken: payload.feedbackToken,
      googleReviewUrl: payload.googleReviewUrl ?? null,
      rating: context.rating,
      createdAt: now,
    },
    context.slug,
    now,
  );
  if (!session) return { kind: 'invalid' };

  return { kind: 'choice', session };
}

/**
 * The ONLY projection of a session that analytics may ever see. The feedback
 * token is the credential for the feedback and chose-* routes; it is written to
 * localStorage and nowhere else.
 */
export function reviewResumeAnalyticsProperties(session: ReviewSession): {
  resumed: true;
  rating: number;
  review_id: number;
  has_google_link: boolean;
} {
  return {
    resumed: true,
    rating: session.rating,
    review_id: session.reviewId,
    has_google_link: session.googleReviewUrl !== null,
  };
}
