# Consolidated exact Shiny artwork candidate

This local candidate completes the 173 released-Shiny mappings in the reviewed 178-entry inventory. It includes the prior 20-entry checkpoint (`1756997dbf4c8b13d43b58e98fd9640b5139fa9e`) and the remaining 153 verified mappings, based on released runtime `77d5a85e297e783a81ecc0977df19babe826ccef` (.146). It has not been registered, pushed, tagged, or deployed.

## Source and scope

- Manifest: Library `libfile_72f1c868b0f8819189685833d983881e`, v0, SHA256 `bc82ed55eeb85d4cd0ef2db942e11d040dd872611e9bfc3fce3fd350c1ab0009`.
- Classification: Library `libfile_042ca49892948191b2d7e117f15339ac`, v1, SHA256 `eaae9add57ff635096126f1c429de6021085b4f099c3625f83b5b9cfb1b203cb`.
- Portable source bundle: Library `libfile_4dc7a764a2ec8191a2161eb617b2ce1e`, v0, SHA256 `7db92d575e6a3ff424454ce52be07f215d46dcf2f815bc8f660fc2d42234287e`.
- Pinned sprite/source identity commit: `5c6bb56c4026e5fe3cd146910c7e9dad9f07d716` in Gabrielense/pogorewind. Release evidence is recorded separately for each exact form; asset existence is not release evidence.
- All 366 original PNGs were verified against their SHA256, byte length, dimensions, transparency, and supplied Git blob hashes. All 173 names/dex/source IDs matched the pinned named CSV and current catalog. All 33 source QA sheets were visually inspected.
- 184 Shiny source assignments use 183 files, because two existing Gengar identities share the same exact costume art. Quagsire retains distinct published male/female file paths even though the front-view pixels match.
- Relative to .146: 183 original Shiny files, 3,131,037 bytes; 173 changed catalog entries. Relative to the 20-entry checkpoint: 161 files and 153 entries. No source image edits, normal-art substitution, identity merging, or saved-record rewrites.
- Every one of the existing 524 normal-art references retains its original path and SHA256. All 219 held/unrelated catalog entries in the frozen scope ledger remain byte-equivalent as JSON records.

## Gender and identity behavior

New fixed-species boundaries cover Nidoqueen, Nidoking, Smoochum, and the three Wormadam cloaks. The two Ditto costumes, Falinks, and Gimmighoul are genderless. The catalog validator permits an empty gender list only with the immutable reviewed genderless proof; the existing editor and resolver already support that representation. Existing incompatible saved gender qualifiers survive edit/cancel/save/reload without silent correction.

Distinct published female artwork remains distinct. Shared artwork is used only for the same exact form with no visual gender difference. Pumpkaboo/Gourgeist sizes, Wormadam cloaks, Furfrou trims, Oricorio forms, and all costume identities keep their individual mappings. Legacy names such as Ditto Blue/Yellow Party Hat and Gengar Spooky Hat are preserved; source identity notes document the mapping.

## Qualification

- `node --test tests/*.test.cjs`: **1,963 passed, 12 existing skips, zero failures**.
- `npx playwright test --config=playwright.consolidated-shiny.config.cjs`: **40 passed** across Chromium and WebKit at 390 × 844. Every normal/Shiny mapping is selected through the actual picker, saved, reopened after reload, and checked on the shared list. All 664 valid normal/Shiny/gender models decode to their exact expected paths. Fourteen fixed/genderless legacy-conflict cases preserve saved data and cancellation makes no writes.
- `npx playwright test --config=playwright.consolidated-anonymous.config.cjs`: **4 passed** at 1440 × 1000. The separate anonymous bootstrap renders all 173 names with exact normal/Shiny art, using the unchanged 80/160/173-row Show more pagination. It performs only the approved public-share read, loads no Auth SDK/private application modules, and makes no private reads.
- `npm run check:costume-sprites`: passed, generated catalog and public dex current.
- `node scripts/check-costume-sprite-freshness.cjs --offline`: passed, zero integrity issues or stale reviews. No source discovery or baseline refresh is required for this candidate.
- `node scripts/pages/validate-release.cjs --local`: passed; 1,092 frontend files and 90 scripts. The built artifact has 1,093 files including its generated manifest.
- Frozen inventory audit: 178 entries reconciled, 173 mapped/verified, five unreleased, zero source-review pending. Normal paths/bytes and all outside-scope entries unchanged.
- Actual phone and desktop screenshots were inspected for exact art, readable labels, and overflow. Local screenshots and logs are in `/tmp/consolidated-review/` and `/tmp/consolidated-*.log`.

The initial overbroad test command also selected Functions emulator suites without their required emulators/private local harness and ran browser fixtures in the restricted sandbox. Those prerequisite failures were not treated as product regressions or bypassed; the complete product suite above was rerun with its required local browser access. Anonymous harness assumptions were corrected to use the existing pagination and visible card-name selector; application behavior and performance limits were unchanged.

## Explicit remaining holds

Nineteen exact normal-only entries remain:

- Nine unreleased Shiny/forms: Clone Venusaur, Charizard, Blastoise and Pikachu; Armored Mewtwo; Meloetta Hat Flygon; PhD Pikachu; Fancy and Poké Ball Vivillon.
- Eight released Shiny Spinda patterns (1–8) awaiting exact current spot-pattern artwork. These are not classified as unreleased.
- Two ambiguous Detective identities: generic Pikachu and Raichu, awaiting explicit identification.

The seven separate ambiguous/unavailable catalog records remain unchanged. The candidate does not claim that all unresolved identities are solved.

## Publication boundary

Application code, public-share application code, HTML/CSS, service worker, authentication, read contracts, workflow guards, permissions, performance budgets, baseline expiry, and release controls are unchanged from .146. Only exact asset mappings/runtime data, reviewed gender metadata, provenance validation, packaging asset lists, and tests are extended. This is one consolidated local candidate for review; publication remains pending user approval.
