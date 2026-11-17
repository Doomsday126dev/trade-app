# Approved Add workflow implementation

Base:8481068. User-approved High default replaces the tentative Medium shown in conceptual images.

## Implemented
- Search/Continue opens review without mutation; no abbreviated H/M/L toolbar or ambiguous Options detour.
- Desktop review places search beside preferences; mobile hides the chosen search field behind Change. Existing entries retain a compact editor and their saved values.
- New ordinary Pokémon receive High. New special species retain unranked defaults. Explicit priority choices and existing entries are not reset. Invalid None is hidden for new ordinary entries until a special requirement makes it meaningful.
- Native Size radios Any/XXL/XXS update existing canonical flags without allowing contradictory new choices. Legacy flags are read unchanged and conflicts are disclosed.
- Shiny remains prominent. Lucky, background including multi-background, variant text, gender, and note are in Specific form or details.
- Named localized Add action; duplicate/error feedback receives focus and scrolls into view. Canonical save, identity, session/concurrency, duplicate, released-form, and background transition semantics retained.
- New strings translated explicitly in en/es/de/ja.

## Verification
- 15/15 Chrome Guest browser cases passed using synthetic local auth/data, real product controller/IndexedDB and blocked remote account traffic. Includes High default, no mutation before confirmation, cancel, size exclusivity, exact save, special default, existing flags/gender/note, duplicate, focus trap/Escape,320px German dark-mode optional-field/footer access; background add/edit/remove/conversion, delayed publication and session/runtime boundaries.
- 50 focused static/localization/sync/reference tests passed.
- 56 account-sync product/background batch tests passed.
- 48 product journey/domain localization/interim tests passed with installed acorn via NODE_PATH.
- node --check and git diff --check passed.
- Screenshots inspected at1440x1024,390x844,320x568; local untracked qa-captures directory. Remote sprites intentionally blocked, so question marks are fixture artifacts, not artwork verdicts. No physical device/Safari or production login claim.

## Remaining integration gates
- Full existing want-editor.spec.js encodes old instant-Add/Options/checkbox UI and is assigned for migration independently. This report does not claim it passed.
- frontend-asset-extraction has the known stale-loader assertion on base8481068, corrected separately by c980d90. Combine that commit before aggregate release gates.
- No version bump, push, or deployment performed. Parent owns combined candidate/release decision.
