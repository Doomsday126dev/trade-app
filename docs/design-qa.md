# Apri implementation QA

## Status

Functional and responsive QA passed for this draft. Production publication is not requested by this task. Independent visual acceptance remains pending, particularly the imagegen-extracted mascot, which is not a pixel-exact copy of the supplied master. This is a review candidate, not a claim of exact logo extraction or production readiness.

## Reference and implementation comparison

Selected references listed in `design-brief.md` were viewed alongside actual 1440px implementation captures, in light and dark, using eight local comparison sheets. Actual 390px and 820px captures and long-page views were also inspected. Native preview identities are in `apri-preview-library.md`.

- Layout: My List retains its original two-column desktop/single-column phone rows and controls. More uses the reference's grouped sections and one Profile. Events uses a selected-week/day agenda plus existing calendar context. Trainers adapts publication time to the existing Favorites rows rather than inventing the reference's global directory.
- Spacing: comfortable row/control targets remain. More heading, description and first action have explicit spacing. Phone bottom navigation remains four direct destinations. Full-page screenshot artifacts from fixed navigation are avoided in user-facing viewport captures.
- Typography: existing system font and hierarchy retained, dark text on warm ivory and light text on charcoal. Readable date with quieter local time; no new font dependency.
- Color and surfaces: warm ivory static paper with clean card surfaces, charcoal dark and gold controls. Semantic priorities and variant flags remain. Small light-theme Shiny/Lucky labels and gold-button foregrounds were darkened for readability.
- Imagery: existing Pokémon files and resolver data are unchanged. Apri retains the no-smile silhouette, folded ear and eye highlights at 34 CSS px, checked at 1× and 2×. Extraction is visually recognizable but not exact master pixels. Paper encoding retains subtle fibers without a conspicuous tile grid in wide/long views; no mathematical seamlessness claim.

## Defects found and addressed

- P1: initial lossless brand assets exceeded the existing startup byte budget. Delivered files now total 6,876 bytes; unchanged performance tests pass.
- P1: More settings dialogs initially returned keyboard focus to the account menu. Each new entry now explicitly supplies its opener for return focus.
- P2: light-theme white text on gold controls and pale Shiny/Lucky labels. Corrected foreground colors; settled-theme More text/navigation contrast passes 4.5:1 in both engines.
- P2: full-page phone screenshots placed fixed navigation across content. Deliver viewport captures, retain full pages as internal evidence.
- Test maintenance: stale tests expected unavailable Worlds 2026 art (already released in baseline), the old More Settings button, and a hidden date filter. Updated to current exact art plus held Gloria fallback, actual grouped destinations, and approved visible-day behavior. The save test now selects the canonical combobox result before toggling flags, preserving real pointer interaction.

No open functional P0/P1 issues found in the qualified flows. Brand fidelity acceptance and a comprehensive all-control contrast audit remain review limitations; focused text contrast is not a full accessibility certification. New copy currently uses English fallback where translations do not yet exist.

## Verification

- `node --test tests/*.test.cjs`: 1,964 passed, 12 skipped, zero failures.
- `playwright.apri-regression.config.cjs`: 106 passed, 6 skipped (existing unsupported/emulator-dependent cases), zero failures. Chromium and WebKit: public shares, exact/held sprites, day/calendar/details/source states, four-tab navigation, 48-row editing, canonical save/reopen, account fencing/replacement and standalone privacy.
- `playwright.apri.config.cjs`: all 14 distinct cases pass across Chromium/WebKit (12 non-contrast cases plus final two settled-theme contrast cases). 36 exact-art rows, 390/820/1440, both themes, long names, empty/loading/error/offline, keyboard More actions and focus, reduced motion, system theme, repeated navigation, 2× phone capture.
- `playwright.apri-performance.config.cjs`: all eight pass. Existing budgets unchanged: desktop and throttled 390/320 startup, 1,000-entry structural bounds and 120-row filtering/editing at 4× CPU.
- Syntax and whitespace checks passed. No changes to auth, database rules, service contracts, catalog data, sprite files, telemetry, privacy notice or deployment workflows.

All fixtures use synthetic identities/data and isolate production mutations. These checks do not constitute a new real-provider login test. Release numbers remain .148 in this preview; a later authorized release must receive fresh immutable qualification and versioning.

## Intentional differences and deferred scope

Events keeps factual time-basis, source and category controls omitted by the mockup, so cards have additional truthful metadata. Trainers retains authorized lookup/Favorites rather than a new all-trainer table. More retains Tools, App & Data and existing help functions. Existing sign-in is unchanged. Priority tabs, discovery/location indexes, onboarding and calendar export are not implemented.
