# Pre-Deploy Smoke Test — Core Review Flow

**Run this before every production deploy. Takes ~10 minutes. Non-negotiable.**

The flow below is the single most important user journey in the product:
a restaurant signs up → a guest scans the QR → gives 5 stars → lands on Google.
If any step fails, the entire value proposition fails silently.

---

## Prerequisites

- Stripe test mode enabled (use `4242 4242 4242 4242` card)
- Dev or staging DB with webhook endpoint pointing to your local or staging server
- `STRIPE_WEBHOOK_SECRET` env var set for the target environment
- Access to the DB (to query the resulting row)

---

## Step 1 — Full Signup via `/contacto`

1. Open the signup page (`/contacto` or the public marketing `contacto.html`)
2. Fill in all fields including a **real Google Place ID** for a known restaurant
   - Find one at: `https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder`
   - Example format: `ChIJN1t_tDeuEmsRUsoyG83frY4`
3. Complete Stripe test-mode checkout
4. Confirm Stripe dashboard shows the checkout session as completed

**Expected outcome:** Stripe fires `checkout.session.completed` webhook.

---

## Step 2 — Verify the DB Row

Query the resulting `restaurants` row immediately after checkout completes:

```sql
SELECT id, name, slug, google_place_id, google_review_url, subscription_status, created_at
FROM restaurants
WHERE slug = '<the-slug-from-welcome-email>'
   OR manager_email = '<email-you-used>';
```

**Pass criteria — both fields must be non-null:**

| Field              | Expected                                                                 |
|--------------------|--------------------------------------------------------------------------|
| `google_place_id`  | The Place ID you entered at signup                                       |
| `google_review_url`| `https://search.google.com/local/writereview?placeid=<your-place-id>`   |
| `subscription_status` | `trialing`                                                            |

❌ **If `google_review_url` is null — the webhook fix is not running. Stop. Do not ship.**

---

## Step 3 — 5-Star Guest Redirect

1. Open `/r/<slug>` in a browser (the QR destination URL)
2. Tap or click **5 stars** (or whatever rating is at or above `google_threshold`)
3. Watch where the browser goes

**Pass:** Browser redirects to `https://search.google.com/local/writereview?placeid=...`  
**Fail:** Browser stays on the thank-you or feedback screen

---

## Step 4 — Below-Threshold Stays Private

1. Open `/r/<slug>` again in a fresh tab or incognito window
2. Tap or click **3 stars** (below the threshold)
3. Watch where the browser goes

**Pass:** Browser stays on the internal feedback form, does **not** redirect to Google  
**Fail:** Browser redirects to Google for a low-rating guest

---

## Checklist Sign-Off

Before marking a deploy as clear, confirm and commit or note:

- [ ] Step 1 — Checkout completed in Stripe test mode
- [ ] Step 2 — DB row has both `google_place_id` AND `google_review_url` populated
- [ ] Step 3 — 5-star redirects to Google ✓
- [ ] Step 4 — 3-star stays on feedback form ✓
- [ ] Tested by: _______________
- [ ] Date: _______________

---

## Notes

- The `google_threshold` default is `4`. This means **4-star and above** redirect to Google,
  not just 5-star. Confirm with the CEO which behavior is intended before the next deploy.
- If you can't run the full Stripe test-mode checkout, at minimum run Step 2 manually by
  inserting a test row with both fields populated and run Steps 3–4. That covers the submit
  route and redirect logic even if it doesn't cover the webhook provisioning path.
- For a failed deploy: use `DRY_RUN=true npx tsx scripts/backfill-google-review-url.ts`
  to identify any newly affected rows, then run without `DRY_RUN` to repair them.

---

# Part 2 — Guest Capture CRM (~15 min)

Skip this section if the guest-capture module is not deployed.

The flow below is the paid tier. If any step fails silently, the agency pitch fails.
Never run the migration directly against prod — always go through a Neon preview branch.

## Step 1 — Migration on preview branch

