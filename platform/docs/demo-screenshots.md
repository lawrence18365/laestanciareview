# Demo screenshots (assets/product)

Recreates the 14 images in `assets/product/` from synthetic "Casa Demo" data. Never point this at production.

## Setup
1. Create a non-production database: a new Neon branch of an empty project, or any Postgres the platform's Neon driver can reach.
2. Create `platform/.env.demo.local` (git-ignored) with `DATABASE_URL`, `DEMO_DATABASE_HOST` (the exact host of `DATABASE_URL`, required for any non-localhost host), `SESSION_SECRET`, `DEMO_SEED_PASSWORD` and `NEXT_PUBLIC_BASE_URL=http://localhost:3051`.
3. Apply the schema to that database with the repo's `db:push` script. Do not edit `platform/.env.local`.

## Seed
```
cd platform
node --env-file=.env.demo.local node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
```
This wipes every public table, then seeds 3 locations, a group owner, 24 servers, 600 reviews over 8 weeks, 120 guests (25 VIP), 1 WhatsApp campaign, 6 event leads, 2 quotes and 4.5 to 4.7 Google snapshots. It is deterministic: re-running prints the same counts. It refuses any host that is not localhost or `DEMO_DATABASE_HOST`.

## Capture
1. Start the platform with the same env file: `node --env-file=.env.demo.local node_modules/next/dist/bin/next dev -p 3051 --webpack` (Turbopack panics when `platform/node_modules` is a symlink, as in git worktrees).
2. In a second shell: `node --env-file=.env.demo.local --import tsx scripts/capture-product-screens.mjs`.

It logs in through `/login` as `casa-demo-polanco` (GM) and `casa-demo-grupo` (owner), with `DEMO_SEED_PASSWORD`. It writes the 14 webp files to `assets/product/` (desktop 1600px wide from a 1440x900 viewport, mobile 780px from 390x844 at 2x, all under 250 KB) and raw PNG and HTML evidence to `DEMO_EVIDENCE_DIR` (default `data/demo-capture`, git-ignored). It also writes a contact sheet.

Guest and scoreboard shots use card code `101` on `/r/casa-demo-polanco` and `/m/casa-demo-polanco/101`.

## Notes
- Email renders: the owner briefing comes from `sendOwnerBriefing` with nodemailer intercepted, so nothing is sent. The chef report comes from `scripts/chef-weekly-report.ts --dry-run`; its generated files are removed after the HTML is copied.
- The platform's Neon driver speaks HTTP to `https://<host>/sql`, so plain local Postgres does not work without an HTTP-SQL bridge. Use a Neon branch.
