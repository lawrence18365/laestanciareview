# RateTap feature map

Code-grounded inventory as of 2026-10-10 (commit cb2ee31). Built from five read-only maps (US-10: SQ-125 to SQ-129). Every row was traced to `file:line` on the board tickets. This page keeps only the summary.

Status: **LIVE** means reachable and wired. **GATED** means it needs an env var, a role or setup. **DORMANT** means the code exists but nothing reaches it. **DEAD** means unused or broken. Env values in production were not checked.

Grouped by the outcome each feature delivers, not by screen.

## 1. Know what is happening in every location (owner / regional)

| Feature | Who | Status |
|---|---|---|
| `/overview`: portfolio of all locations (ROI, Google trend, unresolved complaints, 12-week history, complaint response times, which locations have no alert device) | owner, regional (own region only) | LIVE |
| `/insights`: group comparison, adoption, funnels, campaigns, push coverage, automatic "problem locations" list | owner only | LIVE |
| `/intercepted`: low ratings and complaints across the region | owner, regional | LIVE |
| Owner weekly briefing email (Mon 08:00 MX): scans, server breadth, GM activity, complaints, Google trend per location | owner | GATED: managerEmail + SMTP |
| Regional weekly briefing (same, region-scoped, plus upcoming birthdays) | regional | GATED: region + SMTP |
| Location health label (healthy / traffic drop / adoption drop / inactive / mixed), rules-based | feeds briefings | LIVE (telemetry from 2026-08-21) |
| Location-drop anomaly alert (last 3 days ≤25% of 4-week same-weekday baseline) | GM, owner, regional (push) | LIVE, needs push devices |
| Quiet-staff detection (server down ≥60% vs their baseline), Mondays only | GM, owner, regional | LIVE |
| Google rating tracking: daily snapshot + trend per location | owner, GM | GATED: GOOGLE_PLACES_API_KEY + place id |
| Chef weekly report: kitchen signals from guest comments, CSV, no raw text | chef | Ships DARK: unscheduled + CHEF_REPORT_ENABLED |

## 2. Catch problems before they become 1-star reviews (GM)

| Feature | Who | Status |
|---|---|---|
| Rules-based review classifier: praise / mixed / complaint / urgent; negative text upgrades 4–5★ | drives alerts | LIVE |
| GM-first complaint alert at submit: email, push, optional SMS / WhatsApp | location GM | GATED: managerEmail; SMS_ALERTS_ENABLED / WHATSAPP_ALERTS_ENABLED |
| Complaint SLA escalation: urgent after 2 h, actionable after 8 h, any open after 24 h → owner/regional push + "[Escalada]" email | GM → owner/regional | LIVE (enforced on guest submit + daily 10:00 MX backstop) |
| `/inbox` triage: Revisado, Resolver with outcome (guest recovered, comp given, guest left, could not resolve, not an issue), mailto reply, CSV, SLA card | GM | LIVE |
| "Lo atiendo" claim on a pinned negative review (push deep link) | GM | LIVE, narrow |
| `/live` feed, polls every 15 s | GM | LIVE |
| Push notifications: new review (per alert preference), overdue complaint, anomaly, VIP validated, daily/weekly digests | GM, owner, regional | GATED: VAPID keys + an installed device |
| Daily GM push 09:00 MX: birthdays today + yesterday's 5★ count | GM | LIVE, needs device |
| GM weekly digest email: stats, server leaderboard, staff anomalies | GM | GATED: SMTP |

## 3. Get more Google reviews, attributed to each server (guest + server)

| Feature | Who | Status |
|---|---|---|
| Tap a server's card → `/r/<slug>?card=CODE` → 1–5 stars | guest | LIVE |
| Same choice screen for every rating: "Google" or "private feedback" (no gating by rating) | guest | LIVE; Google button needs googleReviewUrl |
| Private feedback form → managers only | guest | LIVE |
| Per-server attribution (card code) | server, GM | LIVE (deactivated servers still attribute, see defects) |
| Restaurant-level link/QR with no card | guest | **BROKEN: rating fails with 400** (fix in SQ-130) |
| Abuse limits: 3 ratings/24 h per device cookie, per-IP rate limits | guest | LIVE (Upstash-backed if configured) |
| Server's personal scoreboard `/m/<slug>/<code>` and its QR | server | LIVE, public by URL |
| `/dashboard`, `/analytics`: weekly/monthly reviews, staff ranking, ROI, Google conversion | GM, owner | LIVE |
| `/staff`: add / edit / deactivate / delete servers, card codes, QR download | GM | LIVE |

## 4. Bring guests back (guest list + campaigns)