1. Create or update a Neon **preview branch**. Do **not** point at prod.
2. Run `platform/src/db/migrations/0002_guest_capture.sql` against the preview branch.
3. Immediately verify the brand backfill landed:

```sql
SELECT slug, brand
FROM restaurants
WHERE is_owner = false AND is_regional = false
ORDER BY slug;
```

**Pass:** every row has a non-null `brand`.
**Fail:** any `brand` IS NULL → add a manual `UPDATE restaurants SET brand='…' WHERE slug='…';` and re-verify before promoting.

## Step 2 — Public capture flow

1. Open `/g/<slug>?promo=wine` on a real mobile device (iPhone Safari and Android Chrome,
   cellular not wifi — wifi hides the mobile-NAT rate-limit issue).
2. Fill in name, a real WhatsApp, DD/MM birthday, pick 2 preferences, check consent.
3. Submit → confirmation screen shows the 4-digit code, dual Instagram buttons, privacy
   footer. No error flashes.
4. In DB:

```sql
SELECT id, name, whatsapp, birthday_mmdd, brand, status, validation_code
FROM guests ORDER BY id DESC LIMIT 1;

SELECT COUNT(*) FROM guest_visits WHERE guest_id = <the new id>;
```

**Pass:** one `guests` row, `status='pending_validation'`, `validation_code` is 4 digits.
       Exactly one `guest_visits` row tied to the new guest.
**Fail:** zero or multiple visit rows.

## Step 3 — Already-registered pixel dedup

1. In Meta Events Manager → Test Events, set the code to match `META_CAPI_TEST_EVENT_CODE`
   on the preview env.
2. Repeat Step 2 with a different WhatsApp.
3. Test Events tab should show ONE `Lead` event (not two).

**Pass:** single Lead with Event ID `guest-<id>-<timestamp>`, marked "Deduplicated".
**Fail:** two Lead events with different Event IDs → client and server aren't sharing
         the eventId. Check the `eventID` field in `fbq('track', 'Lead', ..., {eventID})`
         against the CAPI `event_id` in `sendLeadEvent`.

## Step 4 — Staff validation

1. Open `/v/<slug>` on a second device (the "tablet").
2. Enter the 4-digit code from Step 2. Pick a staff member from the dropdown. Pick a
   redemption type. Confirm.
3. Success screen shows guest name + WhatsApp for the waiter to cross-check.
4. In DB:

```sql
SELECT status, validated_at, validated_by, redemption_type, notes
FROM guests WHERE id = <the id>;

SELECT COUNT(*), MAX(logged_by IS NOT NULL) AS any_attributed
FROM guest_visits WHERE guest_id = <the id>;
```

**Pass:** `status='validated'`, `validated_by` = staff id, `redemption_type` matches.
       Still exactly ONE visit row (not two), with `logged_by` now set.
**Fail:** two visit rows (capture-time + validate-time double-counting regression).

## Step 5 — Already-redeemed protection

1. On the tablet, try to validate the same code again.
2. **Pass:** 409 "Este código ya fue validado". No second visit row inserted.
3. **Fail:** 200 OK or a new visit row.

## Step 6 — Dedup on recapture

1. Submit `/g/<slug>` again with the **same** WhatsApp but a different name and birthday.

```sql
SELECT COUNT(*) FROM guests
WHERE whatsapp = '<the normalised phone>' AND brand = '<brand>';

SELECT visit_count
FROM (
  SELECT COUNT(*) AS visit_count
  FROM guest_visits
  WHERE guest_id = <the id>
) t;
```

**Pass:** one `guests` row (not two), `name` = the newer value, visit_count = 2,
       `status='pending_validation'` and a brand-new code.
**Fail:** duplicate `guests` row → unique index is wrong.

## Step 7 — GM dashboard

1. Log in as the GM for the test restaurant.
2. Go to `/guests`. The new guest is visible.
3. Click the row → drawer opens with full info and the current pending code.
4. Type into notes → **Guardar notas** → drawer closes, refreshed view shows new notes.
5. Click **+ Visita** → visit count increments by 1.
6. Click **Exportar CSV** → downloads `invitados-<slug>-<YYYY-MM-DD>.csv`.
7. Open the CSV: header is exactly `phone,fn,ln,email,country`, one row per unique guest,
   phone values are `+52…` format, country column is `mx`.

