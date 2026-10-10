# Demo screenshots (assets/product)

Recreates the product images in `assets/product/` from synthetic "Casa Demo" data. Never point this at production.

## Setup
1. Create a non-production database: a Neon branch, or a local Postgres reached through an HTTP-SQL bridge (the platform's Neon driver speaks HTTP to `<host>/sql`; the bridge is not committed).
2. Create `platform/.env.demo.local` (git-ignored) with `DATABASE_URL`, `DEMO_DATABASE_HOST` (the exact host, required for any non-localhost host), `SESSION_SECRET`, `DEMO_SEED_PASSWORD` and `NEXT_PUBLIC_BASE_URL=http://localhost:3051`. Never edit `platform/.env.local`.
3. Apply the schema with the repo's `db:push` script.

## Seed
```
cd platform
node --env-file=.env.demo.local node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
```
Wipes every public table, then seeds 3 locations, a group owner, 24 servers, 600 reviews over 8 weeks, 120 guests, 1 campaign, 6 event leads, 2 quotes and Google snapshots. Deterministic: re-running prints the same counts. It refuses any host that is not localhost or `DEMO_DATABASE_HOST`.

## Capture
1. Build and serve production with the same env file: `node --env-file=.env.demo.local node_modules/next/dist/bin/next build --webpack`, then `... next start -p 3051`. Dev mode is not usable: its eval-based bundles are blocked by the app CSP, so client code never hydrates. Turbopack panics on a symlinked `node_modules`.
2. `node --env-file=.env.demo.local --import tsx scripts/capture-product-screens.mjs`

The script logs in through `POST /api/auth/login` as `casa-demo-polanco` (GM) and `casa-demo-grupo` (owner). It writes webp files to `assets/product/` (desktop 1600px from 1440x900, mobile 780px from 390x844 at 2x, under 250 KB each) and raw PNG and HTML evidence to `DEMO_EVIDENCE_DIR`. Guest shots use card `101` on `/r/casa-demo-polanco` and `/m/casa-demo-polanco/101`.

## Known gaps
- `chef-email` is not captured. `runChefReport` validates the 12 production chef unit IDs and slugs (`chef-weekly-export.ts`), so demo data fails with `chef_scope_mismatch`. The script exits 1 at that step.
- `quote` is not captured. The built-in menu in `quote-data` carries real-brand item names.
- `owner-briefing-email`: `email.ts` hard-codes the group name in the header, so the capture replaces it with `Casa Demo` before saving.
- The contact sheet is written only when every step succeeds.
