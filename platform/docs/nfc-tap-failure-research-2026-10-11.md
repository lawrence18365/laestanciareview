# Per-waiter NFC cards for restaurants in Mexico — why ~1 in 4–5 first taps fails, and what the market does about it

**Research date:** data pulled live from sources; StatCounter figures are for **September 2026**. All unsourced numbers are labelled **estimate** with the derivation shown.

---

## TL;DR (6 lines)

1. **iPhone is not your problem.** Every iPhone from the **XS/XR (2018) onward** reads an NDEF URL tag in the background with no app — ~**97%** of the iPhones actually browsing the web in Mexico run iOS 18+, i.e. XS-or-newer (derived from StatCounter iOS-version share). Only **~3%** are iPhone X/8/7, which need Control Center.
2. **Android hardware is your problem.** Mexico is ~**72% Android / 28% iOS** (StatCounter MX, Sep 2026), and the top-selling phones in LATAM include models **without NFC** (Samsung **Galaxy A06 — the #1 seller in LATAM in 2025 — has no NFC**). A defensible range for Mexican Android handsets with **no NFC at all** is **~20–40% (mid ~28%)**.
3. **Bottom-up first-tap failure model ≈ 28% (low) / 39% (mid) / 53% (high)**, driven mostly by Android-no-NFC and Android-NFC-off. Since the waiter's "1 in 4–5" (20–25%) field report lands at the *optimistic* end, plan on a realistic **20–35% first-tap failure rate**, with a meaningful minority of Android guests who can **never** tap.
4. **The single best-documented cause on iPhones is a phone that is locked / screen-off or held at the wrong spot** (antenna is at the **top edge**, not the Apple logo) — both are fixed by design + a one-line staff script, not by better hardware.
5. **Every serious vendor already ships dual NFC + QR.** Vendor-reported acceptance: **NFC-only 78% vs QR-only 92% vs NFC+QR 96%** — i.e. printing a QR next to the tap zone is the industry-standard fix (unverified vendor data).
6. **Nobody publishes a real first-tap success rate.** The best numbers are vendor blogs (treat as marketing), one academic paper saying NFC is unavailable on "nearly half of smartphones", and TfL's tap-decline rate of **1–2%** (payments, not reads). Plan on measuring your own.

---

## Q1 — iPhone: models, conditions, antenna

### Which models read tags in the background (no app)
| Model generation | Capability |
|---|---|
| iPhone 7 / 7 Plus, 8 / 8 Plus, X | Core NFC only — **no background reading**; user must open the **NFC Tag Reader in Control Center** (or a 3rd-party app). On 7/8: swipe up; on X: swipe down from top-right. |
| **iPhone XS / XS Max / XR (2018) and later** (11, 12, 13, 14, 15, 16, 17, SE 2nd/3rd gen…) | **Background tag reading** — the system scans automatically when the display is on; no app, no toggle. |

Source: [Apple Developer — Adding Support for Background Tag Reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading); [MacRumors (Sept 2018)](https://www.macrumors.com/2018/09/12/2018-iphones-background-nfc-tag-reading/); [9to5Mac](https://9to5mac.com/2018/09/12/iphone-xs-and-iphone-xr-can-read-nfc-tags-without-having-to-launch-an-app/).

Note: the iPhone XS/XR are now stuck at **iOS 18** (they were cut from iOS 26, which requires A13/iPhone 11+), but they **keep background NFC reading** — the feature is hardware+OS-generation, not tied to the newest iOS. Source: [MacRumors — iOS 26 is compatible with iPhone 11 and newer](https://www.macrumors.com/2025/06/09/ios-26-supports-iphone-11-and-newer/).

### Conditions that block a background read (sourced, Apple official)
Background reading happens only **while the phone is "in use"** (display **on** — lock-screen display counts, but the user must then **tap the notification** and may need to unlock). It is **unavailable** when:
- the device has **never been unlocked** since boot;
- a Core NFC reader session is already running;
- **Apple Pay / Wallet is in use**;
- **the Camera app is in use**;
- **Airplane Mode** is on.

Source: [Apple Developer docs](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading); [Apple Tech Talk "What's New in Core NFC"](https://developer.apple.com/videos/play/tech-talks/702/); [Nordic Semiconductor](https://blog.nordicsemi.com/getconnected/native-nfc-support-in-new-iphone).

Practical implication for a restaurant: **screen off = no read.** A guest who has just locked their phone and taps it will fail on the first try — this is widely cited as the single most common "it didn't work" cause ([Cardify](https://cardify.om/blog/do-nfc-business-cards-work-on-iphone); [Tapify](https://tapify.app/learn/nfc-iphone)). The reading also only triggers on an **NDEF URI record** (URL), which is exactly what you encode — good.

### Where the antenna is, and does the wrong spot fail?
Yes — tapping the wrong spot fails. On **iPhone 12/13/14/15/16** (and XR–11) the NFC antenna is at the **very top edge of the back, near the camera**, *not* in the middle where the Apple logo is. Guides explicitly warn: "Do not tap the middle (where the Apple logo is); it won't work" — the "iPhone head-butt".
Sources: [Tapmo.in](https://tapmo.in/blogs/news/android-vs-iphone-nfc-subtle-differences-you-should-know); [BusinessCards.io](https://businesscards.io/help/adding-your-card-to-an-nfc-tag-on-ios); [LetsConnectCard](https://letsconnectcard.com/guides/nfc-phone-compatibility); [CargoBeacon/EverTag phone guide](https://www.cargobeacon.com/es/resources/evertag-nfc-phone-guide).

**Takeaways:** the iPhone-side failure modes you can actually fix are (a) screen off/locked, (b) camera or Wallet open, (c) tapping the center instead of the top edge. None require newer hardware.

---

## Q2 — Android: NFC hardware, defaults, antenna

### Do the popular budget models in Mexico have NFC?
Mexico's best-sellers are the same cheap models that lead LATAM. Counterpoint's 2025 LATAM Top-10: **Galaxy A06 (#1), Galaxy A16 4G, Moto G15, Redmi 14C, Galaxy A15, Moto G05, Redmi A5, Moto G35 5G, Galaxy A56, Redmi Note 14 4G** ([Counterpoint / Communications Today](https://www.communicationstoday.co.in/samsung-tops-latin-america-smartphone-bestseller-list-in-2025/); [Xataka MX](https://www.xataka.com.mx/celulares-y-smartphones/samsung-xiaomi-motorola-tienen-celulares-vendidos-latinoamerica-ninguno-pasa-8-000-pesos)).

NFC status of those models (as sold in LATAM/Mexico SKUs):

| Model | NFC | Note |
|---|---|---|
| Samsung **Galaxy A06** (LATAM #1 seller 2025) | **No** | Consistent across sources; no contactless payments. [Notebookcheck](https://www.notebookcheck.net/Affordable-Galaxy-makes-the-most-of-its-budget-Samsung-Galaxy-A06-review.1096613.0.html) |
| Samsung Galaxy A16 4G | **Yes** | Listed as standard in most regions. |
| Samsung Galaxy A15 4G | Yes (region-dependent) | |
| Samsung Galaxy A03 / A04 | **No** | LATAM SKUs. [Three UK device guide — A04 "NFC: No"](https://devicesupport.three.co.uk/guides/device/Samsung/GalaxyA04) |
| Motorola **Moto E14** | **No** | Motorola LATAM support page. [Motorola ES-LATAM](https://es-latam.support.motorola.com/app/answers/detail/a_id/180550) |
| Motorola Moto G14 (MX) | **No** | MX retail listings; EU variant *has* NFC. [Mercado Libre MX](https://www.mercadolibre.com.mx/moto-g14-dual-sim-128-gb-gris-oscuro-4-gb-ram/p/MLM44161729) |
| Motorola **Moto G05** | **No** except model **XT2523-11** | Motorola's own guide: "NFC is only available on model XT2523-11". [Motorola ES-LATAM](https://es-latam.support.motorola.com/app/answers/detail/a_id/183395/) |
| Motorola Moto G15 | **Yes** (region-dependent) | [Motorola ES-LATAM](https://es-latam.support.motorola.com/app/answers/detail/a_id/184128/) |
| Motorola Moto G35 5G | **Yes** (global) / No (India SKU) | Motorola: "only some versions … support this feature". |
| Xiaomi **Redmi A5 4G** | **No** | Standard 4G unit lacks it. [Versus comparison](https://versus.com/es/motorola-moto-e14-vs-xiaomi-redmi-a5-4g) |
| Xiaomi Redmi 14C | **Yes** (region-dependent) | Xiaomi FAQ confirms. [Xiaomi FAQ](https://www.mi.com/hk/support/faq/details/KA-685700/) |
| Xiaomi Redmi Note 14 4G | **Yes** (market-dependent) | GSMArena: "Yes (market/region dependent)". |
| Xiaomi Redmi 12C / A3 | **No** | |

**Pattern:** NFC presence tracks price and SKU. The *cheapest* mass sellers (**Galaxy A06**, **Redmi A5 4G**, **Moto G05 base**, **Moto E14**, **Galaxy A03/A04**) **have no NFC**; the mid-tier models most restaurants' younger/middle-class guests carry generally **do**. The rule "same model name ≠ same NFC" is the key operational hazard — always verify the **model code** (e.g. `XT2523-11`, `SM-A165M`) ([Motorola](https://es-latam.support.motorola.com/app/answers/detail/a_id/183395/)).

### Is NFC ON or OFF by default on Android?
There is **no universal default** — it is an OEM/region firmware choice. Sources conflict:
- Usually **ON** on phones that also do contactless payment, and Android historically ships it enabled ([gHacks](https://www.ghacks.net/2012/10/16/turn-off-nfc-on-your-android-phone-to-save-battery-and-make-it-more-secure/); [Cardify](https://cardify.om/blog/do-nfc-business-cards-work-on-iphone)); Xataka México says the feature is on by default ([Xataka MX](https://www.xataka.com.mx/celulares-y-smartphones/que-significa-simbolo-n-tu-celular-que-utilidad-activarlo)).
- Some OEMs/regions ship it **OFF** or disable it in firmware (La República lists Samsung, Oppo, Motorola, Xiaomi, Honor, Vivo, Realme as "suele venir desactivada por defecto"; Xiaomi India ROMs disable NFC even when hardware is present) ([La República](https://larepublica.pe/tecnologia/2023/11/17/que-es-la-funcion-nfc-de-tu-celular-y-por-que-debes-activarla-si-usas-la-billetera-de-google-299761); [XDA](https://xdaforums.com/t/nfc.3949775/)).
- Vendor troubleshooting attributes **~30% of all reported Android NFC failures** to the toggle being off ([TapiLink](https://tapilink.co.uk/blog/how-far-do-nfc-business-cards-work)) — **marketing estimate, not measured**.

### Android antenna position
Mostly **center-to-upper-center of the back**, and it **varies by model** (Samsung S23 center, Pixel 6a/7 Pro center, iPhone top). Practical advice: hold flat and slide slowly from center toward the top until it reads. Sources: [Cryptnox NFC antenna list](https://cryptnox.com/phones-antennae-nfc/); [DCENT Wallet](https://support.dcentwallet.com/hc-faq/dcent-s-card-wallet/card-scan-not-working); [Fidesmo](https://fidesmo.freshdesk.com/en/support/solutions/articles/79000136220/).

**Implication:** because iPhone reads at the **top edge** and most Androids at the **center**, a card held flat in the middle of the phone works on Android but often **misses on iPhone** — a real, fixable cause of your "first tap failed" reports.

---

## Q3 — Mexico device market

### iOS vs Android (StatCounter Mexico)
Live figures, **September 2026** ([StatCounter OS MX](https://gs.statcounter.com/os-market-share/mobile/mexico)):

| Platform | Share |
|---|---|
| Android | **72.04%** |
| iOS | **27.96%** |

**Caveat — this series is volatile.** The same StatCounter series ran iOS at ~22% through 2023–24, then an **anomalous dip to ~9–11% (Dec 2024–Jun 2025)** — almost certainly a measurement artifact — before recovering to **~28–34%** in late 2025 / 2026. Monthly vendor data I pulled: 2024-09 → iOS 25.7%; 2025-01 → 9.4%; 2025-08 → 15.8%; 2025-12 → 31.1%; 2026-02 → 33.9%. Treat **iOS ≈ 25–30%** as the working number, with a plausible band of **~12% (older sources) to ~34%**. Kantar-era data put Mexico's iOS far lower (~7%) but is old ([Canal AR](https://www.canal-ar.com.ar/20280-Android-domina-el-mercado-Mexicano.html)).

### Share of iPhones that are older than XS (no background reading)
There is **no per-model StatCounter data for Mexico**, so I used a proxy: **iPhones cannot run iOS 17+ if they are an iPhone X/8 or older**, and iPhone 7 maxes at iOS 15.

Mexico iOS **version** share, Sep 2026 ([StatCounter iOS version MX](https://gs.statcounter.com/os-version-market-share/ios/mobile-tablet/mexico)): iOS 26.x ≈ 60%, iOS 18.x ≈ 32%, and the long tail (16.x, 15.x, 14, 12.5, 11, 10.3) sums to **≈ 2.9%**.

- **Derived result: ~3% of iOS devices in Mexico are pre-XS** (iPhone X/8/7/older) and therefore lack background reading → **estimate, ±1–2 pts**. (StatCounter is web-traffic-weighted, so old phones may be slightly under-counted; an app-telemetry sample elsewhere suggests older iPhones are a *larger* share of the installed base. Realistic band **3–8%**.)

### Top Android brands/models in Mexico
StatCounter vendor share, Sep 2026: **Samsung 17.7%, Motorola 9.0%, Xiaomi 7.4%, Oppo 4.6%** (plus a large 23.6% "Unknown" — mostly white-label/budget Android). Sell-through (Omdia, Q3 2025): **Samsung 23%, Xiaomi 18%, Motorola 13%, Oppo 11%, Apple 9%** ([eetrend/Omdia](https://www.eetrend.com/content/2025/100597046.html)). Top models = the LATAM Top-10 list in Q2.

---

## Q4 — Bottom-up estimate: share of guests whose phone CANNOT read the tag on first tap

**Inputs (mid values in bold):**

| Input | Low | **Mid** | High | Basis |
|---|---|---|---|---|
| iOS share of guests | 22% | **28%** | 34% | StatCounter MX Sep 2026 (restaurant guests may skew *higher* iOS) |
| iOS → pre-XS (no background reading) | 3% | **4%** | 8% | iOS ≤16 version share proxy |
| iOS XS+ → first-tap fails (screen off, camera/Wallet open, wrong spot, case) | 5% | **12%** | 22% | Apple conditions list + design-guide evidence; **estimate** |
| Android → **no NFC hardware** | 20% | **28%** | 38% | derived below |
| Android **with** NFC → NFC toggled **off** | 10% | **18%** | 30% | TapiLink "30% of failures" ⇒ partial; **estimate** |
| Android with NFC on → first tap fails (locked screen, wrong spot, case, quick tap) | 8% | **12%** | 20% | troubleshooting guides; **estimate** |

**Android no-NFC derivation (why mid ≈ 28%):**
- A Mexico payments study (2023) states **~75% of active Mexican smartphones are NFC-enabled** → ~25% lack it. If iPhones essentially all have NFC, then 25% ÷ ~72% Android share ≈ **34% of Android lacks NFC** ([payments ebook](https://downloads.ctfassets.net/51xdqw3t2p/BFaypUWHwedamc5nQK9lK/bdbdfec3280480f234204bd7f5e36952/Ebook_-_Tendencias_de_pagos_digitales_2023_-_Espan__ol__1_.pdf); corroborated by [Ingenico/Mastercard](https://ingenico.com/latam-es/noticias/blogs/evoluciona-con-los-pagos-contactless)).
- LATAM Top-10 model analysis: ~3 of 10 highest-volume models (Galaxy A06, Moto G05 base, Redmi A5) **lack NFC** → ~30%.
- Global academic floor: one peer-reviewed paper says NFC is "**unavailable in nearly half of the smartphones** in the market" ([ACM MobiCom, MagCode](https://dl.acm.org/doi/10.1145/3570361.3614079)).
- Balancing these, **mid = 28%** with a wide band **20–40%**.

**Arithmetic**

- P(iOS fails) = 0.04 + (1 − 0.04)·iOS_XS+_fail
- P(Android fails) = 1 − (1 − no_NFC)·(1 − off)·(1 − firsttap_fail)

**Mid:**
- iOS: 0.04 + 0.96 × 0.12 = **0.155**
- Android: 1 − (0.72)(0.82)(0.88) = 1 − 0.5196 = **0.480**
- **Overall = 0.28 × 0.155 + 0.72 × 0.480 = 0.043 + 0.346 = 0.389 → ≈ 39%**

**Low:**
- iOS: 0.03 + 0.97 × 0.05 = 0.0785
- Android: 1 − (0.80)(0.90)(0.92) = 1 − 0.6624 = 0.338
- **Overall = 0.22 × 0.0785 + 0.78 × 0.338 = 0.017 + 0.264 = 0.281 → ≈ 28%**

**High:**
- iOS: 0.08 + 0.92 × 0.22 = 0.282
- Android: 1 − (0.62)(0.70)(0.80) = 1 − 0.347 = 0.653
- **Overall = 0.34 × 0.282 + 0.66 × 0.653 = 0.096 + 0.431 = 0.527 → ≈ 53%**

**Result: first-tap failure ≈ 28% (low) / 39% (mid) / 53% (high).**

**Reconciling with the field report ("1 in 4–5" = 20–25%):** my model puts the true rate **above** the field report. Two honest explanations: (a) waiters probably **pre-screen or demonstrate**, so a fraction of would-be failures never happen on the first attempt; (b) my Android-no-NFC mid (28%) may be too high. The field report therefore sits at the **optimistic end** of the plausible band — treat **20–35% first-tap failure** as the realistic planning range, and **plan that a meaningful minority of guests can never tap at all** (Android-no-NFC), independent of waiter skill. *(All of Q4 is an estimate built from sourced inputs; it is a model, not a measurement.)*

---

## Q5 — Physical layer: chip, antenna, cases, metal

### NTAG213 vs 215 vs 216
The chip choice affects **memory only**, never read range:
| Chip | User memory | Max URL | Best for |
|---|---|---|---|
| NTAG213 | 144 B | ~136 chars | **single short URL — sufficient for `app.ratetapmx.com/r/{slug}`** |
| NTAG215 | 504 B | ~488 chars | long/tracked URLs, vCards, multi-record |
| NTAG216 | 888 B | ~854 chars | overkill for review cards |

Sources: [NXP NTAG213/215/216](https://www.nxp.com/products/NTAG213_215_216); [NXP datasheet](https://www.nxp.com/assets/block-diagram/en/NTAG213_215_216.pdf); [NFCFYI — read range](https://nfcfyi.com/glossary/read-range/); [MakeUseOf](https://www.makeuseof.com/bought-wrong-nfc-tags-missed-tiny-specification/). Commercial review cards commonly ship **NTAG213 or NTAG215**, both fine ([jhsmartcard](https://www.jhsmartcard.com/NTAG213-Vs-NTAG215-Vs-NTAG216-Which-NFC-Chip-Is-Right-for-Rating-Tap-Cards-id05134935.html)).

### Antenna size vs read range
Range is dominated by **antenna geometry**, not the chip. NXP's ceiling is ~100 mm; real-world:
- 25 mm sticker + phone: **1–3 cm**
- credit-card-size antenna + phone: **4–7 cm** (some vendors quote 8–10 cm on modern iPhones)
- on-metal tag with ferrite: ~**1.5 cm–4 cm**

Sources: [NFCFYI read range](https://nfcfyi.com/glossary/read-range/); [NXP AN11276 antenna design](https://media.digikey.com/resources/nxp/nxp-an11276-ntag-antenna-design-guide.pdf); [Proud Tek](https://proudtek.com/solutions/nfc-business-card/). **Practical rule: a full-credit-card inlay gives you ~2–4× the range of a small sticker** — a genuine, cheap upgrade for first-tap success.

### Phone case thickness, MagSafe, PopSockets, wallets
- **The blocker is metal/conductive material, not distance per se.** At 13.56 MHz the field is absorbed in a razor-thin skin depth (~22 µm in aluminium), so even a thin metal plate shields ([NFCFYI — NFC on metal](https://nfcfyi.com/ko/guide/nfc-on-metal/)).
- Reported thresholds (**treat as illustrative, weak sourcing**): leather/plastic lining up to ~1.5 mm reads fine; ~**2 mm of padded lining drops range "effectively to zero"** in one test; a **1.5 mm aluminium plate = complete shield**; wireless-charging-style guidance caps ~**4 mm** total back thickness ([Gstar Technology](https://www.gstartec.com/does-a-magsafe-wallet-affect-nfc-key-facts-for-buyers.html); [Bayelon](https://bayelon.com/blogs/news/why-wireless-charging-fails-with-a-wallet-case)).
- **MagSafe:** Apple places the iPhone NFC antenna *just outside* the magnet ring, so an empty MagSafe wallet usually still works; **wallet cases with their own metal backplate over the antenna zone break NFC** ([Gstar Technology](https://www.gstartec.com/does-a-magsafe-wallet-affect-nfc-key-facts-for-buyers.html)). This is a very common real-world blocker.
- **PopSockets / ring holders / card wallets:** all cited as blocking or detuning NFC on both platforms ([DCENT](https://support.dcentwallet.com/hc-faq/dcent-s-card-wallet/card-scan-not-working); [Fixje.nl](https://www.fixje.nl/iphone-nfc); [Zapped test](https://zapped.to/blog/test-nfc-card-on-multiple-phones)).
- **Tag collision:** stacking multiple NFC chips (e.g. a card wallet full of prior cards) can confuse the reader ([Gstar](https://www.gstartec.com/does-a-magsafe-wallet-affect-nfc-key-facts-for-buyers.html)).

### Metal cards / metal tables
Standard wet inlays on metal lose **80–100%** of read range; you need a **ferrite spacer** (min 0.3 mm, recommended 0.5–1.0 mm, µr ≥ 50). Nitta's ferrite sheet achieves ~4 cm over metal vs ~8 cm in free space ([NFCFYI](https://nfcfyi.com/ko/guide/nfc-on-metal/); [Nitta](https://www.nitta.co.jp/en/product/sheet/magnetic_sheet/)). Independent bench test: non-shielded steel clip attenuates **−18 to −22 dB** ("basically silence"); ferrite-shielded clip only **−2 to −3 dB**. This matters for **stands on metal tables** and for any **metal card** product ([source, weak](https://world.taobao.com/lang/en-us/shopping-guide/2004036611792175104.htm)).

### Published read-success numbers
- NFC on plastic ≈ ~100%; **glass barrier = total read failure**; metal near a full-size antenna raised transmission errors **up to 58.3%** (University of Pisa, via summary).
- Indonesian lab test: metal-mounted tag unreadable until a **≥3 mm spacer** added (then 100%); **0% beyond ~3 cm** gap.
- ETH Zürich product-passport study (Byers et al., 2025): QR and NFC gave **statistically indistinguishable error rates** (p=0.451); NFC was **faster**.
Sources summarised in the vendor/academic roundup: [Pisa](https://arpi.unipi.it); [ETH Zürich Research Collection](https://www.research-collection.ethz.ch/bitstream/handle/20.500.11850/723750/1-s2.0-S0959652625004032-main.pdf).

---

## Q6 — Published first-tap / failure rates (and tap-vs-scan)

**There is no reputable published "first-tap success rate."** What exists:

| Source | Number | Quality |
|---|---|---|
| Wave Connect (vendor) | **NFC-only acceptance 78%**, QR-only 92%, **NFC+QR 96%**; NFC device compatibility 87%; failure split: 13% device incompat, ~5% technical failure, 4% user confusion | **Vendor blog**, unverified |
| TapiLink (vendor) | **~30%** of Android NFC failures = NFC toggle off; ~0.5–1 s contact needed | **Vendor blog** |
| TAPro (vendor support) | >99.95% of scan issues originate in the phone, not the card | **Vendor claim** |
| ACM MobiCom (MagCode, peer-reviewed) | NFC **unavailable on ~half of smartphones** | Academic, but a global/regional hardware framing |
| V1CE, independent reviewer | **~50%** tap success on first card (iPhone 12/X), **8–9/10** after replacement | Single anecdote |
| V1CE, Trustpilot | One trade-show batch "failed **≥95%** of the time"; another "works only half the time" | Customer anecdotes |
| Google-review NFC stands (JUSTAP reviews) | "doesn't read on most phones", "only works with iPhones", "customers give up after several attempts" | Customer reviews |
| Transport for London | contactless **declines 1–2%** (mostly insufficient funds, not read failures) | Operational, payments not reads |
| Apple Developer Forums (dev-collected) | NFC read failures on "Pro" iPhones: 12 Pro 41.5%, 11 Pro Max 33.3%, SE2 25% | **Weak, self-reported** |

Sources: [Wave Connect](https://wavecnct.com/de/blog/qr-code-business-card-vs-nfc-cards); [TapiLink](https://tapilink.co.uk/blog/how-far-do-nfc-business-cards-work); [TAPro troubleshooting](https://taprocard.com/pages/nfc-setup-troubleshooting); [ACM MagCode](https://dl.acm.org/doi/10.1145/3570361.3614079); [Zapped (V1CE + Trustpilot)](https://zapped.to/blog/nfc-business-card-not-working); [loox.io JUSTAP reviews](https://loox.io/s/EyXudIN2q?page=15); [TfL briefing](https://www.whatdotheyknow.com); [Apple Developer Forums](https://developer.apple.com/forums/thread/741737).

**Tap-vs-scan ratios (all vendor-sourced, directionally consistent):**
- **Kraft Foods** pilot: NFC engagement **12× higher than QR**; 36% of tappers converted; 48 s average engagement ([PaymentsJournal](https://www.paymentsjournal.com/kraft-foods-pilot-finds-better-value-with-nfc/)).
- **Helsana (CH)** mailing A/B/C: NFC **32%** vs QR **17%** vs plain letter 5% ([markt-kom](https://www.markt-kom.com/en/kreativity/interactive-paper-macht-helsana-in-3d-erlebbar/)).
- **Google-review NFC** conversion: TAProCard "47 businesses" study **63.2% (NFC) vs 8.4% (QR)** completion ([TAPro](https://taprocard.com/blogs/article/reddit-nfc-google-review-cards)); TapSticky 40–60% vs 15–25% ([TapSticky](https://tapsticky.in/blogs/news/nfc-google-review-cards-restaurants)); Niagara 21–32% vs 2–6% ([Niagara](https://niagarastandsout.ca/blogs/business-resources/nfc-review-cards-vs-qr-codes-google-reviews)). *(All vendor marketing.)*
- Restaurant case study: **SI Restaurant (Budapest)** — dual NFC+QR tabletop displays took reviews from **15.2/month to 58.5/month (+285%)** without lowering the rating ([clcme.eu](https://clcme.eu/how-si-restaurant-accelerated-its-google-review-growth-with-tabletop-nfc-displays/) — self-declared "case study, not a controlled experiment").

**Bottom line:** nobody has a clean, independent first-tap rate. Your own instrumentation is the only trustworthy source going forward.

---

## Q7 — Who is solving it, and how

### Global NFC business-card vendors — dual NFC + QR is the *default*, not an upsell
- **Popl, Linq, Blinq, Tapni, V1CE**: all ship or support a **printed QR fallback**. Blinq explicitly says "fall back to the printed QR code if a phone doesn't support NFC… older iPhones (XS and earlier) should use the QR code" ([Blinq](https://support.blinq.me/en/articles/77774-setting-up-your-blinq-nfc-accessories)); Linq: "your QR code is always a reliable backup" ([Linq](https://linqapp-7157564.hs-sites.com/knowledge/how-to-troubleshoot-nfc-tap-issues-on-linq-products)). One independent blog frames it bluntly: *"Any NFC card sold without a QR code on it has optimised for the demo rather than the meeting."* ([Cardify](https://cardify.om/blog/do-nfc-business-cards-work-on-iphone)).
- **Mobilo** prints a **unique QR on the back of every card** as the "safety blanket", and for **metal** cards extends the antenna into the PVC side and tells users to tap with the QR facing the phone ([Mobilo FAQ](https://www.mobilocard.com/faq/how-does-mobilo-help-me-capture-leads-at-events-where-badges-and-apps-already-exist)).
- **dot (dot.cards), Evrycard, HiHello**: "**tap or scan**" is the core marketing promise; Evrycard lets the NFC chip and the QR point to **different** destinations ("dual IDs").

### Google-review "tap-to-review" cards / stands
- Vendors: **TapFive, TAPro, Tapstar, Chipbond, Niagara Stands Out, CAN-TAP, Wetop, MaxReviewer, ASIARFID/Xinyetong**. The near-universal spec is **NFC + printed QR on the same card/stand**, with the chip centred under a printed **"Tap here"** mark.
- **Design conventions that matter for you**: NFC Forum "Wayfinding Mark"; a **hand-with-phone pictogram directly over the antenna**; copy like "Tap or scan to review"; **QR beside the tap zone**; height **90–120 cm standing / 70–80 cm seated**; **never on bare metal without ferrite**; test in situ on ≥2 phone brands. Sources: [Blue Bite CTA guide](https://academy.bluebite.com/posts/how-to-create-an-effective-call-to-action-for-a-qr-code-and-nfc-tag); [ST Microelectronics NFC UX white paper](https://www.st.com/content/ccc/resource/premium_content/document/group0/aa/8a/4c/68/f4/dc/4e/72/White_paper_NFC_design_considerations_for_an_improved_User_Experience/files/BRWPNFCUX0920.pdf); [Mastercard Contactless Optimization](https://www.mastercard.com/contactless/doc/Optimize_Consumer_Contactless_Exp.pdf); [NearField placement guide](https://getnearfield.com/support/markers/where-to-place-a-marker).

### Apple App Clip Codes (iOS-only alternative trigger)
App Clip Codes combine a **visual code + embedded NFC** and can launch a lightweight app without a download — Apple **explicitly recommends restaurant tabletops / POS areas**. Both **NFC and QR/App-Clip-Code** routes exist, with NFC launching on ~iPhone XR/XS+. Embedded tags should be **Type 5 NFC ≥35 mm**. Real deployments: **Kitasando Coffee (Tokyo)** order-and-pay by tap; **Burger King (Taiwan)** table tags. Sources: [Apple HIG — App Clips](https://developer.apple.com/design/human-interface-guidelines/app-clips); [NFCW](https://www.nfcw.com/2020/11/06/369061/); [Restaurant Business](https://www.restaurantbusinessonline.com/technology/little-known-iphone-feature-could-change-restaurant-ordering). App Clips are **iOS-only** and add engineering cost — a *speculative* add-on for you, not a fix for the Android half.

### Mexico
- **RestoRank.mx**: the only public trace is a [ScamAdviser profile](https://www.scamadviser.com/check-website/restorank.mx) — domain registered **2025-07-18**, low traffic, positions itself as "Gestión de reseñas para restaurantes: automatiza y gana más clientes". No public product spec, pricing, or reviews found; no evidence it solves tap failure beyond the standard dual-card approach. *(If this is your platform, the recommendations below still apply to your card hardware.)*
- **Local sellers doing the same thing**: **VentasClick** (package ~**MX$699** — portal + 2 NFC cards), **Tu Imprenta** (custom NFC cards, MX$323–14,499 range), **BiiCards** ("Kit 5 Tarjetas Google Reviews, chip NFC y QR") and other packs on **Mercado Libre MX**, **MaxReviewer** acrylic NFC+QR plaque on **Amazon MX** (~4.6★). Sources: [VentasClick](https://www.ventasclick.com/plan-conecta); [Tu Imprenta](https://tuimprenta.com.mx/etiqueta-producto/tarjeta-nfc/); [Mercado Libre MX](https://www.mercadolibre.com.mx/shorts/clips/RohUDf/kit-5-tarjetas-google-reviews-chip-nfc-codigo-qr); [Amazon MX MaxReviewer](https://www.amazon.com.mx/dp/B0FM151RW7/). **None of them publish a first-tap success rate either** — the whole category hides this number.

**Conclusion for Q7:** the market has converged on **(1) dual NFC + QR as standard, (2) the chip printed under a "tap here" phone icon, (3) staff prompting**. **Nobody has solved the Android-no-NFC and iPhone-screen-off problems with hardware** — they are worked around with the QR fallback. Your differentiation opportunity is *operational* (staff script + in-situ testing + instrumentation), not a better chip.

---

## Q8 — Ranked recommendations (impact × cost × effort)

Ranked by expected value. "Proven" = sourced; "speculative" = reasoned.

| # | Action | Expected effect on first-try success | Cost (MXN) | Effort | Evidence |
|---|---|---|---|---|---|
| 1 | **Keep/print a high-contrast QR on every card, next to the tap zone, encoding the same URL.** | Converts *unrecoverable* tap failures into completions. Total completion ≈ **96%** vs 78% NFC-only (vendor data). Doesn't raise *first-tap* success but raises **task completion** massively. | ~**MX$0–5/card** (print) | Very low | **Proven as industry standard** ([Blinq](https://support.blinq.me/en/articles/77774-setting-up-your-blinq-nfc-accessories), [Wave Connect](https://wavecnct.com/de/blog/qr-code-business-card-vs-nfc-cards) — vendor) |
| 2 | **Print "Desbloquea tu pantalla → toca aquí" with a hand-with-phone icon placed *exactly over the chip*, and tell guests the *top edge* is the sweet spot.** | Directly attacks the two #1 iPhone causes (screen off + wrong spot). **Estimate: recover ~5–15 pts of first-tap failures** on iPhones. | ~MX$0 (artwork) | Very low | **Proven best practice** ([ST](https://www.st.com/…), [Mastercard](https://www.mastercard.com/contactless/doc/Optimize_Consumer_Contactless_Exp.pdf), [NearField](https://getnearfield.com/support/markers/where-to-place-a-marker)) |
| 3 | **Waiter script + short demo.** "Primero desbloquea el teléfono y acerca la *parte de arriba* aquí; si no, escanea este QR." | Reepli reports a verbal ask lifts completion from **15–25% → 30–40%**; the waiter is your only "debugging" layer. **Estimate: +10–20 pts first-tap.** | MX$0 (training) | Low–medium (training) | Partly proven ([Reepli](https://www.reepli.ai/en/resources/nfc-google-review-card/) — vendor) |
| 4 | **Move from a thin sticker to a full credit-card-size NTAG213/215 inlay** (bigger antenna → 4–7 cm vs 1–3 cm). | Bigger coupling window tolerates cases/position error. **Estimate: +5–10 pts** first-tap. | ~MX$20–60/card wholesale (a few pesos more than a sticker) | Low | **Proven physics** ([NFCFYI](https://nfcfyi.com/glossary/read-range/), [NXP AN11276](https://media.digikey.com/resources/nxp/nxp-an11276-ntag-antenna-design-guide.pdf)) |
| 5 | **If the card is ever near metal (metal tables, metal card, wallet-case guests): specify ferrite / anti-metal construction**, or a 3–5 mm spacer. | Restores reads that are otherwise **~0%** over metal. | +**MX$15–40/card** ferrite | Low | **Proven** ([NFCFYI](https://nfcfyi.com/ko/guide/nfc-on-metal/), [Nitta](https://www.nitta.co.jp/en/product/sheet/magnetic_sheet/)) |
| 6 | **Switch from a handheld card to a tabletop stand / coaster** (larger antenna, stable "tap here", works seated). | Widely claimed 3–8× review volume; removes antenna-position guesswork. | Stand ~**MX$150–400** | Medium | Partly proven, mostly vendor ([Proud Tek](https://proudtek.com/compare/nfc-review-card-vs-qr-review-stand/), [SI Restaurant](https://clcme.eu/how-si-restaurant-accelerated-its-google-review-growth-with-tabletop-nfc-displays/)) |
| 7 | **Instrument it.** Per-card/per-waiter codes (you already pass `card={CODE}`) **plus a "did the QR get used?" flag**, and log tap-vs-QR events. | Turns your "1 in 4–5" anecdote into a measured number per restaurant; enables A/B of #2–#4. | ~dev time | Medium | **Speculative but highest long-term value** — nobody in the category publishes this |
| 8 | **Android-specific "how to turn NFC on" mini-guide as a card insert / QR landing step.** | Recovers the ~15–25% of Android users who *have* NFC but have it off. | ~MX$2–5 insert | Low | Speculative (derived from TapiLink "~30% of failures") |
| 9 | **Apple App Clip Code / Wallet pass as an iOS enhancement.** | Only helps the already-small iOS-missing-capability slice; **does not help Android.** | Dev + design cost | High | Speculative for your use case ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/app-clips)) |

**Do first (highest ROI, lowest cost):** #1 + #2 + #3 (QR fallback + printed "unlock & tap here" guidance over the chip + a one-line staff script). These are essentially free, all three are "proven"/standard, and together they address every failure mode that isn't literally "phone has no NFC."

**Cost ceiling to keep in mind:** the whole market lives between **~MX$20–60/card** (China wholesale) and **~MX$90–200/card** (MX retail), stands ~**MX$150–400**. Adding QR, a phone icon, ferrite, or a bigger inlay costs **pennies to tens of pesos** versus the **revenue loss from a failed tap**.

---

## Honest evidence-quality summary

- **Strong (official/technical):** Apple's model cut-off and the block-conditions list; NTAG21x specs; ferrite/metal physics; the antenna-location rules; that a card wallet/MagSafe wallet can kill NFC.
- **Directional (single source, older):** Mexico's ~75% NFC-enabled / ~50% wallet-using figures; the StatCounter Mexico iOS↔Android split (volatile series — this is the biggest uncertainty in Q3).
- **Weak / marketing (treat as claims):** every "conversion rate", "tap-vs-QR ratio" and "~30% of failures = toggle off" number; the Apple-dev-forum per-model failure percentages.
- **Do not exist publicly:** a credible, independent **first-tap success rate** for NFC-from-a-card-to-a-phone. The numbers simply aren't published by anyone — vendors, Google, or academia. **Your own telemetry is the only way to know.**

---

## Source list

**Apple / iOS**
- Apple Developer — Adding Support for Background Tag Reading: https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
- Apple Tech Talk — What's New in Core NFC: https://developer.apple.com/videos/play/tech-talks/702/
- MacRumors — New 2018 iPhones Support Background NFC Tag Reading: https://www.macrumors.com/2018/09/12/2018-iphones-background-nfc-tag-reading/
- MacRumors — iOS 26 supports iPhone 11 and newer: https://www.macrumors.com/2025/06/09/ios-26-supports-iphone-11-and-newer/
- 9to5Mac — iPhone XS/XR read NFC without an app: https://9to5mac.com/2018/09/12/iphone-xs-and-iphone-xr-can-read-nfc-tags-without-having-to-launch-an-app/
- Nordic Semiconductor — native NFC support in new iPhones: https://blog.nordicsemi.com/getconnected/native-nfc-support-in-new-iphone
- Tapmo.in — iPhone vs Android NFC antenna (top edge): https://tapmo.in/blogs/news/android-vs-iphone-nfc-subtle-differences-you-should-know
- BusinessCards.io — writing to a tag on iOS: https://businesscards.io/help/adding-your-card-to-an-nfc-tag-on-ios
- LetsConnectCard — NFC phone compatibility: https://letsconnectcard.com/guides/nfc-phone-compatibility
- Tapify — NFC on iPhone (close Camera/Wallet): https://tapify.app/learn/nfc-iphone
- Apple HIG — App Clips: https://developer.apple.com/design/human-interface-guidelines/app-clips
- NFCW — Kitasando Coffee App Clips: https://www.nfcw.com/2020/11/06/369061/

**Android**
- Cryptnox — NFC antenna locations by phone: https://cryptnox.com/phones-antennae-nfc/
- DCENT Wallet — card won't scan (antenna + cases): https://support.dcentwallet.com/hc-faq/dcent-s-card-wallet/card-scan-not-working
- Motorola ES-LATAM — Moto E14 (NFC: No): https://es-latam.support.motorola.com/app/answers/detail/a_id/180550
- Motorola ES-LATAM — Moto G05 (NFC only on XT2523-11): https://es-latam.support.motorola.com/app/answers/detail/a_id/183395/
- Motorola ES-LATAM — Moto G15: https://es-latam.support.motorola.com/app/answers/detail/a_id/184128/
- Xiaomi FAQ (HK) — Redmi 14C NFC: https://www.mi.com/hk/support/faq/details/KA-685700/
- Notebookcheck — Galaxy A06 review (no NFC): https://www.notebookcheck.net/Affordable-Galaxy-makes-the-most-of-its-budget-Samsung-Galaxy-A06-review.1096613.0.html
- Three UK — Galaxy A04 device guide (NFC: No): https://devicesupport.three.co.uk/guides/device/Samsung/GalaxyA04
- Versus — Moto E14 vs Redmi A5 4G (NFC: No): https://versus.com/es/motorola-moto-e14-vs-xiaomi-redmi-a5-4g
- La República — NFC usually off by default: https://larepublica.pe/tecnologia/2023/11/17/que-es-la-funcion-nfc-de-tu-celular-y-por-que-debes-activarla-si-usas-la-billetera-de-google-299761
- Xataka México — what the "N" icon means: https://www.xataka.com.mx/celulares-y-smartphones/que-significa-simbolo-n-tu-celular-que-utilidad-activarlo
- XDA Forums — Xiaomi India ROMs disable NFC: https://xdaforums.com/t/nfc.3949775/

**Mexico / market data**
- StatCounter — OS market share Mexico: https://gs.statcounter.com/os-market-share/mobile/mexico
- StatCounter — vendor market share Mexico: https://gs.statcounter.com/vendor-market-share/mobile/mexico
- StatCounter — iOS version market share Mexico: https://gs.statcounter.com/os-version-market-share/ios/mobile-tablet/mexico
- StatCounter — Android version market share Mexico: https://gs.statcounter.com/os-version-market-share/android/mobile-tablet/mexico
- Counterpoint / Communications Today — LATAM top-10 models 2025: https://www.communicationstoday.co.in/samsung-tops-latin-america-smartphone-bestseller-list-in-2025/
- Xataka MX — best-selling phones in LATAM: https://www.xataka.com.mx/celulares-y-smartphones/samsung-xiaomi-motorola-tienen-celulares-vendidos-latinoamerica-ninguno-pasa-8-000-pesos
- eetrend / Omdia — Mexico smartphone share Q3 2025: https://www.eetrend.com/content/2025/100597046.html
- Merca20 — smartphone market Mexico: https://www.merca20.com/samsung-o-apple-asi-se-reparte-el-mercado-de-smartphones-en-mexico/
- Ingenico / Mastercard — 75% of phones NFC-enabled (LatAm): https://ingenico.com/latam-es/noticias/blogs/evoluciona-con-los-pagos-contactless
- Payments-trends ebook (Mexico, ~75% NFC-enabled): https://downloads.ctfassets.net/51xdqw3t2p/BFaypUWHwedamc5nQK9lK/bdbdfec3280480f234204bd7f5e36952/Ebook_-_Tendencias_de_pagos_digitales_2023_-_Espan__ol__1_.pdf
- Marketing4eCommerce MX — contactless/wallets Mexico (>50%): https://marketing4ecommerce.mx/contactless-billeteras-digitales-mexico/
- Canal AR — Android dominates Mexico (old Kantar iOS ~7%): https://www.canal-ar.com.ar/20280-Android-domina-el-mercado-Mexicano.html

**Physical layer / NFC tech**
- NXP — NTAG213/215/216 product page: https://www.nxp.com/products/NTAG213_215_216
- NXP — NTAG213/215/216 datasheet: https://www.nxp.com/assets/block-diagram/en/NTAG213_215_216.pdf
- NXP AN11276 — NTAG antenna design guide: https://media.digikey.com/resources/nxp/nxp-an11276-ntag-antenna-design-guide.pdf
- NFCFYI — Read range: https://nfcfyi.com/glossary/read-range/
- NFCFYI — NFC on metal (ferrite): https://nfcfyi.com/ko/guide/nfc-on-metal/
- NFCFYI — Building an NFC product: https://nfcfyi.com/guide/building-nfc-product/
- Nitta — RFID magnetic sheet over metal: https://www.nitta.co.jp/en/product/sheet/magnetic_sheet/
- Gstar Technology — MagSafe wallet & NFC physics: https://www.gstartec.com/does-a-magsafe-wallet-affect-nfc-key-facts-for-buyers.html
- Bayelon — wireless charging with wallet case (~4 mm limit): https://bayelon.com/blogs/news/why-wireless-charging-fails-with-a-wallet-case
- jhsmartcard — NTAG213/215/216 for tap-to-review cards: https://www.jhsmartcard.com/NTAG213-Vs-NTAG215-Vs-NTAG216-Which-NFC-Chip-Is-Right-for-Rating-Tap-Cards-id05134935.html
- MakeUseOf — wrong NFC tag spec: https://www.makeuseof.com/bought-wrong-nfc-tags-missed-tiny-specification/
- ETH Zürich (Byers et al. 2025) — product passport QR/NFC error rates: https://www.research-collection.ethz.ch/bitstream/handle/20.500.11850/723750/1-s2.0-S0959652625004032-main.pdf
- ACM MobiCom — MagCode (NFC unavailable on ~half of smartphones): https://dl.acm.org/doi/10.1145/3570361.3614079

**Vendors / success rates / design**
- Wave Connect — NFC vs QR acceptance (78/92/96%): https://wavecnct.com/de/blog/qr-code-business-card-vs-nfc-cards
- TapiLink — how far NFC cards work (~30% toggle-off): https://tapilink.co.uk/blog/how-far-do-nfc-business-cards-work
- Zapped — NFC business card not working (V1CE 50%, Trustpilot): https://zapped.to/blog/nfc-business-card-not-working
- Cardify — do NFC cards work on iPhone: https://cardify.om/blog/do-nfc-business-cards-work-on-iphone
- Blinq — setting up NFC accessories (QR fallback): https://support.blinq.me/en/articles/77774-setting-up-your-blinq-nfc-accessories
- Linq — troubleshooting taps: https://linqapp-7157564.hs-sites.com/knowledge/how-to-troubleshoot-nfc-tap-issues-on-linq-products
- Mobilo — QR on every card + metal tap guidance: https://www.mobilocard.com/faq/how-does-mobilo-help-me-capture-leads-at-events-where-badges-and-apps-already-exist
- dot.cards — tap or scan: https://dotcards.net/products/dot-bundle
- Evrycard — dual NFC/QR IDs: https://evrycard.co.uk/qr-codes-by-evrycard/
- TAPro — reddit/business completion study (63.2% vs 8.4%): https://taprocard.com/blogs/article/reddit-nfc-google-review-cards
- TAPro — NFC setup troubleshooting: https://taprocard.com/pages/nfc-setup-troubleshooting
- TapSticky — restaurant NFC conversion: https://tapsticky.in/blogs/news/nfc-google-review-cards-restaurants
- Niagara Stands Out — NFC vs QR reviews: https://niagarastandsout.ca/blogs/business-resources/nfc-review-cards-vs-qr-codes-google-reviews
- Reepli — NFC review card (verbal ask uplift): https://www.reepli.ai/en/resources/nfc-google-review-card/
- clcme.eu — SI Restaurant case study: https://clcme.eu/how-si-restaurant-accelerated-its-google-review-growth-with-tabletop-nfc-displays/
- Sharcon — Tap Beer Miami case: https://sharconai.com/cases/600-google-reviews-in-60-days-with-nfc-review-cards
- PaymentsJournal — Kraft NFC 12× QR: https://www.paymentsjournal.com/kraft-foods-pilot-finds-better-value-with-nfc/
- markt-kom — Helsana NFC 32% vs QR 17%: https://www.markt-kom.com/en/kreativity/interactive-paper-macht-helsana-in-3d-erlebbar/
- loox.io — JUSTAP review-stand customer reviews: https://loox.io/s/EyXudIN2q?page=15
- Blue Bite — NFC/QR call-to-action guide: https://academy.bluebite.com/posts/how-to-create-an-effective-call-to-action-for-a-qr-code-and-nfc-tag
- ST Microelectronics — NFC UX white paper: https://www.st.com/content/ccc/resource/premium_content/document/group0/aa/8a/4c/68/f4/dc/4e/72/White_paper_NFC_design_considerations_for_an_improved_User_Experience/files/BRWPNFCUX0920.pdf
- Mastercard — Contactless Optimization: https://www.mastercard.com/contactless/doc/Optimize_Consumer_Contactless_Exp.pdf
- NearField — where to place a marker: https://getnearfield.com/support/markers/where-to-place-a-marker

**Mexico vendors**
- ScamAdviser — restorank.mx: https://www.scamadviser.com/check-website/restorank.mx
- VentasClick — Plan Conecta (NFC review cards): https://www.ventasclick.com/plan-conecta
- Tu Imprenta — tarjetas NFC: https://tuimprenta.com.mx/etiqueta-producto/tarjeta-nfc/
- Mercado Libre MX — Kit 5 tarjetas Google Reviews NFC+QR: https://www.mercadolibre.com.mx/shorts/clips/RohUDf/kit-5-tarjetas-google-reviews-chip-nfc-codigo-qr
- Amazon MX — MaxReviewer NFC+QR plaque: https://www.amazon.com.mx/dp/B0FM151RW7/
- ASIARFID/Xinyetong — NFC Google review cards bulk checklist: https://www.asiarfid.com/nfc-google-review-cards-bulk-order-checklist.html

**Payments reliability (for context)**
- Transport for London contactless briefing (1–2% declines): https://www.whatdotheyknow.com
- Apple Developer Forums — NFC read failure stats (weak): https://developer.apple.com/forums/thread/741737
