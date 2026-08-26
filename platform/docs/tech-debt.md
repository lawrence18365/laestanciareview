# Tech debt register

Tracked so it isn't remembered. Every entry below is code that was correct when
it shipped and quietly stopped being true — the failure mode is silence, not
errors, so nothing surfaces it until someone reads the numbers and disbelieves
them.

Add an entry when you knowingly leave something inconsistent. Close it by
deleting the entry in the same commit that fixes it.

---

## Open

### 1. `quote_items` is written but effectively unread
**Where:** `src/app/api/quotes/route.ts:144`, `src/app/api/quotes/[id]/route.ts:118,132`, table in `src/db/schema.ts`
**What:** Every quote save deletes and re-inserts `quote_items` rows. The only
reader left is the GET route that returns them to nobody — the print path that
used to render them was deleted in `6481e58`.
**Why it matters:** Write amplification on every save, plus a table that looks
authoritative in the schema and isn't. Same shape as `price_per_person`.
**Fix:** Confirm no consumer, stop writing, drop the table.

### 2. `quotes.service_charge_percent` / `quotes.iva_percent` are decorative
**Where:** `src/db/schema.ts` (quotes), written in `QuoteBuilderV2.tsx:~341`
**What:** The builder hardcodes both to `'0'` on every save because
`precioFinalPP` already includes servicio and IVA. The real rates live in
`servicePct()` (15%) and `ivaPct()` (16%) in `src/lib/quote-data.ts:~636`.
**Why it matters:** Two columns named after business rates that hold neither.
A future reader will use them. `QuoteList.quoteTotal()` still multiplies by
them — harmless only because they are always zero.
**Fix:** Same treatment as `price_per_person` — remove from schema and payload.

### 3. `PACKAGE_TEMPLATES` is dead code carrying a third price list
**Where:** `src/lib/quote-defaults.ts:125-180`
**What:** Nothing imports it. Only `DEFAULT_TERMS` and `CATEGORY_LABELS` are
consumed from that module. It holds `$650 / $850 / $1100` per-person prices
that no longer match anything the app charges.
**Why it matters:** It is the single most likely thing for someone to find and
"update" while the real prices sit in `PAQUETES_BEBIDAS` / `MENU`.
**Fix:** Delete the export.

### 4. `computePricing()` silently prices unknown beverage ids at $0
**Where:** `src/lib/quote-data.ts:~660` — `const bebidaPP = pkg?.precio ?? 0`
**What:** `computePricing` does NOT call `migrateBebidaId`; only `migrateConfig`
does. Any caller that hands it a raw legacy id (`'completo'`, `'sin-alcohol'`)
gets a $0 beverage line with no error.
**Why it matters:** This already happened. `scripts/stress-quote-builder.ts`
passed legacy ids for months; four pricing assertions were silently comparing
against $0 totals and failing unnoticed. Fixed in `f575102` — the swallow that
allowed it is still there.
**Fix:** Either migrate inside `computePricing`, or throw on an unknown id
instead of defaulting to zero.

### 5. `scripts/stress-quote-builder.ts` section 11 expects a stale dish price
**Where:** `scripts/stress-quote-builder.ts`, section 11
**What:** Asserts `pa19` (Arrachera Pibe) at `$420`; `MENU` says `$450`. One
permanent FAIL in the harness.
**Why it matters:** A harness with a known-failing case trains people to ignore
its output — which is exactly how #4 survived.
**Fix:** Derive the expectation from `MENU` at runtime, as section 6 now does.

### 6. Vercel production alias lags the git deploy
**Where:** deploy process, not code
**What:** `git push origin main` builds a deployment marked `Production`, but
`app.ratetapmx.com` does not always point at it immediately. On 2026-08-25 the
alias was still serving a commit from an hour earlier while `vercel ls` showed
the newer build `Ready`.
**Why it matters:** It caused a real outage. Migration `0021` dropped a column
after the new build went `Ready`, while the alias still served code that
selected it — every quote page 500'd until `vercel promote` was run.
**Fix / rule:** For any migration that removes or renames a column, verify with
`vercel inspect https://app.ratetapmx.com` that the alias resolves to the
deployment containing the schema change, and only then apply the migration.
`Ready` in `vercel ls` is not the same as live.

---

## Closed

### `quotes.price_per_person` — the price lived in two places
**Closed:** 2026-08-25, commits `65c2425` (stop reading it) and `6481e58`
(stop writing it, delete the fallback, migration `0021` drops the column).
**What it was:** A denormalised per-person price snapshot written at save time.
It went stale the moment any pricing input changed — the beverage price rise in
`f575102` left the `/quotes` list showing old prices while opening the same
quote showed new ones.
**Why it is written down anyway:** The column was defensible when it shipped
(one cheap read for a list view). It became a bug through no change to itself.
Prefer deriving from `config_json`; if read cost ever bites, cache it — do not
reintroduce the duplicate.
