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

## Bounded 3D asset candidate review, 27 October 2026

The star and NFC signal candidate did not pass the asset gate and was not integrated. Its official DeepSeek brand fidelity score was 7/10, below the required 9/10. The reviewer said the arcs may merge at 128 CSS px, the composition feels right-heavy, and the gold reads too orange. No accepted WebP was produced. Existing draft assets were preserved.

The candidate source is local QA evidence at `.qa/ratetap-matte-star-signal-round1.png`: 802,750 bytes, 1254 x 1254 PNG, RGBA, alpha range 0 to 255, all four corner alpha values 0. SHA-256: `c3edb76616a0197254efcff2445f10edb9915ef15a22c3c80b75d0db65e49271`.

Both official vision requests attached this candidate as their only image and included the complete `DESIGN.md` brand block. They used `deepseek-flash` at `https://api.deepseek.com/chat/completions`. The first request exited 0 but returned an empty assistant body after 12,000 completion tokens; its response evidence is `.qa/ratetap-star-signal-round1-attempt1.txt`. The final same-image retry exited 0 and returned the 7/10 score; its unmodified response is `.qa/ratetap-star-signal-round1-review.txt`. Gate metadata is `.qa/ratetap-star-signal-gate-2026-10-27.txt`.

The final reviewer described a plain white background and 1080 x 810 framing, which do not match the source file's genuine transparency and square dimensions. The final retry helper did not specify a background or those dimensions. The first attempt's generic reviewer boilerplate called the input an iPad screenshot, but the final retry used asset-specific wording; neither helper injected 1080 x 810. The brand block does describe a warm off-white ground, which may have influenced the white-background description. Treat the review's claimed image dimensions as inaccurate.

No asset integration screenshot was captured. Focused layout tests and TypeScript checks were skipped because the candidate failed the asset gate before any component or test source changes. No deployment occurred.

## Final 3D candidate gate, 27 October 2026

One final 3D candidate was generated and reviewed after the initial 7/10 candidate. The final candidate did not pass: the official DeepSeek reviewer scored brand fidelity 6/10. Sharpness and visible grain passed, while optical balance failed and the arcs were only barely distinct at 128 CSS px due to inner-arc occlusion. The reviewer also identified gold and ink material mismatch and a generic rating-plus-wireless reading. Its full unmodified review is `.qa/ratetap-star-signal-final-review.txt`.

The final generated source is `.qa/ratetap-star-signal-final.png`: 840,935 bytes, 1254 x 1254 PNG, RGBA, alpha range 0 to 255, all four corner alpha values 0. SHA-256: `4e64667784c3a8d3eb9f7911804b4c183358ee883eca6a7d7d7b75f525866415`. The generation prompt and review gate metadata are `.qa/ratetap-star-signal-final-generation-prompt.txt` and `.qa/ratetap-star-signal-final-gate-2026-10-27.txt`.

The review call used `deepseek-flash` at `https://api.deepseek.com/chat/completions`, exited 0, and included one image plus the complete `DESIGN.md` brand block. No WebP or integration screenshot was produced. Focused tests and TypeScript checks were skipped because the asset failed review before UI changes. No deployment occurred.

Two actual image generations were used for this brief. The earlier empty review response was an unsuccessful API response and did not consume a generation round.

## US-17 repair batch, 27 October 2026

This is an uncommitted local candidate for the user-authorized combined release. The lead owns final integration, release gates, and shipping; this batch did not deploy anything.

The three correctness regressions are fixed. Historical dessert IDs remain the source of truth for saved quotes: po2 Flan Napolitano at MX$120, po4 Pastel de Kiwi y Plátano at MX$160, po5 Alfajores Argentinos at MX$120, and po6 Crème Brulée at MX$140 are retired but still resolvable. New active IDs po19 through po22 carry the current prices: Flan Napolitano MX$145, Pastel de plátano kiwi MX$170, Trilogía de alfajores MX$135, and Crème brûlée MX$160. New template defaults use active IDs. Historical Carta and Asado tests retain the stored IDs and verify old unit prices, line prices, totals, and serialized configuration.

The holiday dessert picker now keeps previously selected items visible and removable alongside the fixed trio. A rendered WebKit regression starts with a saved Cookie Skillet selection, selects Banoffee, confirms Cookie remains selected in the save payload, then manually removes Cookie and confirms the saved selection is only Banoffee. The quote total remains unchanged while the included dessert options are edited. Vista Cliente phone styling restores 20px vertical and 14px horizontal main padding. The WebKit fixture accounts for its 4px scrollbar by using a 394px outer viewport to assert the 390px CSS viewport, 390px main, and 362px content box.

The deterministic star extraction did not pass the asset gate and was not integrated. The single official `deepseek-flash` review at `https://api.deepseek.com/chat/completions` scored it 4/10. Sharpness and cleanliness failed because the reviewer saw soft edges, glossy orange shading, and a faint edge residue. The reviewer confirmed no remaining black arcs, no holes, and no cut-off star points. It described a white presentation ground, while the submitted PNG has genuine transparency with all four corner alpha values 0. The image may remain in local QA evidence only; no accepted WebP, component integration, or integration screenshot was produced. The full reviewer response is `.qa/ratetap-matte-gold-star-review.txt`, and request/file metadata is `.qa/ratetap-matte-gold-star-gate-2026-10-27.json`.

The local QA derivative is `.qa/ratetap-matte-gold-star.webp`, 33,298 bytes, 768 x 768 WebP with alpha range 0 to 255 and transparent corners. It is unaccepted and was not copied into `public/brand/3d/`. The reproducible processing script is `.qa/ratetap-isolate-gold-star.py`; source and intermediate PNGs were preserved.

Validation passed: the focused suite ran 49 tests across `quote-layout.test.tsx`, `dessert-catalog-2026.test.ts`, `quote-menu-2026.test.ts`, and `holiday-quote-templates.test.ts`; `npx tsc --noEmit` passed; all 10 frozen source hashes in `.qa/3d-release-baseline-2026-10-27.json` match. No deployment occurred.