| Feature | Who | Status |
|---|---|---|
| Guest capture `/g/<slug>`: name, WhatsApp, birthday, promo consent → 4-digit code | guest | LIVE where restaurant.brand is set |
| Code redemption tablet `/v/<slug>` (no login) | server / host | LIVE |
| `/guests` CRM: visits, VIP at 5+, filters (today, birthdays, absent 60 days, VIP), search, print | GM | LIVE |
| Consent-only CSV for Meta Custom Audiences | GM | LIVE |
| One-tap WhatsApp chat per guest (birthday / greeting text) | GM | LIVE (**no consent check**, see defects) |
| Event campaigns: audience = validated + consented (all / wine / VIP), per-contact manual WhatsApp send, status tracking | GM | LIVE, manual send |
| VIP birthday wine offer `/vip-vino` | León GM | GATED to one location |

## 5. Sell private events (bookings pipeline)

| Feature | Who | Status |
|---|---|---|
| Event-lead intake from the WhatsApp bot (Manychat) + push "Nuevo lead de eventos" | GM | GATED: LEADS_WEBHOOK_TOKEN |
| Manual lead entry | GM | LIVE (no push) |
| Lead stages new → claimed → quoted → won / lost | GM | LIVE |
| Quote builder (individual / options / asado / à la carte, dishes, drink packages, pricing, templates, terms) | GM | LIVE |
| Print / PDF (browser print) and share link `/q/<token>` via WhatsApp | GM, guest | LIVE |
| Client acceptance, deposits, outcome tracking (won amount) | n/a | MISSING / DEAD (deposits deferred; see platform/docs/deposits-decision.md) |

## 6. Get and bill customers (RateTap)

| Feature | Who | Status |
|---|---|---|
| `/contacto` trial form → lead + WhatsApp handoff (creates no account) | prospect | LIVE |
| Pilot code `/contacto?pilot=CODE` → self-provisioned 30-day trial (cap 5) | invited restaurant | GATED: PILOT_CODE |
| Manual restaurant creation (admin key) | founders | GATED |
| Mercado Pago subscription + webhook (trialing / active / past_due / canceled) | restaurant | LIVE billing path |
| Stripe subscription webhook + portal | legacy restaurants | GATED, legacy |
| Stripe setup-fee checkout (MX$1,500) | n/a | DEAD: no UI caller, webhook ignores payment mode (would charge without provisioning) |
| Trial nurture (day 3 / 7 / 12) and trial expiry | restaurant | GATED: SMTP / Twilio |
| Login, password reset, onboarding status `/bienvenida` | restaurant | LIVE |
| Google audit `/audit/<placeId>` (rating vs nearby restaurants) | prospect | GATED: Places key |
| `/auditoria-ingresos` intake (lead capture only) | prospect | LIVE |
| Outreach: prospect SMS (weekly), audit follow-up SMS, email engine, founder hitlist, AI WhatsApp auto-reply | RateTap internal | Email DORMANT unless OUTREACH_EMAIL_ENABLED; SMS crons have **no on/off flag** |
| Meta Conversions API (Lead, CompleteRegistration, Purchase) | ads | GATED: META_* |
| Internal sales boards `/commercial-leads`, `/prospects`, `/prospects-us` | founders | **EXPOSED to customer sessions / public** (fix in SQ-131) |

## Corrections to how we describe the product

- **No AI writes any customer-facing report.** Owner briefings, chef report, anomalies and SLA are all SQL and rules. The only LLM call is the prospect WhatsApp sales bot. "AI regional manager" is a direction, not shipped code.
- **Owners get weekly emails only.** The daily push goes to GMs. Escalations reach owners by push and email, never SMS or WhatsApp.
- **The public trial does not self-provision.** A founder creates the restaurant by hand.

## Defects found (open)

| # | Defect | Severity | Ticket |
|---|---|---|---|
| 1 | No-card `/r/<slug>` (restaurant QR) rating fails with 400 | High: guests blocked | SQ-130 |
| 2 | Internal sales boards readable/editable by customer owner/regional sessions; `/prospects-us` public with venue phone numbers | High: data exposure | SQ-131 |
| 3 | One failed Google fetch aborts the daily rating refresh for all remaining restaurants | Medium | SQ-132 |
| 4 | Guest WhatsApp button ignores marketing consent | Needs decision | (open) |
| 5 | Quote "won" writes unknown status `accepted`; re-saving a quote resets it to draft; outcome tracking unreachable, so conversion readout always 0 | Medium | (open) |
| 6 | Stripe setup-fee checkout would charge without provisioning (no caller today) | Low until linked | (open) |
| 7 | Prospect SMS and audit follow-up crons have no on/off flag | Medium | (open) |
| 8 | Deactivated server's card still attributes reviews | Low | (open) |
| 9 | Dead code: `getQuietStaff`, `sendOwnerDigest`, `makeCode` | Cleanup | (open) |
| 10 | Chef report scope hardcoded to 12 unit IDs; a new location needs a code change | Low | (open) |
