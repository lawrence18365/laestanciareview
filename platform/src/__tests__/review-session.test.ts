/**
 * Guest review session (src/lib/review-session.ts).
 *
 * Pins the whole local contract the review screen mounts on: the session's
 * shape, the 12 h TTL measured from the ORIGINAL star tap, slug separation,
 * link-protocol allow-listing, and every way storage can misbehave. The point of
 * the module is that a guest who taps a star and then reloads resumes the
 * existing review instead of POSTing a second one — so "a restore writes nothing
 * and calls nothing" is a load-bearing assertion here, not a detail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_RATED_STORAGE_PREFIX,
  REVIEW_SESSION_STORAGE_PREFIX,
  REVIEW_SESSION_TTL_MS,
  REVIEW_SESSION_VERSION,
  isAllowedReviewLink,
  readReviewSession,
  resolveReviewEntry,
  resolveSubmitOutcome,
  reviewResumeAnalyticsProperties,
  reviewSessionStorageKey,
  saveReviewSession,
  type ReviewSession,
} from '@/lib/review-session';

const SLUG = 'la-estancia';
const OTHER_SLUG = 'estancia-leon';
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 chars, like randomToken()
const LINK = 'https://g.page/r/example/review';
const NOW = 1_700_000_000_000;
/** One minute before "now": fresh, but not suspiciously future-dated. */
const TAPPED_AT = NOW - 60_000;
const HOUR = 60 * 60 * 1000;

function createStorage(options: { getItemThrows?: boolean; setItemThrows?: boolean } = {}) {
  const items = new Map<string, string>();
  const getItem = vi.fn((key: string): string | null => {
    if (options.getItemThrows) throw new Error('SecurityError');
    return items.has(key) ? (items.get(key) as string) : null;
  });
  const setItem = vi.fn((key: string, value: string): void => {
    if (options.setItemThrows) throw new Error('QuotaExceededError');
    items.set(key, value);
  });
  const removeItem = vi.fn((key: string): void => {
    items.delete(key);
  });
  const storage = {
    get length() {
      return items.size;
    },
    clear: vi.fn(() => items.clear()),
    key: vi.fn((index: number) => [...items.keys()][index] ?? null),
    getItem,
    setItem,
    removeItem,
  } as unknown as Storage;

  return { items, storage, getItem, setItem, removeItem };
}

function installWindow(localStorage: unknown): void {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  });
}

function installWindowWithThrowingStorage(): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      get localStorage(): Storage {
        throw new Error('access denied');
      },
    },
    configurable: true,
    writable: true,
  });
}

function installSession(storage: Storage, raw: string): void {
  storage.setItem(reviewSessionStorageKey(SLUG), raw);
}

/** A raw stored entry, exactly as it would sit in localStorage. */
function storedEntry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: REVIEW_SESSION_VERSION,
    slug: SLUG,
    reviewId: 42,
    feedbackToken: TOKEN,
    googleReviewUrl: LINK,
    rating: 5,
    createdAt: TAPPED_AT,
    ...overrides,
  });
}

function validSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    slug: SLUG,
    reviewId: 42,
    feedbackToken: TOKEN,
    googleReviewUrl: LINK,
    rating: 5,
    createdAt: TAPPED_AT,
    ...overrides,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('review session storage key', () => {
  it('is namespaced per restaurant', () => {
    expect(reviewSessionStorageKey(SLUG)).toBe(`${REVIEW_SESSION_STORAGE_PREFIX}${SLUG}`);
    expect(reviewSessionStorageKey(SLUG)).not.toBe(reviewSessionStorageKey(OTHER_SLUG));
  });
});

