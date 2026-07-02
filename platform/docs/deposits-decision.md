# Phase 2 — Event deposit collection (decision memo)

**Status:** decision required. No payment code has been written.
**Scope:** how a restaurant collects the "50% anticipo" on an event quote.

## Why this is not the Stripe work we already have

The existing Stripe integration (`src/lib/stripe.ts`, `api/signup/create-checkout`,
`api/stripe/webhook`) is **RateTap charging its own customers** for the SaaS
setup fee. There is exactly one merchant: **RateTap**. Money flows guest-of-
RateTap → RateTap.

Event deposits are a different shape entirely:

- **Payer:** the restaurant's *guest* (the person booking the event)
- **Merchant of record:** the *restaurant* (La Estancia), not RateTap
- **RateTap's role:** platform/facilitator moving money to a third party

Charging on behalf of another business is **payment facilitation**. Reusing the
single-merchant setup-fee code for this would put RateTap in the flow of funds
it doesn't own — creating liability (chargebacks, refunds, KYC, tax/CFDI) that
belongs to the restaurant. **Do not extend the setup-fee checkout for deposits.**

## Options

### Option 1 — Stripe Connect Standard (restaurant owns its Stripe)
Each restaurant connects (or creates) its own Stripe account; RateTap initiates
Checkout on its behalf; the restaurant is merchant of record and receives funds
directly. RateTap can optionally take an `application_fee`.
- **Pros:** restaurant owns funds, refunds, chargebacks, and CFDI. Lowest legal/
  compliance burden for RateTap. Clean separation.
- **Cons:** each location must complete Stripe onboarding (KYC) before it can
  take deposits — real friction for a 16-location group. Stripe card fees (~3.6%
  + IVA in MX) eat into the deposit.

### Option 2 — Stripe Connect Express (RateTap-managed accounts)
RateTap creates and manages Connect Express accounts, owns the onboarding UX and
branding, and orchestrates payouts.
- **Pros:** smoother onboarding, RateTap controls the experience end-to-end.
- **Cons:** materially more responsibility for RateTap (dispute handling,
  account state, payout schedules). Heaviest build. Only worth it if deposits
  become a core, high-volume feature.

### Option 3 — External payment method owned by the restaurant (no Connect)
The public quote page shows the restaurant's own deposit instructions — a Stripe
Payment Link / SPEI (CLABE) transfer details / OXXO reference the restaurant
already uses. RateTap displays it and lets the GM mark the deposit received
manually (advancing the lead to `won`).
- **Pros:** zero payment liability for RateTap, ships in days, no KYC, no Connect.
  Matches how La Estancia almost certainly already collects deposits (SPEI/
  transfer). Works today with the pieces we just built.
- **Cons:** no automatic "paid" reconciliation — the GM confirms receipt
  manually. No card-on-file convenience for the guest.

## Recommendation

**Ship Option 3 first**, then move to **Option 1 (Connect Standard)** when a
restaurant explicitly asks for integrated card deposits.

Rationale: La Estancia already takes deposits by transfer. Surfacing those
instructions on the public quote page — plus a GM "deposit received → won"
action — captures ~80% of the value (guest gets a clear, professional ask;
booking is tracked to close) with ~5% of the build and none of the payment-
facilitation risk. Connect is the right long-term answer, but it should be
demand-pulled by a paying operator, not built on spec.

## Decisions the CEO must make before any Connect build

1. **Merchant of record** — restaurant (Option 1) or RateTap-managed (Option 2)?
2. **Platform fee** — does RateTap take a cut of each deposit, and how much?
3. **CFDI / facturación** — who issues the tax invoice to the guest for the
   deposit? (This follows merchant of record and must be settled with an
   accountant before processing MX card payments.)

## Explicitly out of scope for Phase 1 (already shipped)

Lead → quote linkage, public share link, WhatsApp delivery, and lead lifecycle
(won/lost) are done and do **not** depend on any of the above. A restaurant can
run the full inquiry → quote → send → close loop today; deposits are additive.
