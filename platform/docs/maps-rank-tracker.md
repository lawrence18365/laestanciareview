# Spec: Google Maps rank tracker per location

Draft (SQ-154), sourced 2026-10-11.

## 1. Measurement

| Item | Decision |
|---|---|
| Endpoint | `POST https://places.googleapis.com/v1/places:searchText` ([Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)) |
| Field mask | `places.id` only (§3) |
| Location | `locationBias` circle, 1500 m per grid point. Bias, not filter (`locationRestriction` is rectangle-only and filters) ([source](https://developers.google.com/maps/documentation/places/web-service/text-search)) |
| Page | `pageSize: 20`, one call per point |
| Rank | 1-based index of our `google_place_id` in `places`. Absent = 21 for averaging |
| Grid | 3×3, 1.5 km spacing around the restaurant |
| Stored per day | Average, best, worst over 9 points, and `points_in_top20` |

Results are not guaranteed consistent across identical calls ([source](https://developers.google.com/maps/documentation/places/web-service/text-search)), so report averages.

## 2. Keywords

| Item | Decision |
|---|---|
| Count | 3–5 per restaurant (cap 5) |
| Who sets | Founder, via admin |
| Defaults | From `cuisine` + `city`: `restaurante de {cuisine} {city}`, `{dish} {city}`, `{cuisine} cerca de mí` |
| Examples | `restaurante de cortes León`, `arrachera León`, `steakhouse cerca de mí` |

## 3. Cost

Source: [pricing table, updated 2026-10-08](https://developers.google.com/maps/billing-and-pricing/pricing), [pricing overview](https://mapsplatform.google.com/pricing/).

| SKU | Fields | Free/month | Per 1,000 |
|---|---|---|---|
| Text Search Essentials (IDs Only) | `places.id` | Unlimited (table) | $0 |
| Text Search Pro | Pro | 5,000 | $32.00 |
| Text Search Enterprise | adds rating, reviews count | 1,000 | $35.00 |
| Text Search Enterprise + Atmosphere | adds reviews | 1,000 | $40.00 |

Free credit: the $200 monthly credit ended; per-SKU free calls replaced it 2025-03-01 ([source](https://mapsplatform.google.com/pricing/)).

| Scenario | Calls/mo | Essentials | Pro | Enterprise |
|---|---|---|---|---|
| 12 loc × 4 kw × 9, daily | 12,960 | $0 | $254.72 | $418.60 |
| 50 loc × 4 kw × 9, daily | 54,000 | $0 | $1,568.00 | $1,855.00 |
| 12 loc × 4 kw × 9, weekly | 1,872 | $0 | $0 | $30.52 |
| 50 loc × 4 kw × 9, weekly | 7,800 | $0 | $89.60 | $238.00 |

Conflict: the overview says Essentials gets "10K free calls per SKU monthly"; the table says Unlimited. Confirm in billing before build.

## 4. Terms of service

| Question | Finding ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) unless noted) |
|---|---|
| Store place_id? | Yes: "You can therefore store place ID values indefinitely." |
| Store our rank integer? | Not addressed. Derived from place_id order, not Places content. Get a legal read |
| General rule | "You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions" |
| Lat/lng cache limit | Set in the [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms). **Not verified verbatim**: fetch truncated |
| Competitor names | **Blocked for storage** (Places content). Competitor place_ids are storable |
| Display | Google Maps attribution required; explain ranking factors |

Sales-view blocker: competitor names need live calls, not storage. The audit page's 24h cache (`revalidate = 86400`) is itself caching. Get a legal read first.

## 5. Data model

Next free migration: **`0030`** (files live in `platform/src/db/migrations/`, not `platform/drizzle/`; latest is `0029_review_recovery_loop.sql`).

```sql
CREATE TABLE maps_rank_keywords (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, keyword)
);
CREATE TABLE maps_rank_samples (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  grid_point smallint NOT NULL,
  run_date date NOT NULL,
  rank smallint,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, keyword, grid_point, run_date)
);
CREATE INDEX maps_rank_samples_restaurant_run_idx ON maps_rank_samples (restaurant_id, run_date);
```

Stored: our place_id and integer ranks only. Samples kept 400 days.

## 6. Schedule and isolation

| Item | Decision |
|---|---|
| Cron | No new entry. Call the sweep from `/api/cron/refresh-ratings` (12:00 UTC) after `refreshAllGoogleRatings` |
| Cadence | Weekly for the briefing (§3). Daily optional |
| Isolation | Per-restaurant `try/catch` and `failed` counter, as in SQ-132. Failures never change the rating route's status |
| Logging | Restaurant id and error code only. Key in a header, not the URL |

## 7. Surfaces

| Surface | Where | Copy |
|---|---|---|
| Owner briefing | `sendOwnerBriefing` (`platform/src/lib/email.ts`), via `weekly-digest` | "arrachera León: #4 promedio, antes #6" |
| Dashboard card | `platform/src/app/(app)/dashboard` | Keyword, average, best/worst, points in top 20 |
| Sales audit | Extend `platform/src/app/audit/[placeId]/page.tsx` | Our average vs nearby, live only (§4) |

Copy rules: state the sample ("9 puntos alrededor del local"). Never tie rank to a server, tip, or quota.

## 8. Risks and decisions

| # | Item | Owner |
|---|---|---|
| 1 | Essentials conflict (§3). Confirm in billing | Founders |
| 2 | Legal read: competitor names in sales view (§4) | Founders |
| 3 | Daily vs weekly: weekly fits Pro's free tier at 12 locations; daily costs $254.72/mo | Founders |
| 4 | Spanish keyword defaults per city need sign-off | Founders |

Tickets:

| Ticket | Files | Scope |
|---|---|---|
| T1 Schema | `platform/src/db/migrations/0030_maps_rank_tracker.sql`, `platform/src/db/schema.ts`, `platform/src/lib/maps-rank-keywords.ts` | Tables, defaults |
| T2 Sweep | `platform/src/lib/maps-rank.ts`, `platform/src/app/api/cron/refresh-ratings/route.ts`, `platform/src/__tests__/maps-rank.test.ts` | Client, grid, isolation |
| T3 Briefing | `platform/src/lib/email.ts`, `platform/src/app/api/cron/weekly-digest/route.ts` | One Spanish line |
| T4 Dashboard | `platform/src/app/(app)/dashboard`, admin keyword editor | Card, editor |