**Pass:** every action above works. CSV imports cleanly to Meta Custom Audiences (next step).
**Fail:** any break.

## Step 8 — CSV import to Meta

1. Upload the CSV from Step 7 to Meta Business Manager → Audiences → Custom Audience
   → Customer List → Phone Numbers.
2. Note the match rate.

**Pass:** match rate > 30% on a populated list (phone-only match is ~30-60% typical).
**Fail:** match rate = 0 or upload is rejected → check phone format + header names.

## Step 9 — Cross-tenant isolation

Single most important security check. Do not skip.

1. In browser A, log in as GM for **Restaurant X**. Note a guest ID from their `/guests`.
2. In browser B (incognito), log in as GM for **Restaurant Y** (a different restaurant,
   different brand for a stronger test).
3. From browser B's devtools console:

```js
fetch('/api/v1/guests/' + <X_guest_id>, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes: 'pwned' })
}).then(r => r.status).then(console.log);
```

**Pass:** 404. No write landed on X's guest.
**Fail:** 200. X's guest was modified by Y's GM → tenant isolation is broken, do not deploy.

4. Repeat for `POST /api/v1/guests/<X_guest_id>/visit` with `body: '{}'`. Must also 404.

## Step 10 — Rate limits

1. Fire 6 captures in quick succession from the same IP with the same WhatsApp.

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<preview-url>/api/v1/guests/capture \
    -H 'Content-Type: application/json' \
    -d '{"restaurantSlug":"<slug>","name":"Test","whatsapp":"5500000001","birthdayMmdd":"01/01"}'
done
```

**Pass:** first 3 succeed (dedup upserts), then 429 on the 4th because the per-WhatsApp
       limit (3/day) trips before the IP limit (5/min). The exact split depends on timing,
       but SOME 429 appears in the first 6 requests.
**Fail:** all 6 return 200 → rate limits aren't wired. Check `UPSTASH_REDIS_REST_*` env.

## Checklist Sign-Off

Before promoting guest-capture to prod:

- [ ] Step 1 — Migration applied to preview, all `brand` values populated
- [ ] Step 2 — Public capture flow + DB row + one visit
- [ ] Step 3 — Meta Pixel dedup confirmed in Test Events
- [ ] Step 4 — Validation transitions status correctly, no double visit
- [ ] Step 5 — Already-redeemed returns 409
- [ ] Step 6 — Dedup keeps one row, increments visits, regenerates code
- [ ] Step 7 — GM dashboard: view, edit, manual visit, CSV export
- [ ] Step 8 — CSV imports to Meta with non-zero match rate
- [ ] Step 9 — Cross-tenant PATCH/visit both return 404 (security-critical)
- [ ] Step 10 — Rate limit trips within the first 6 capture attempts
- [ ] Tested by: _______________
- [ ] Date: _______________

## Known limitations (document before the agency demo)

- **4-digit code space.** 10,000 possible codes. At ~50 pending codes per restaurant,
  collision probability on a new capture is ~0.5%. Acceptable for demo scale; not for
  10k+ concurrent pending. Escalate if you see collisions.
- **No OTP on WhatsApp.** Format-only validation. A determined attacker could seed
  fake guest rows. Per-WhatsApp rate limit (3/day per brand) is the only mitigation today.
- **No subscription gating.** `plan` column doesn't exist yet — any GM on any tier
  can access `/guests`. Add `plan` + route guard before onboarding the second CRM-tier
  customer.
- **Cross-location dedup caveat.** A guest captured at Location A then Location B of
  the same brand is ONE guest row. The `/guests` view filters by visits at your location,
  so A's GM keeps seeing the guest after they visit B. But the guest's `restaurantId`
  column points to the most recent capture, not the first.
