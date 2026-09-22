# The guest review flow: the tap, the choice, and the resume

Written for whoever opens a bug about the review screen next. It covers a screen
a guest sees exactly once, from a phone, over a bad connection, usually while the
server bill is someone else's problem — so the useful parts are the ones that say
what the flow refuses to do.

## What the guest sees

1. `/r/<slug>` — the stars (`StarRating.tsx`). One tap is the only input.
2. The **choice**: "Dejar mi reseña en Google" and "Enviar comentario privado al
   gerente". Every guest is offered both; the rating does not route them. The
   Google button is absent when the restaurant has no `googleReviewUrl`.
3. Google, or `/r/<slug>/feedback`.

The choice is reached two ways: the guest just tapped (a POST answered with a
review row and a token), or the guest already tapped and came back (a restore).
Those two must land on the same screen, and the second must not create anything.

## Where the state lives

**The browser session is a cache of a server fact, not a second source of truth.**
`platform/src/lib/review-session.ts` stores one entry per restaurant in
`localStorage` under `ratetap_review_session_<slug>`:

```
{ version, slug, reviewId, feedbackToken, googleReviewUrl, rating, createdAt }
```

- **12 h TTL, measured from the original star tap.** A restore never writes, and
  re-saving the same review keeps the earliest `createdAt`, so a reload loop can
  neither extend the window nor keep a session alive.
- **Versioned and slug-scoped**, with the token length-checked and the link
  protocol-limited to http(s) — that link is what `chooseGoogle` assigns to
  `window.location.href`. Anything that fails validation degrades to "fresh"
  (stars), never to a navigation and never to a second POST.
- **The `feedbackToken` is a credential** for `/api/reviews/feedback` and both
  `chose-*` routes. It lives in `localStorage` under the session key **and** in
  the feedback URL/query: `chooseFeedback` pushes
  `/r/<slug>/feedback?reviewId=…&feedbackToken=…`, which the page reads from
  `searchParams` and hands to `FeedbackForm`. The promise is narrower than "it
  never travels": `reviewResumeAnalyticsProperties()` is the only projection of a
  session that analytics may see (rating, review id, whether a Google link
  exists), so the token never appears in **new analytics properties** — nothing
  more.
- **A session is not a completion.** It is evidence that a *rating* was stored.
  It says nothing about whether the guest reached Google or sent private
  feedback, and a resume offers both options again.

The retired guard wrote `ratetap_rated_<slug> = <timestamp>` and could only ever
*block*: for 12 h after one tap it replaced the stars with "ya recibimos su
opinión", so a reload or a re-scan lost the choice while the review row and its
token sat there, recoverable. Nothing reads that key any more; `save()` deletes it
so it cannot linger as a second, session-less way to turn a guest away.

## Where the authority lives

- `POST /api/reviews/submit` — creates the review and mints the token. The
  3-per-device/24 h cap is an authoritative limit on a guest, and it answers
  `{ ok: true, limited: true }`. That response creates **no review row**, so the
  screen shows the notice and deliberately writes no session: a session here
  would offer a choice whose token authenticates nothing.
- **The device cap is not the only server limit.** Per-IP rate limits also apply,
  and they are enforced before the handler body: `submit:` is 30/min per IP,
  `feedback:` is 10/min per IP and each `chose-*` route 30/min per IP
  (`platform/src/lib/rate-limit.ts`), all answered with `rateLimitResponse`
  (429). The 3-per-24 h device cap is the only *per-guest* limit; it is not the
  only limit that can turn a request away.
- **The device cap itself is conditional on the `rt_device` cookie.** It is
  counted on the salted `deviceHash` of that cookie, and only when the request
  already carried one (`if (existingDeviceId)`); a first-ever request mints the
  cookie and is not counted against it.
- `POST /api/reviews/feedback` — the guard is the statement, not the route:
  `UPDATE reviews SET … WHERE id = $1 AND feedback_token_hash = $2 AND feedback IS NULL`.
  The `IS NULL` clause is what makes a concurrent double submit safe: the second
  statement waits on the row lock, re-evaluates its `WHERE` against the new row
  version and matches nothing. There is no read-then-write window to lose.

## What a retry does

Pinned by `platform/src/__tests__/review-feedback-retry.test.ts`:

- A retry with the **correct token** after a stored submission is a **success**
  with the same body as the first (`{ success: true, reviewId }`). The guest who
  double-tapped, or whose response was dropped on the way back, is not told their
  submission failed.
- It **never overwrites** the stored feedback, and it **never replays the
  post-write effects**: the GM alert, the `feedback_submitted` commercial event
  and the SLA sweep belong to the write that actually happened.
- A **wrong or missing token is a non-success, and it cannot write** — but the
  two cases carry **different statuses**. A token whose shape fails
  `submitFeedbackSchema` (absent, or outside the 32–256 length the schema
  requires) never reaches the query: it is a schema **400**. Only a
  **valid-shaped** token that matches no row — a mismatch, or a review id that
  does not exist — reaches the **404**, whose body is deliberately
  undifferentiated — `Review not found or feedback already submitted` — because
  the form is public and must not confirm which review ids exist.

## Post-write exception seams (recorded, not repaired)

These are the exact points where a statement has already committed but the
handler can still fail or skip work. The tests assert this behaviour; nothing
here changes the alert policy.

1. **`route.ts:110` — `await dispatchFeedbackAlerts(updated, restaurant)` is
   awaited unguarded.** It is the guest's write barrier: the feedback is committed
   before it, but if it rejects, the rejection escapes `POST` and the handler
   never returns a response of its own. In production Next answers 500 with a
   non-JSON body — the guest is shown a failure for a submission that succeeded.
   `dispatchFeedbackAlerts` ends with its own `db.update(reviews).set({ alertChannels, … })`
   write-back, so a connection loss or timeout on *that* statement is a realistic
   cause.
