# Demo screenshots (assets/product)

Recreates the 11 product images in `assets/product/` from synthetic "Casa Demo" data. Never point this at production.

## Setup
1. Use a non-production Postgres: a local cluster on `localhost` or a Neon branch named in `DEMO_DATABASE_HOST`. Apply the schema with the repo's drizzle migrations.
2. Create `platform/.env.demo.local` (git-ignored) with `DATABASE_URL`, `SESSION_SECRET`, `DEMO_SEED_PASSWORD` and `NEXT_PUBLIC_BASE_URL=http://localhost:3051`. Never edit `platform/.env.local`.
3. The platform's Neon driver speaks HTTP to `<host>/sql`. For local Postgres, preload an HTTP-SQL bridge (not committed) with `node --require <bridge.cjs>`.

## Seed
```
cd platform
node --require <bridge.cjs> --env-file=.env.demo.local --import tsx scripts/seed-demo.ts
```
Wipes the public tables, then seeds 3 locations, a group owner, 24 servers, 600 reviews over 8 weeks, 120 guests, 1 campaign, 6 event leads, 2 quotes and Google snapshots. Re-running prints the same counts. It refuses any host that is not localhost or `DEMO_DATABASE_HOST`.

## Capture
1. Build and serve production with the same env: `node --require <bridge.cjs> --env-file=.env.demo.local node_modules/next/dist/bin/next build --webpack`, then `next start -p 3051`. Dev mode is not usable: its eval-based bundles are blocked by the app CSP. Turbopack panics on a symlinked `node_modules`.
2. `DEMO_EVIDENCE_DIR=<dir outside the repo> node --require <bridge.cjs> --env-file=.env.demo.local --import tsx scripts/capture-product-screens.mjs`

The script sets the onboarding flag in localStorage, logs in through `POST /api/auth/login` as `casa-demo-polanco` (GM) and `casa-demo-grupo` (owner), and fails any shot showing the onboarding wizard or a dialog. Desktop shots are 1440x900 exported at 1600px. Mobile shots are 390x844 at 2x exported at 780px. Each webp is under 250 KB. Raw PNG, rendered HTML and the contact sheet go to `DEMO_EVIDENCE_DIR`.

## Known gaps
- No chef-report or quote image. `runChefReport` is pinned to the 12 production unit IDs, and the default quote menu carries real-brand item names. Both are outside this contract.
- `owner-briefing-email`: `email.ts` hard-codes the group name in the header. The capture swaps it for `Casa Demo` before saving.
