# Approved Product Decisions: A-P Report

2026-09-04. Existing draft PR #64. No merge or deployment.

## A. Verdict

**Working product draft, not release-ready and not a completed canonical migration.**

The approved interaction model is implemented. A deterministic read-through adapter preserves existing records. Public Link still excludes Board-origin LF/FT, so physical cleanup that could remove the only public representation is guarded and unavailable in the UI. This limitation is not presented as completed work.

## B. Owner Decisions Implemented

1. My List has explicit Looking For / For Trade. FT is declared by the user, never inferred from inventory. No quantities are editable.
2. My List / Trainers / More is the primary navigation. Events, Profile, Settings and owner-gated Admin are under More; account-menu access remains.
3. Share has Link / Image / Text. Board is an Image option. List Tools retains editing utilities.

One coherent implementation was chosen, preserving the current visual character.

## C. Existing-Data Compatibility

Inspected persistence paths: legacy profile `users/{username}/specialTradeBoard`, cached profile data, `writeSpecialBoard` / `writeUser`, and existing account-sync trade records under surface `special-board` with lanes `looking-for` / `for-trade`. Categorized My List uses surface `my-list`.

`productDeclarations` / `unifyDeclarations` references those records without creating a third list. Categorized entries are LF; Board rows retain explicit LF/FT. Board rows are read first to preserve their existing order.

Equality includes intent, catalog-name identity, represented Max/category semantics, variant, gender, background, shiny/lucky/size, priority, note, mirror and legacy quantity. Exact duplicates display once with source aliases. Different same-species declarations remain separate with a narrow review state. Unknown names remain visible; unresolved mutation identities fail closed.

The adapter is deterministic, idempotent and does not mutate input. Board selection is session-local, uses semantic keys rather than positional indices, and resets across accounts. Unchecking a sprite only changes export selection.

Projection now preserves previously omitted priority, variant, gender and lucky/size flags. Background, shiny, note, mirror, legacy quantity and order remain in their existing data contract. No schema version or entity-ID format changed.

**Physical migration remains incomplete:** the UI exposes no combine action. The internal guard rejects deleting a My List public representation in favor of a Board-origin copy. Therefore zero duplicate physical canonical records after an accepted migration is not yet qualified or claimed. Original data remains readable.

Before acceptance, returning to the old reader is reversible because records were not migrated/deleted. No real consolidation was executed. Future physical consolidation must qualify public projection, order and tombstones together. Editing a referenced row does not overwrite a different alias.

## D. Tier 1 Fixes

- Empty species arrays are checked where search blocks are built; canonical serializer semantics remain unchanged.
- Anonymous unprioritized entries use **Other entries**, not Low. Explicit H/M/L are unchanged.
- Publication precedes URL copying. Persistent feedback separates publishing, published, copied, pending readiness, publication failure/retry and clipboard failure.
- Failed publication retains private edits. Failed clipboard access leaves a selectable URL. Stale account/attempt responses cannot update a new dialog state.

## E. My List

Intent is first. Trades / Dynamax / Gigantamax / Others remain presentation categories over existing lanes; collapsing their persisted identities here would broaden migration risk. Counts are intent-specific.

FT supports add, priority, shiny, variant, gender, note, lucky/size flags and existing-background removal; Add can choose a background. Dynamax additions preserve represented Max identity. No stock-count UI was introduced.

Legacy LF bulk/import/reorder utilities remain scoped to those records and are hidden for FT. FT search copies known species in the selected category. LF's old priority-search presets still use categorized sources, not all Board-origin aliases: this is a remaining integration gap, not full unified search coverage.

## F. Compare

Both Want / Only I Want / Only They Want remain wanted-overlap comparisons. Reciprocal sections require available, explicit FT records and exact normalized qualifiers. No inventory inference or availability guarantee is made.

For a selected public trainer, the public projection is authoritative rather than stale broader local data. Current public links lack FT and state that limitation.

## G. Board

The active Board UI is curation/export, with no separate add/remove editor. It selects references from My List declarations. Unchecking an item never removes a declaration. Old Board mutation handlers were removed from the active UI API; compatibility records were not purged.

The approved dense renderer and its existing artwork policy were preserved. No names, mirror badges, inventory numbers or fake backgrounds were added to its output. Persistent curation ordering was not introduced.

## H. Navigation

Verified widths: 320 / 390 / 430 / 1440. Mobile has three stable cells, readable labels and safe-area spacing. Desktop shares destination names. Existing dialog focus/Escape handling is reused.

- [390 px FT rows](approved-evidence/approved-entries-390.png)
- [320 px Share](approved-evidence/approved-share-320.png)
- [320 px More](approved-evidence/approved-more-320.png)
- [Desktop My List](approved-evidence/approved-for-trade-1440.png)
- [Desktop Board curation](approved-evidence/trusted-journey-special-board-1440x900.png)

Screenshots use synthetic identities/data. They establish layout, not a new artwork-quality/licensing audit. Anonymous tests also use controlled image fixtures.

Alternative considered: retain a separate desktop Events tab. The chosen shared naming reduces device-switch relearning; Events remains one click inside More.

## I. Share

**Link:** existing categorized LF contract only, explicitly labeled. Board-origin LF/FT is not silently claimed published. A unified public projection remains a release blocker under the no-provider-infrastructure boundary.

