# Nine released costume artwork corrections — local review

Base: deployed .142 runtime `2bec47c137361e43867fb5f767d6d1f567a2a0e8`. No production writes, publication or redesign.

## Changes

- Exact normal/Shiny artwork for Friede-goggles Charmander, Charmeleon, Charizard; witch-hat Teddiursa, Ursaring, Ursaluna; pink-sunglasses Galarian Corsola; headband Noibat, Noivern.
- Twenty source-backed image files, including Ursaring's separate female model. No base-species, normal-for-Shiny or different-costume fallback.
- Friede evolutions added to the actual selectable catalogue, preserving exact names and saved IDs.
- Quick-add → Flags & details now refreshes gender options after prefilling the name. Single-gender costumes cannot show impossible new choices through this entry path. Existing conflicting saved qualifiers remain untouched.
- Seven ambiguous legacy identities retained: Gloria, Victor, unspecified GO Fest 2023, unspecified GO Fest 2024, unspecified Jeju, Slakoth Night Cap, unspecified Pumpkaboo Spooky. They require identity clarification, not guessed artwork.

## Verification

- Full local test suite: 1,934 passed, zero failed, 12 existing skips.
- Pages release suite: 111 passed; domain, community and identity contracts passed.
- Costume sprite checks: 18 passed, generated runtime/public dex current.
- New browser cases: nine passed across Chromium 390px/1440px and WebKit 390px. Each verifies all nine identities, 36 normal/Shiny/gender renderings, synthetic add/acknowledgement/reopen/public projection and quick-add gender/cancel.
- All fourteen PokéMod source bytes matched immutable Git blob hashes. Six Friede PNG conversions matched all decoded source pixels. Labelled source contact sheets inspected locally.

Firebase transport is simulated; IndexedDB and the app's controller/rendering are real. No claim of real production persistence, physical iOS/Android testing or live deployment. Current normal-only mapping inventory remains 364 rows (90 Pikachu); those are review candidates, not 364 established released-Shiny defects. A separate bounded Shiny Pikachu batch is next.

## Publication

Local review candidate only. Required GitHub CI, exact runtime/control registration, explicit reviewed gap-baseline delta and production verification remain release steps. Preserve the existing monitoring baseline expiry; never auto-acknowledge new gaps.