describe('readReviewSession', () => {
  it('resumes a session stored for the same slug', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry());

    expect(readReviewSession(SLUG, NOW)).toEqual(validSession());
  });

  it('never resumes one restaurant from another restaurant entry', () => {
    const { storage } = createStorage();
    installWindow(storage);

    // Written under the other slug's key, and carrying the other slug inside.
    storage.setItem(reviewSessionStorageKey(OTHER_SLUG), storedEntry({ slug: OTHER_SLUG }));
    installSession(storage, storedEntry({ slug: OTHER_SLUG }));

    expect(readReviewSession(SLUG, NOW)).toBeNull();
    expect(readReviewSession('a-third-restaurant', NOW)).toBeNull();
    expect(readReviewSession(OTHER_SLUG, NOW)).toEqual(validSession({ slug: OTHER_SLUG }));
  });

  it.each([
    ['not JSON at all', 'not json{'],
    ['an empty payload', ''],
    ['a JSON null', 'null'],
    ['an array', '[]'],
    ['a JSON string', '"ratetap"'],
    ['a bare number', '1700000000000'],
  ])('rejects %s', (_label, raw) => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, raw);

    expect(readReviewSession(SLUG, NOW)).toBeNull();
  });

  const structurallyInvalid: Array<[string, Record<string, unknown>]> = [
    ['an unknown version', { version: REVIEW_SESSION_VERSION + 1 }],
    ['a missing version', { version: undefined }],
    ['a zero review id', { reviewId: 0 }],
    ['a negative review id', { reviewId: -7 }],
    ['a non-integer review id', { reviewId: 42.5 }],
    ['a string review id', { reviewId: '42' }],
    ['a missing token', { feedbackToken: undefined }],
    ['a truncated token', { feedbackToken: 'a'.repeat(31) }],
    ['an oversized token', { feedbackToken: 'a'.repeat(257) }],
    ['a rating below 1', { rating: 0 }],
    ['a rating above 5', { rating: 6 }],
    ['a non-integer rating', { rating: 4.5 }],
    ['a non-numeric rating', { rating: '5' }],
    ['a missing createdAt', { createdAt: undefined }],
    ['a NaN createdAt', { createdAt: Number.NaN }],
    ['a zero createdAt', { createdAt: 0 }],
    ['a string createdAt', { createdAt: '1700000000000' }],
  ];

  for (const [label, overrides] of structurallyInvalid) {
    it(`rejects a structurally invalid session: ${label}`, () => {
      const { storage } = createStorage();
      installWindow(storage);
      installSession(storage, storedEntry(overrides));

      expect(readReviewSession(SLUG, NOW)).toBeNull();
    });
  }

  it('rejects a session dated in the future', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry({ createdAt: NOW + HOUR }));

    expect(readReviewSession(SLUG, NOW)).toBeNull();
  });

  it('tolerates small clock skew rather than dropping a real session', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry({ createdAt: NOW + 30_000 }));

    expect(readReviewSession(SLUG, NOW)).not.toBeNull();
  });

  it('rejects an expired session, and keeps one that is a millisecond inside the window', () => {
    const { storage } = createStorage();
    installWindow(storage);

    installSession(storage, storedEntry({ createdAt: NOW - REVIEW_SESSION_TTL_MS }));
    expect(readReviewSession(SLUG, NOW)).toBeNull();

    installSession(storage, storedEntry({ createdAt: NOW - REVIEW_SESSION_TTL_MS + 1 }));
    expect(readReviewSession(SLUG, NOW)).not.toBeNull();
  });

  it('returns null instead of throwing when there is no window at all (server render)', () => {
    expect(readReviewSession(SLUG, NOW)).toBeNull();
    expect(resolveReviewEntry(SLUG, NOW)).toEqual({ kind: 'fresh' });
  });
});