**Image:** Board supports both intents with curation. Classic/cards use the selected intent/category, include a neutral unprioritized group, and identify intent in the output. Both existing formats remain; the inaccurate “light” label was removed.

**Text:** Markdown/CSV include both intents, priority, shiny, gender, variant, background, notes and lucky/size flags. Markdown retains supplied contact/profile text. CSV quotes cells and protects formula prefixes. Neither adds inventory counts.

**Recipients:** anonymous category search and friend-code copy need no account. Viewer-language authority, unknown/length guards, clipboard feedback and public-only loading remain. Signed-in contextual comparison stays in the full app; no new anonymous CTA wall.

## J. Discovery

Trainer-name search, Favorites and Recents retain existing scope. Find by Pokemon says **Search saved trainers' Looking For lists**. Counts say **Matching Looking For entries**, not “I have their wants.” No global inventory search/backend was introduced.

## K. Test Rationalization

183 baseline test/spec files; 184 current. Zero suite files deleted; one selector suite added.

| Actual change | Invariant / surviving coverage |
|---|---|
| Consolidated one duplicate Settings source-test block | Existing locale/control and local-preference tests retain coverage; unique no-write assertion moved rather than deleted |
| Replaced registry totals 41/11 | Unique IDs, named inactive surfaces and explicit disabled-feature violations replace brittle counts |
| Replaced comparison-wide offer/quantity regex | Behavioral exact-offer, equality, ambiguity, immutability and deterministic/idempotent tests |
| Updated Board-count/localization assertions | Journey checks unified membership, no separate add UI, and selection without mutation |
| Repaired legacy sync fixture stubs | Existing atomic writes and failed-write non-mutation assertions remain |
| Path-select performance | Runtime/assets retain selection; unrelated docs skip; manual performance remains |

No identity, Rules, ownership, sanitizer, recovery, tombstone/conflict, PWA rollback, linking/creation or operator suite was deleted. No exact duplicate npm aliases were found. The preceding audit's six-to-four viewport reduction was not repeated here.

Deep suites remain available. This pass did not invent a nightly schedule or claim to move every suite; it reduces unrelated ordinary-PR selection without deleting coverage.

## L. CI Strategy

- Ordinary PR: exact-base paths, syntax/hygiene, selected Node contracts and affected Chromium journeys. Docs alone avoid browsers.
- Sensitive: shared app adds owning sync/privacy contracts; Functions add contract checks; Firestore and RTDB Rules select distinct local emulator commands.
- Release: existing exact-SHA Pages controls, release validation and mandatory assets/SW/rollback checks are unchanged. The product selector is not a release certificate.
- Deep/manual: broad Functions/migration/browser commands remain. Unrelated docs skip performance; the existing exact-draft performance deferral remains, with affected budgets restored on ready-for-review.
- Provider identity/IAM/deployment/canary remains manual and separately authorized. No PR #63 test or live operator command was run.

The selector is a bounded mapping, not exhaustive proof for every future backend path. New owning areas require mapping review. No unverified cross-tree result reuse was added.

## M. Verification

Implementation commit: `83a99fff09a6e5f6bbcc9057a4838ad0d4db5ef8`.

```sh
PRODUCT_BASE_SHA=794f8dbe08ee30a7de29ca73013b5ad77070ad44 node scripts/select-product-checks.cjs
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8896 TRUSTED_READINESS_SCREENSHOT_DIR=docs/product-audit/approved-evidence node_modules/.bin/playwright test tests/trusted-readiness.spec.js tests/anonymous-public-share.spec.js --project=desktop --workers=1
git diff --check
```

**328 selected Node checks passed**, zero failures, 18 files. This includes the 227 owning sync/privacy checks; overlapping runs are not added together. **15 focused Chromium scenarios passed**, exercising four widths/four languages, publication outcomes, add/edit, Max identity, curation, exports and anonymous privacy. Changed YAML parsed; syntax/hygiene passed.

The shared application mutation/projection work justified owning sync/privacy checks, not the entire 184-suite historical matrix. No full Functions/operator/performance matrix, production canary, physical cross-device migration, OS installation or live linking was run. Synthetic adapters do not substitute for those proofs.

## N. PR #64

- Old head: `e6e21672df667250c5f546d4e1eab517332b8bd8`.
- Implementation: `83a99fff09a6e5f6bbcc9057a4838ad0d4db5ef8`.
- A following documentation/evidence commit records this report. Its final SHA is in the PR body/task summary; a commit cannot embed its own SHA.
- OPEN / DRAFT / UNMERGED. No release revision changed.

## O. Remaining Owner Decisions

No repeated approval is needed for the accepted directions. The layout is ready for review. Projection, physical migration and search integration are engineering completion work, not requests for the owner to design the data model. Do not mark release-ready until those are qualified.

## P. Production Boundary

Read-only recheck: main `794f8dbe08ee30a7de29ca73013b5ad77070ad44`; PR #63 OPEN / DRAFT at `aa9f9a7cac8c86737b59b7afcf8c47787b3d19dc`; production `2026-08-31.86`.

No merge, deploy, main change, provider/identity mutation, infrastructure action or production data edit. No real duplicate consolidation executed.

PRODUCT DRAFT READY FOR OWNER REVIEW