2. **Everything sequenced after the dispatch is skipped when it throws**:
   `trackCommercialEvent` and `scheduleComplaintSlaSweep` never run for that
   submission, so the funnel loses the event for a stored review.
3. **The retry after such a failure reports success and does not re-dispatch.**
   The guest re-taps, the route finds the stored feedback, answers
   `{ success: true }` — and the alert for that row is never sent by this path.
   The GM can be missing a complaint the guest believes was delivered. This is
   the one seam worth fixing deliberately rather than recording.
4. **`trackCommercialEvent` is wrapped in `try/catch`** (it only logs), so it
   cannot fail the guest.
5. **`scheduleComplaintSlaSweep()` is fire-and-forget** and is called after the
   response payload is settled; it cannot delay or fail the submission.
6. **A restaurant row that cannot be read is two different events.** If the
   `restaurants` SELECT succeeds but matches **no row**, `restaurant` is falsy,
   `if (restaurant)` skips the alert dispatch, and the bookkeeping after it
   still runs — the guest still gets their success. If the SELECT is **rejected**
   by the database (connection loss, timeout), the `await` throws, the rejection
   escapes `POST`, and the request **fails** — the same seam as #1, on a row that
   is already committed.

## What the resume tests cover, and what they cannot

`platform/src/__tests__/review-resume.test.tsx` asserts the mount decision
through `resolveReviewMountState()`, the one function the mount effect calls:
a valid session resumes the choice for that review (both options, the guest's
rating restored, the link sanitised); a resume performs **no write, no cleanup and
no fetch** (the no-second-POST guarantee, which is also why a reload cannot
extend the 12 h window); an expired, foreign, corrupt or future-dated entry — and
a legacy `ratetap_rated_` marker — shows the stars rather than a repeat notice;
and the analytics event carries `resumed: true` without the token.

Two things are **not** pinned there, and should not be read as if they were:

- **The actual mount.** The helper tests call `resolveReviewMountState()`
  directly; they do not mount the component, so `useEffect` never runs and the
  screens are never rendered. What they assert is the *decision* the effect
  consumes, not the effect. The render chain's priority (already-received, error,
  redirecting, choice, hint) is unchanged by this patch.
- **The event-driven submit path** (`handleSubmit`, `chooseGoogle`,
  `chooseFeedback`). Its ordering — persist the session *before* revealing the
  choice — is pinned against the source, not executed.

Neither gap is left uncovered. The **separate Chromium evidence** at the end of
the same file (`playwright`, a devDependency) bundles the real component, renders
it in a real browser and drives it: it clicks a star, waits for the choice,
clicks Google and waits past the 800 ms redirect timer, and re-renders the same
root with a different slug. That pass — not the helpers — exercises the
post-mount screens and the event-driven submit path, and is what shows that after
a slug change **none of the previous restaurant's screen is left** (no choice
button, no Google link in the DOM, and no redirect once the timer would have
fired).

The source makes that discard a **remount**: the default export renders
`<StarRatingScreen key={props.restaurantSlug} …>`, so a new slug is a new
instance and the old state — choice, rating, flags — is dropped whole instead of
being unpicked field by field. Note what this evidence does and does not do: the
Chromium cases pass whether the discard comes from the key or from the
slug-keyed mount effect, so they confirm the *outcome* (a clean screen) rather
than discriminating the key line itself. The helper tests cannot see the outcome
at all, because the leftover is React state and only exists once something
mounts.

## Not claimed

Idempotent retries and a resumed choice screen are **consistent with** the
symptom this work started from (a guest being told "ya recibimos su opinión", or
seeing an error, for a submission that had already been stored). They do **not**
establish it. Which guest, which deploy, which rating was on screen and whether
their POST ever reached the server are all outside what a unit test of this route
can see, and nothing here should be cited as the cause of a particular production
screenshot.

## Files

- `platform/src/lib/review-session.ts` — the cache, its validation and its
  analytics projection.
- `platform/src/components/review/StarRating.tsx` — the screen, the mount
  resolver and the submit handler.
- `platform/src/app/api/reviews/feedback/route.ts` — the feedback write and the
  retry semantics.
- `platform/src/__tests__/review-session.test.ts` — the cache contract.
- `platform/src/__tests__/review-resume.test.tsx` — the mount/restore behaviour.
- `platform/src/__tests__/review-feedback-retry.test.ts` — the retry behaviour
  and the post-write seams above.

## Funnel note

`review_page_open` is emitted per page load and `review_screen_shown` once per
mount of `StarRating`. The resumed and fresh populations stay separable because a
restore carries `resumed: true`.

**That separability is a requirement, not a detail.** `review_screen_shown` now
also fires for a **resumed** choice view, so it no longer means "the stars were
shown" — it counts loads that reached *either* the stars or a restored choice.
Raw pre/post star-screen conversion (the `review_page_open` → `review_screen_shown`
step) is therefore **not comparable across this deploy**: the numerator gained
every resume, and a guest who reloads three times adds three. To read the
conversion as it was measured before, exclude the `resumed: true` rows. The
scripts that count this event (`scripts/funnel-report.ts`, `health-board.ts`,
`roi-board.ts`) count it **unfiltered**, so their numbers include resumes today.

`review_blocked_local_guard` is now emitted by nothing: the local
guard is gone, and the things that turn a guest away are the server's per-IP rate
limits and its per-device cap (see "Where the authority lives"). The
event name stays in `product-events.ts` and in the digest email copy because the
historical rows still carry it; it should read as zero from this deploy onward,
and the `limited: true` response is the signal that replaced it.
