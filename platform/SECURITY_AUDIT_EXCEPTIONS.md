# Security Audit Exceptions

Last updated: 2026-05-11

## npm audit --omit=dev

Current status: `npm audit --omit=dev` reports 2 moderate findings from `postcss <8.5.10` bundled under `next`.

Why it is not auto-fixed here:
- The app is already on the latest published stable `next` version available from npm at this time: `16.2.6`.
- `npm audit fix --force` suggests installing `next@9.3.3`, which is a breaking downgrade and not an acceptable security fix.

Required follow-up:
- Monitor the next stable Next.js release and upgrade as soon as it carries a patched transitive PostCSS.
- Keep `npm audit --omit=dev` in CI and fail on new high or critical production advisories.

What was fixed in this pass:
- Removed unused `@neondatabase/auth`, eliminating the Better Auth critical advisory path.
- Removed unused `nodemailer` and `@types/nodemailer`.
- Upgraded `next`, `eslint-config-next`, `drizzle-orm`, and `@anthropic-ai/sdk`.
