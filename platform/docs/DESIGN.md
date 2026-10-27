# RateTap app design rules

Read this before changing any operator-facing screen. The brand block is sent
with every design review. Rules are numbered and testable; delete a rule that
turns out wrong instead of adding a contradicting one.

## Brand block

**Identity: RateTap "Editorial Brutalist".** Warm off-white ground `#F9F9F8`,
white panels `#FFFFFF`, ink `#111111`, muted text `#666666`. Solid ink borders
(1–2px), **square corners (radius 0)**, hard offset shadows
(`4px 4px 0 rgba(0,0,0,.06)`, `8px 8px 0 rgba(0,0,0,.08)`), no blur shadows.
One accent: **gold `#D97706`**, the colour of the rating stars. Display type is
Playfair Display; UI type is Inter; small labels are uppercase Inter with
tracking. Register: confident, editorial, operational. Tokens live in
`src/app/globals.css` `:root`.

**What it is not:** rounded pastel SaaS cards, gradients, glassmorphism,
purple/indigo, emoji decoration, soft drop shadows, playful bounce.

**Frozen:** the client-facing quote (Vista Cliente, `/q/[token]`, print/PDF)
carries La Estancia's brand, not RateTap's, and is out of scope for RateTap
styling and animation.

**Audience:** restaurant managers and event coordinators (e.g. Leslie at La
Estancia León) on an **iPad, landscape and portrait, usually as the home-screen
app**, between calls. The quote builder's single decision: pick a menu, set the
guest count, send the proposal — in under two minutes.

**Content constraints:** Spanish UI. Never invent prices, dishes, claims or
outcomes. No eyebrows (kicker labels above headings). Section body ≤ 25 words.
One primary CTA per screen.

## Rules

1. **Safe area.** The app runs standalone with a `black-translucent` status bar.
   Anything pinned to the top must clear `env(safe-area-inset-top)`; sticky
   offsets use `var(--app-nav-h)`, never a hardcoded `56px`.
2. **No text-on-text.** At 1080×810 and 810×1080 (iPad, WebKit), no two text
   elements may visibly overlap, at scroll 0 or scrolled.
3. **Touch targets** are at least 44×44px on iPad.
4. **Prices are the loudest number on a card**: ≥ 22px, ink colour, never grey
   small caps.
5. **Say it once.** Text shared by every card in a group (subtitle, "ideal
   para") moves to the group heading, not repeated per card.
6. **Whole card is the target.** A card that selects something is itself the
   button; no full-width black button inside every card.
7. **Motion is a garnish.** 3D/animated touches stay under 400ms, use
   transform/opacity only, never block input, and are disabled under
   `prefers-reduced-motion: reduce`. Never on client-facing pages.

## Quote operator layout checks

Keep layout repairs inside operator chrome. The builder root also contains
`QuotePreview`, so inherited letter spacing and generic `.h-*` rules can affect
the frozen client document even when `.quote-doc` CSS has not changed.

- Tablet builder chrome is static through 1180px; global navigation stays sticky.
- Keep 12px between headings and helpers, 8px between template titles and prices,
  and 16px before dish lists. Use content height rather than a fold target.
- Operator labels and metadata are at least 12px. Inputs, native selects, tabs
  and interactive labels have a 44px minimum target. Check computed WebKit sizes.
- Use `src/__tests__/quote-layout.test.tsx` for isolated WebKit regressions with
  synthetic state and blocked network requests. No application server is needed.
- The owning QA lead can run `node scripts/qa-quotes-layout.mjs --url <fixture>`
  against their existing synthetic fixture. It measures clipped text ranges in
  both orientations, requires both texts visible, and does not save or send.
  Browser checks do not replace public, print and Vista document hash checks.
