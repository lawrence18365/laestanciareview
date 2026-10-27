# Quote builder QA — 27 October 2026

**Status: local candidate only. Not deployed. Visual sign-off pending.**

## Fixed

- Custom `h-1`/`h-2`/`h-3` typography collided with Tailwind height utilities: headings occupied 4/8/12px boxes. Operator headings now have unique names. Regression tests compile real Tailwind and load Playfair locally.
- iPad navigation uses the existing menu button. Title/Save alignment, form tracks, label contrast, touch targets, menu prices and secondary row actions are improved.
- Customer document styling is unchanged. Public/print images are byte-identical; the normalized in-builder document image and all 60 text/style/relative-layout records match the original.
- Official dessert catalogue integrated: 15 year-round items, two $190 October–November items, retired Cookie Skillet retained for existing quotes, three included dessert choices on each holiday menu.

## Verification

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| Vitest | 1,767 passed; 9 skipped |
| Focused real-Tailwind/WebKit layout tests | 19 passed |
| Lint | 0 errors; 74 existing warnings |
| Production build, dummy credentials | Pass |
| 18 WebKit screen/orientation checks | No detected text collisions, cramped heading gaps, undersized controls, sub-12px text, low contrast, clipping or horizontal page overflow |
| All four holiday menus saved through browser, local QA DB | Correct $950/$995/$1,200/$1,450 per person; three included desserts; campaign tag persisted |
| Wine + cocktail on Menú 1 | $1,450/pp, $14,500 for 10 guests |
| Custom dessert picker in October | 17 items; Cookie Skillet absent |
| November/December seasonal boundary | Unit tests pass |

The whole-app browser test with a simulated December clock was stopped: it changed the generated folio during hydration and was not a stable fixture. Do not describe that browser case as passed. Seasonal date-boundary behavior is covered by unit tests.

Fresh dev output was required: a stale development stylesheet still used the old navigation breakpoint even though the production build was correct. Final screenshots below were captured after restarting with regenerated CSS.

## Visual review

DeepSeek Flash's final scores remain **7/10 overall**, approximately **8/10 brand fidelity**. The physical layout defects are fixed, but the design loop has **not** met its 9/10 target. Remaining taste concerns include field hierarchy, secondary metadata and course-group emphasis. Some suggestions conflict with useful product behavior: status belongs on individual quotes, and catalogue prices need not dominate dish choices. Do not blindly apply every vision finding.

Three successive flat scores ended the automatic loop for human review. No generated 3D draft met the brand bar; none is included in the candidate.

## Previews

All data shown is synthetic local QA data.

- [Templates — iPad landscape](qa/quotes-2026-10-27/templates-ipad-landscape.png)
- [Builder — iPad portrait](qa/quotes-2026-10-27/builder-ipad-portrait.png)
- [Quotes — iPad landscape](qa/quotes-2026-10-27/quotes-ipad-landscape.png)

No physical iPad or production authenticated builder check was performed in this pass. No new production migration is needed: 0035 was applied during the earlier holiday-menu release.