describe('google review link protocol', () => {
  it.each(['https://g.page/r/example/review', 'http://g.page/r/example/review'])(
    'allows the %s link',
    (value) => {
      expect(isAllowedReviewLink(value)).toBe(true);
    },
  );

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/review',
    '/r/la-estancia',
    '',
  ])('rejects %s', (value) => {
    expect(isAllowedReviewLink(value)).toBe(false);
  });

  it.each([42, null, undefined, {}, ['https://g.page/r/example/review']])(
    'rejects the non-string link %o',
    (value) => {
      expect(isAllowedReviewLink(value)).toBe(false);
    },
  );

  it('drops a disallowed link but keeps the session, so the guest still resumes', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry({ googleReviewUrl: 'javascript:alert(1)' }));

    const session = readReviewSession(SLUG, NOW);
    expect(session).toEqual(validSession({ googleReviewUrl: null }));
    // The private-feedback choice survives: the credential is untouched.
    expect(session?.feedbackToken).toBe(TOKEN);
  });

  it('keeps an http(s) link unchanged', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry({ googleReviewUrl: LINK }));

    expect(readReviewSession(SLUG, NOW)?.googleReviewUrl).toBe(LINK);
  });
});

describe('unavailable or throwing storage', () => {
  it('degrades to "fresh" — never throws — when localStorage is missing', () => {
    installWindow(undefined);

    expect(readReviewSession(SLUG, NOW)).toBeNull();
    expect(saveReviewSession({ ...validSession(), googleReviewUrl: LINK }, NOW)).toBeNull();
  });

  it('degrades to "fresh" when reading the localStorage property itself throws', () => {
    installWindowWithThrowingStorage();

    expect(() => readReviewSession(SLUG, NOW)).not.toThrow();
    expect(readReviewSession(SLUG, NOW)).toBeNull();
    expect(resolveReviewEntry(SLUG, NOW)).toEqual({ kind: 'fresh' });
  });

  it('degrades to "fresh" when getItem throws', () => {
    const { storage } = createStorage({ getItemThrows: true });
    installWindow(storage);

    expect(readReviewSession(SLUG, NOW)).toBeNull();
  });

  it('gives up quietly when setItem throws (quota, private mode)', () => {
    const { storage, items } = createStorage({ setItemThrows: true });
    installWindow(storage);
    const input = { ...validSession(), googleReviewUrl: LINK };

    expect(() => saveReviewSession(input, NOW)).not.toThrow();
    expect(saveReviewSession(input, NOW)).toBeNull();
    expect(items.size).toBe(0);
  });
});

describe('saveReviewSession', () => {
  it('writes a session a later read accepts', () => {
    const { storage, setItem } = createStorage();
    installWindow(storage);

    const saved = saveReviewSession(
      { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 4 },
      NOW,
    );

    expect(saved).toEqual(validSession({ rating: 4, createdAt: NOW }));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readReviewSession(SLUG, NOW)).toEqual(validSession({ rating: 4, createdAt: NOW }));
  });

  it('never persists something a read would reject, so no dead entry is left behind', () => {
    const { storage, setItem } = createStorage();
    installWindow(storage);

    expect(
      saveReviewSession(
        { slug: SLUG, reviewId: 42, feedbackToken: 'too-short', googleReviewUrl: LINK, rating: 5 },
        NOW,
      ),
    ).toBeNull();
    expect(
      saveReviewSession(
        { slug: SLUG, reviewId: 0, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 5 },
        NOW,
      ),
    ).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(readReviewSession(SLUG, NOW)).toBeNull();
  });

  it('stores a disallowed link as null rather than dropping the session', () => {
    const { storage } = createStorage();
    installWindow(storage);

    const saved = saveReviewSession(
      {
        slug: SLUG,
        reviewId: 42,
        feedbackToken: TOKEN,
        googleReviewUrl: 'javascript:alert(1)',
        rating: 5,
      },
      NOW,
    );

    expect(saved?.googleReviewUrl).toBeNull();
    expect(readReviewSession(SLUG, NOW)?.googleReviewUrl).toBeNull();
  });

  it('accepts a session with no Google link at all', () => {
    const { storage } = createStorage();
    installWindow(storage);

    saveReviewSession(
      { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: null, rating: 3 },
      NOW,
    );

    expect(readReviewSession(SLUG, NOW)).toEqual(
      validSession({ rating: 3, googleReviewUrl: null, createdAt: NOW }),
    );
  });
});

