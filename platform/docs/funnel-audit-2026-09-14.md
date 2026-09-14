# Per-unit tap funnel — answer to Juan Carlos, 2026-09-14

> **READ THIS FIRST — this is the PRE-INSTRUMENTATION forensic record.**
> Every rate below is derived from `review_page_open` alone, which counts page
> loads with no dedupe and cannot distinguish a load that showed the stars from
> one the repeat-visit guard turned away. **Do not compare any percentage in this
> document with output from `scripts/funnel-report.ts`**, which starts at
> instrumentation time zero (2026-09-14T19:26:15Z) and measures different,
> narrower events. Blending the two produces a number that means nothing.
> This file is kept as the record of what was knowable on 2026-09-14 and as the
> evidence behind the label fix — not as an ongoing report.

Source: `platform/scripts/audit-tap-funnel.ts` (re-runnable, hits prod read-only).
Window: **2026-08-21 → 2026-09-14**, not 30 days. `review_page_open` did not exist
before 2026-08-21 (commit `01edea5`), so a true 30-day funnel is not available.

## 1. What each column actually counts — the part he is right about

| Label he reads | What the code counts |
|---|---|
| "Escaneos" / "Calificaciones capturadas" | `count(reviews.id)` — rows in `reviews` |
| "Reseñas totales" | `count(reviews.id)` — **the same expression** |
| "Clics a Google" | `reviews.sent_to_google = true`, set by `/api/reviews/chose-google` on the actual click |

Evidence: `src/lib/queries.ts:547` (`totalScans: count(reviews.id)`),
`src/lib/weekly-signal.ts:101` (same count for the weekly email "Escaneos"),
`src/lib/i18n.ts:83,187,221`.

**Querétaro 464 = 464 is a definition artifact.** The two columns are one query
rendered under two labels. Nothing in the product counts a scan. A `reviews` row
only exists once a rating is submitted, because `reviews.rating` is `NOT NULL`
(`src/db/schema.ts:289`).

So the gap he is describing cannot be read off that panel at all. The panel has
no numerator for it.

## 2. The real funnel (2026-08-21 → 09-14)

`screen_loads` = server-side `review_page_open`, fired on every render of
`/r/[slug]` (`src/app/r/[slug]/page.tsx:26`). No dedupe of any kind.

| Unit | Screen loads | Rating submitted | % | Google click | % of ratings |
|---|---|---|---|---|---|
| Estancia Angelópolis | 1683 | 1068 | 63.5 | 775 | 72.6 |
| Estancia Querétaro | 1315 | 889 | 67.6 | 461 | 51.9 |
| SteakCompany Querétaro | 843 | 555 | 65.8 | 350 | 63.1 |
| Estancia Veracruz | 647 | 411 | 63.5 | 284 | 69.1 |
| La Silla Juárez | 551 | 460 | 83.5 | 265 | 57.6 |
| Estancia Xalapa | 465 | 263 | 56.6 | 182 | 69.2 |
| Harbor's Angelópolis | 449 | 339 | 75.5 | 177 | 52.2 |
| La Silla Huexotitla | 377 | 251 | 66.6 | 228 | 90.8 |
| Harbor's Veracruz | 334 | 245 | 73.4 | 190 | 77.6 |
| Estancia León | 256 | 161 | 62.9 | 122 | 75.8 |
| Estancia Juárez | 21 | 8 | 38.1 | 6 | 75.0 |
| Regio Norte | 12 | 4 | 33.3 | 1 | 25.0 |

"Very few registered surveys" is not what this shows: 56–84% of screen loads end
in a submitted rating. But see §4 — the denominator is dirty.

## 3. His hypothesis: is drop-off related to the rating given?

Before the rating, **unanswerable by construction** — no rating exists yet, so
abandonment before submit cannot be split by rating. His instinct that it
happens before the rating is the right shape, and we cannot measure it.

After the rating, there is a strong relationship (group-wide, 30d):

| Rating | Submitted | Clicked Google | % |
|---|---|---|---|
| 1★ | 117 | 21 | 17.9 |
| 2★ | 7 | 0 | 0.0 |
| 3★ | 17 | 6 | 35.3 |
| 4★ | 170 | 79 | 46.5 |
| 5★ | 5458 | 3608 | 66.1 |

This is the degating design behaving as intended: low ratings are offered the
private path and take it. It is not drop-off, and it is not a fault.

Side finding worth a look: **117 one-stars vs 7 two-stars** is not a natural
distribution, and only 3 of 117 wrote any text. Steady ~25/week across most
units, not one bad night. Reads like accidental taps on the leftmost star. Not
proven — flagging, not concluding.

## 4. Duplicate taps — and the honest limits

- Same device, same unit, same day, >1 review: only **25 surplus rows in 30 days**
  group-wide (Querétaro 11, Angelópolis 10). Small.
- But **69.4% of 30-day review rows have no `device_hash` at all** — the column
  only started being written on 2026-09-04 (`fd83f46`, migration 0027). Before
  that date duplicates are undetectable. The 25 is a floor, not a total.
- `session_id` is **NULL on all 6,953 guest page opens**. So screen loads cannot
  be deduped to guests: reloads, back-navigation and a waiter demoing all count
  as separate loads. `pct_load_to_rating` is therefore a floor, not a guest
  conversion rate.

## 5. The finding that matters more than his question

Group-wide load→rating fell at exactly our own 2026-09-04 deploy:

| Period | Loads | Submitted | % |
|---|---|---|---|
| Aug 21 – Sep 03 | 3556 | 2760 | **77.6** |
| Sep 04 – Sep 14 | 3397 | 1894 | **55.8** |

Loads rose 13%; submissions fell 19%. Per unit: Huexotitla −48.6pts,
Querétaro −25.8, Angelópolis −24.2, Harbor's Angelópolis −22.7.

Commit `fd83f46` (2026-09-04) shipped two things at once:
1. removed the waiter's name from the tap screen, and
2. added a **12-hour `localStorage` guard** that renders "ya recibimos su
   opinión" *instead of the stars* (`src/components/review/StarRating.tsx:205-247`).

The server-side 3-per-device cap is **not** the cause — only 2 device-days ever
reached 3. The `localStorage` guard blocks after **one** review, not three, and
emits **no event at all**, so every blocked load counts as a screen load with no
possible rating. Which of the two changes is responsible is **not yet
established**; both landed in one commit and neither is instrumented.

## 6. What to tell him, and what not to

Safe to say: the two columns are the same number under two labels, that is ours
to fix, and here is the per-unit funnel. 56–84% of loads convert.

Do **not** claim: a clean 30-day funnel, a guest-level conversion rate, a
duplicate-tap total, or that drop-off is unrelated to his hypothesis.

Open items before this number is trustworthy:
- [x] Emit an event when the guard blocks the rating screen — `review_blocked_local_guard`,
      shipped in `121aa01`, live in production and verified end to end.
- [x] Make loads dedupable — `review_screen_shown` / `review_blocked_local_guard`
      carry `session_id` (per-tab). `review_page_open` is server-rendered and
      still cannot carry one; it remains a raw load counter.
- [ ] Attribute the 2026-09-04 conversion drop between de-naming and the guard.
      **Deliberately still open. Causality is UNKNOWN** and must not be asserted
      until the new events have accumulated enough production data.
- [x] Rename "Escaneos" — it counted submitted ratings, not scans. Now
      "Calificaciones" in the owner and regional weekly emails and in the
      location-signal summaries.

Ongoing reporting now lives in `scripts/funnel-report.ts`. This document is
closed as of 2026-09-14 and should not be updated with new numbers.
