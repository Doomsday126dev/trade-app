# Apri implementation QA

## Status

Functional and responsive QA passed for this draft, including the subsequently approved priority selector. Production publication is not requested by this task. Independent visual acceptance remains pending, particularly the imagegen-extracted mascot, which is not a pixel-exact copy of the supplied master. This is a review candidate, not a claim of exact logo extraction or production readiness.

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
- `playwright.apri.config.cjs`: all 18 cases pass across Chromium/WebKit. 36 exact-art rows, 390/820/1440, both themes, long names, empty/loading/error/offline, keyboard More actions and focus, reduced motion, system theme, repeated navigation, 2× phone capture.
- `playwright.apri-performance.config.cjs`: all eight pass. Existing budgets unchanged: desktop and throttled 390/320 startup, 1,000-entry structural bounds and 120-row filtering/editing at 4× CPU.
- Syntax and whitespace checks passed. No changes to auth, database rules, service contracts, catalog data, sprite files, telemetry, privacy notice or deployment workflows.

All fixtures use synthetic identities/data and isolate production mutations. These checks do not constitute a new real-provider login test. Release numbers remain .148 in this preview; a later authorized release must receive fresh immutable qualification and versioning.

## Intentional differences and deferred scope

Events keeps factual time-basis, source and category controls omitted by the mockup, so cards have additional truthful metadata. Trainers retains authorized lookup/Favorites rather than a new all-trainer table. More retains Tools, App & Data and existing help functions. Existing sign-in is unchanged. Discovery/location indexes, onboarding and calendar export are not implemented. The approved All/High/Medium/Low priority selector is now included.


## Independent review corrections and final qualification

The initial captures exposed genuine P2 issues; the draft was revised before handoff:
- Events: removed redundant intro; combined phone week navigation/view controls; moved healthy checked-time/refresh below the agenda while retaining stale/error disclosure above it. Timed events and day boundaries precede ongoing seasons, with every overlap retained. Metadata is compact without truncating bonuses or uncertainty. At matching 390×844, the first card is about 323–329px rather than ~510px; at 1440×1000 it is ~405px rather than ~552px, with four complete fixture cards. These measurements describe the fixture, not a fixed-card count guarantee.
- More: removed repetitive descriptions, retaining App & Data clarification and all destinations with at least 44px targets.
- Shiny: removed the old phone CSS that suppressed text in favor of sparkles. Explicit pink Shiny and Lucky text remains visible at 11px; exact sprites unchanged.
- Inputs: introduced centralized opaque control-border colors, including legacy input-selector specificity. Browser checks measure at least 3:1 against the input and adjacent Add surface in both themes; actual canonical 36-row captures also assert the final border colors.
- Save state: check/refresh/error/local shapes accompany color. Existing accessible status labels and recovery actions remain.
- Category strip: visible edge chevron, keyboard access to the final category, and unchanged filtering assertions.
- Trainers: four separate actual lookup captures now accompany the four Favorites captures. The timestamp remains a public-snapshot publication time, never a claimed last edit/sign-in.
- Priority filter: real distinct-row counts, zero-count choices, All including unprioritized flags, keyboard activation, account reset, canonical priority edits moving rows out, and retained hidden selections with explicit scope notice. Full/top/selected sharing scopes and Find counts remain unchanged. Filter interaction makes no writes.

Final source checks: 1,964 unit passed / 12 existing skipped; 106 regression browser passed / 6 existing skipped; 18 presentation/filter browser passed; 8 unchanged performance checks passed. Logs: `/tmp/apri-final-unit.log`, `/tmp/apri-final-regression.log`, `/tmp/apri-final-captures.log`, `/tmp/apri-final-performance.log`. Captures in `apri-preview-library.md` preserve prior versions for before/after review. Independent visual acceptance remains pending; no deployment requested or performed.
