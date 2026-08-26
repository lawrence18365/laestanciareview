# Tech debt register

Tracked so it isn't remembered. Every entry below is code that was correct when
it shipped and quietly stopped being true — the failure mode is silence, not
errors, so nothing surfaces it until someone reads the numbers and disbelieves
them.

Add an entry when you knowingly leave something inconsistent. Close it by
deleting the entry in the same commit that fixes it.

---

## Open

### 1. Vercel production alias lags the git deploy
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

### `quote_items` was written but effectively unread
**Closed:** 2026-08-25, removed its schema, relations, API reads and writes; migration `0022` drops the table.

### `quotes.service_charge_percent` / `quotes.iva_percent` were decorative
**Closed:** 2026-08-25, removed both fields from the schema, validation, payloads, and total calculation; migration `0022` drops the columns.

### `PACKAGE_TEMPLATES` carried a dead third price list
**Closed:** 2026-08-25, deleted the unused type and template array while retaining the live defaults and menu exports.

### Beverage package ids could silently price at $0
**Closed:** 2026-08-25, pricing now migrates legacy ids, warns once for unresolved ids, and has regression coverage for every configured package id.

### The malformed-input stress case expected a stale dish price
**Closed:** 2026-08-25, the assertion now derives the `pa19` price from `MENU` at runtime.

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
