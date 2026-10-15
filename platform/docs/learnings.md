# Learnings log

What we have learned from real data, newest first. Each entry gives the evidence and the sample size, says how sure we are, and names what would change our mind. Add to it after every experiment, and never edit old numbers; add a correction instead.

Confidence: **strong** = big sample or repeated · **directional** = small sample, but it all points one way · **weak** = a guess with a little data.

---

## 2026-10-15 · Meta self-serve trial, first 3 days (Oct 12–14)

Setup: Meta ads, Mexico, ages 25+, FB + IG. Offer: free 30 days, QR only, no card. MX$1,411 spent. Sources: Meta insights (SQ-229) and the prod DB (SQ-230). The DB is the truth for signups.

### Results in one table

| Step | Number |
| --- | --- |
| Spend | MX$1,411 (MX$171 of it wasted on Audience Network, Oct 12) |
| Visitors to /contacto | 196 |
| Started the form | 34 |
| Signed up | 17 |
| Cost per signup | about MX$83 all-in, about MX$70 on clean days |
| Got a real guest rating (not a self-test) | 3 |
| Got a new Google review | 1 (+1 review) |
| Added a waiter | 0 |
| Paying | 0 (first trial ends ~Nov 11) |

### L1. They come to beat the competitor on Google Maps, not to manage waiters. Directional.
- "Más reseñas, mejor posición en Google" (the Maps angle) got 27 of 28 Meta registrations.
- The waiter angle ("ves qué mesero pide la reseña") got 78 visitors and 0 signups (MX$227).
- What they told us at signup: "beat competitor" 5, "more reviews" 4, "customer feedback" 1. In their own words: "Salir primero en Google" and "Tener la mejor calificación de todos".
- Caveat: Meta gave most of the budget to one ad, so the angles didn't get equal tests.
- Would change our mind: a waiter-angle ad, given equal spend, that gets signups.

### L2. The ad pulls any small local business, not restaurant groups. Strong for this ad.
- Only 9 of 17 are clearly food. The others include a laundromat, a liquor store, a dentist, a plumber and an electronics repair shop.
- 15 of 17 have one location, and 10 of 17 said "solo" (no team).
- They're tiny: half have 12 or fewer Google reviews (n=14).
- They're spread across 14 states, with none in León or Guanajuato.
- Best audience: men aged 35–44 (11 of 28 registrations). Ages 65+ took 27% of spend for 1 registration. Women aged 35+ took MX$372 for 0.
- 10 of 11 known devices are Android, and every signup came from the Facebook/Instagram in-app browser.

### L3. Signing up is easy. Getting a result is not. Strong.
- Only 3 of 17 got a real guest rating, and only 1 got a new Google review.
- Most early ratings look like owners testing their own QR (bursts in the first 30 minutes). Self-tests make activation look better than it is, so count only ratings more than 30 minutes after signup.
- 6 of 17 went dark within 24 hours, and one never opened the app at all.
- Why (inference): what they get is a QR code, and the product's way of asking for reviews is waiters. A solo owner has no waiters, so nobody asks.

### L4. The one thing they do is ask people they know. Directional.
- The "Pide 5 reseñas hoy" WhatsApp card was the only action several trials repeated: 5 of 17.
- Email: 10 opens, 0 clicks. Email is not a channel for these users.
- The waiter screens: 0 use.

### L5. Where the signup page loses people. Strong for the first step.
- 83% of visitors leave without starting the form, usually within seconds.
- Half of the people who start never pick their business in the Google search.
- Everyone who picks their business finishes signing up. The form itself isn't the problem; the first step and the Google search are.

### L6. The product page doesn't sell to cold ad traffic. Directional.
- Ads sending people to /producto: MX$516, 174 visitors, 0 signups (Meta and the DB agree).
- Ads sending people straight to /contacto: MX$895, 17 signups.

### L7. Payment is unproven, and the economics are tight. Weak (no trial has ended).
- At MX$83 per signup and MX$700 a month, about 1 in 50 signups paying for 12 months breaks even.
- The leading signs are bad: 0 waiters, 0 email clicks, 1 new Google review in 17 trials.
- The only customer who has ever paid is the opposite shape: Grupo Estancia, with 12 locations, 5 brands and a GM at each site who uses the product every day.

### What this tells us
- The want is real and cheap to reach: "rank above the place next door on Google Maps", at about MX$80 a signup.
- The product doesn't deliver that want for a business with no staff. They get a tool, not a result.
- Two different businesses are in the data. Don't blur them:
  1. **Groups with waiters**: proven buyer, sales-led, no ads needed.
  2. **Small businesses who want to rank on Maps**: proven demand, unproven payment. The product would have to deliver "you climbed on Maps" without waiters.

### Open questions and the cheapest test for each
- Will any small business pay MX$700? Ask the live trials directly over WhatsApp before Nov 11, rather than waiting for trial ends.
- Can a solo owner move their Maps rank in 30 days? Watch the rank tracker on trials that use the Pide-5 card; it has only 1 run per trial so far.
- Does the waiter angle ever pull, given a fair budget? Test it only if we decide to keep self-serve for restaurants with staff.

### Decisions taken (2026-10-15)
- **Groups = revenue now.** Founder outreach to the top 10 groups with waiters (6–20 locations, multi-brand).
- **Maps for small businesses = test payment first.** WhatsApp all 17 trials with one new question: "If WE got you up on Google Maps vs your competitor, with a monthly rank report, would you pay? How much?" This is the done-for-you local SEO offer (like 7FigureLocal or menciones.ai), tested before anything is built.
- **Build nothing more for solo owners until 2–3 of them say yes, with a price.**
- **Update later the same day:** don't build a separate Maps product on this evidence; signups don't prove payment. Meta campaign PAUSED 2026-10-15. **Next milestone: a second paying group.** Help the 5 strongest trials reach a real result, then ask them to pay. Custom software stays the main new commercial offer, as already agreed.
- **If ads restart:** target men aged 35–44, exclude 65+, send the ad straight to the signup form, never to /producto, and use FB + IG only (never Audience Network).

### Data gaps found
- One trial has no events and no signup_completed row (cause unknown).
- The email open count disagrees by 1 between the funnel script and a direct count.
- Meta returns no conversions by state, and learning status is unavailable through the MCP.
- `trial:funnel --split <date>` cuts at midnight, not at the deploy time. Use the exact deploy time.
- The Grupo Estancia benchmark is weak: all 12 locations share one created_at (an import), and there is no behaviour tracking before 2026-08-21.