describe('the 12 h TTL is never extended by a restore', () => {
  it('keeps the original createdAt when the same review is saved again', () => {
    const { storage } = createStorage();
    installWindow(storage);
    const input = { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 5 };

    saveReviewSession(input, TAPPED_AT);

    // A restore-and-resave of the SAME review, 11 h on.
    const laterNow = TAPPED_AT + 11 * HOUR;
    const resaved = saveReviewSession(input, laterNow);

    expect(resaved?.createdAt).toBe(TAPPED_AT);
    expect(readReviewSession(SLUG, laterNow)?.createdAt).toBe(TAPPED_AT);
    // …so the window still closes 12 h after the tap, not 12 h after the reload.
    expect(readReviewSession(SLUG, TAPPED_AT + REVIEW_SESSION_TTL_MS)).toBeNull();
  });

  it('does not move createdAt forward when a caller passes an older timestamp', () => {
    const { storage } = createStorage();
    installWindow(storage);
    const input = { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 5 };

    saveReviewSession({ ...input, createdAt: TAPPED_AT }, NOW);
    const saved = saveReviewSession({ ...input, createdAt: TAPPED_AT - 60_000 }, NOW);

    expect(saved?.createdAt).toBe(TAPPED_AT - 60_000);
  });

  it('starts a fresh window for a genuinely new review on the same phone', () => {
    const { storage } = createStorage();
    installWindow(storage);

    saveReviewSession(
      { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 5 },
      TAPPED_AT,
    );

    const laterNow = TAPPED_AT + 11 * HOUR;
    saveReviewSession(
      { slug: SLUG, reviewId: 43, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 4 },
      laterNow,
    );

    expect(readReviewSession(SLUG, laterNow)).toEqual(
      validSession({ reviewId: 43, rating: 4, createdAt: laterNow }),
    );
  });

  it('expires without any cleanup pass: an old entry reads as fresh', () => {
    const { storage, setItem } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry({ createdAt: TAPPED_AT }));
    setItem.mockClear();

    expect(resolveReviewEntry(SLUG, TAPPED_AT + REVIEW_SESSION_TTL_MS + 1)).toEqual({ kind: 'fresh' });
    // Expiry is a read-time decision: nothing rewrites the entry to expire it.
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('resolveReviewEntry', () => {
  it('resumes a valid session for the same slug', () => {
    const { storage } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry());

    expect(resolveReviewEntry(SLUG, NOW)).toEqual({ kind: 'resume', session: validSession() });
  });

  it('is read-only: restoring performs no write and no network call', () => {
    const { storage, setItem, removeItem } = createStorage();
    installWindow(storage);
    installSession(storage, storedEntry());
    setItem.mockClear();

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // This is the no-second-POST guarantee at the module level: the mount path
    // only reads, so it cannot tell the server anything.
    resolveReviewEntry(SLUG, NOW);

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads only the key for the slug it was asked about', () => {
    const { storage, getItem } = createStorage();
    installWindow(storage);

    resolveReviewEntry(OTHER_SLUG, NOW);

    expect(getItem).toHaveBeenCalledWith(reviewSessionStorageKey(OTHER_SLUG));
    expect(getItem).not.toHaveBeenCalledWith(reviewSessionStorageKey(SLUG));
  });
});

describe('the retired timestamp-only guard', () => {
  it('no longer decides anything: a legacy marker with no session shows the stars', () => {
    const { storage } = createStorage();
    installWindow(storage);
    // Exactly what the old guard left behind for a guest who tapped a star.
    storage.setItem(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`, String(TAPPED_AT));

    expect(resolveReviewEntry(SLUG, NOW)).toEqual({ kind: 'fresh' });
  });

  it('is cleared once a real session is saved', () => {
    const { storage, removeItem } = createStorage();
    installWindow(storage);
    storage.setItem(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`, String(TAPPED_AT));

    saveReviewSession(
      { slug: SLUG, reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: LINK, rating: 5 },
      NOW,
    );

    expect(removeItem).toHaveBeenCalledWith(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`);
    expect(storage.getItem(`${LEGACY_RATED_STORAGE_PREFIX}${SLUG}`)).toBeNull();
  });
});

describe('resolveSubmitOutcome', () => {
  it('maps the server device cap to "limited" and persists no session', () => {
    const { storage, setItem } = createStorage();
    installWindow(storage);

    const outcome = resolveSubmitOutcome({ ok: true, limited: true }, { slug: SLUG, rating: 5 }, NOW);

    expect(outcome).toEqual({ kind: 'limited' });
    // The cap creates no review row, so there is nothing to resume — a session
    // here would offer a choice whose token authenticates nothing.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('maps a stored review to a resumable choice carrying both options', () => {
    const { storage } = createStorage();
    installWindow(storage);

    const outcome = resolveSubmitOutcome(
      { reviewId: 42, feedbackToken: TOKEN, action: 'choice', googleReviewUrl: LINK },
      { slug: SLUG, rating: 4 },
      NOW,
    );

    expect(outcome).toEqual({
      kind: 'choice',
      session: validSession({ rating: 4, createdAt: NOW }),
    });
    if (outcome.kind !== 'choice') throw new Error('expected a choice');
    // Both choices are offered: the session is not evidence either was taken.
    expect(outcome.session.googleReviewUrl).toBe(LINK);
    expect(outcome.session.feedbackToken).toBe(TOKEN);
    // The rating the guest actually tapped is what the session remembers.
    expect(outcome.session.rating).toBe(4);
  });

  const invalidResponses: Array<[string, unknown]> = [
    ['a body that is not an object', 'nope'],
    ['a null body', null],
    ['a missing token', { reviewId: 42 }],
    ['a truncated token', { reviewId: 42, feedbackToken: 'short' }],
    ['a missing review id', { feedbackToken: TOKEN }],
    ['a zero review id', { reviewId: 0, feedbackToken: TOKEN }],
  ];

  for (const [label, data] of invalidResponses) {
    it(`is invalid for ${label}, so the screen offers a retry instead of a choice`, () => {
      expect(resolveSubmitOutcome(data, { slug: SLUG, rating: 5 }, NOW)).toEqual({ kind: 'invalid' });
    });
  }

  it('keeps the choice when the restaurant has no Google link', () => {
    const outcome = resolveSubmitOutcome(
      { reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: null },
      { slug: SLUG, rating: 2 },
      NOW,
    );

    expect(outcome.kind).toBe('choice');
    expect(outcome.kind === 'choice' ? outcome.session.googleReviewUrl : 'x').toBeNull();
  });

  it('drops a non-http(s) link from the response but keeps the choice', () => {
    const outcome = resolveSubmitOutcome(
      { reviewId: 42, feedbackToken: TOKEN, googleReviewUrl: 'javascript:alert(1)' },
      { slug: SLUG, rating: 2 },
      NOW,
    );

    expect(outcome.kind).toBe('choice');
    expect(outcome.kind === 'choice' ? outcome.session.googleReviewUrl : 'x').toBeNull();
  });
});

describe('analytics projection', () => {
  it('exposes only non-credential fields — never the feedback token', () => {
    const session = validSession();
    const properties = reviewResumeAnalyticsProperties(session);

    expect(Object.keys(properties).sort()).toEqual(
      ['has_google_link', 'rating', 'resumed', 'review_id'].sort(),
    );
    expect(properties).toEqual({
      resumed: true,
      rating: 5,
      review_id: 42,
      has_google_link: true,
    });

    const serialized = JSON.stringify(properties);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(/token/i);
  });

  it('reports the absence of a Google link without inventing one', () => {
    expect(reviewResumeAnalyticsProperties(validSession({ googleReviewUrl: null }))).toMatchObject({
      has_google_link: false,
    });
  });
});
