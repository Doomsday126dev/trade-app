# PR #64 Product Completion

This is the current completion report. It supersedes release-gap and physical-consolidation recommendations in the earlier audit and approved-implementation report. Scope: the existing draft only; no redesign, physical migration, merge, deployment or provider window.

## A. Verdict

**PRODUCT PR #64 BLOCKED — CONCRETE PRODUCT DEFECT**

The remaining defect affects existing username/PIN trainers outside the account-sync allowlist. The new FT and unprioritized-LF add path, plus Enable editing for Board-only entries, require canonical mutation authority. Those legacy accounts receive legacy authority and the operation fails closed. Provider-only accounts have a separate existing eligibility path; they are not categorically excluded by this finding.

Evidence: `ACCOUNT_SYNC_ROLLOUT`, `accountSyncRolloutEligible`, `accountSyncMutationAuthority` and `addManagedIntentEntries` in `js/app/application.js`; the completion test proves the legacy-authority case makes zero writes. Broadening the rollout or inventing an unsynchronized fallback would not be a safe product-only correction. Before general product release, provide and qualify an approved durable non-canary write path. This is not a demand for physical duplicate cleanup or for completing provider rollout.

## B. Unified Public Projection

- New public snapshots explicitly use version 2 with `declarations` and `declarationCount`. Entries contain only intent, category, canonical name, priority, variant text, gender, background metadata, permitted public note and lucky/shiny/size flags.
- The same `productDeclarations` adapter drives My List, public publication, Board and comparison. Board LF and FT are included; exact aliases contribute once, nonidentical entries remain separate and input order is retained within priority groups.
- Source paths, aliases, UIDs, entity IDs, revisions, tombstones, private tags/recovery and curation selection are excluded.
- Existing URLs are unchanged. Version 1 LF-only payloads still read exactly; version 2 declarations take precedence over compatibility lists. Unsupported or incomplete version 2 does not silently become LF-only.
- Compatibility lists retain first-per-name LF values for old readers. They cannot encode all same-name variants; new readers use declarations. Retire this secondary representation only after supported clients and retained public snapshots no longer require v1, under a separately reviewed compatibility change.

## C. Anonymous Recipient

LF/FT tabs and category-specific search actions use the displayed source species. Empty categories have no button; unresolved species disable the whole query instead of silently dropping a name. Existing canonical localized dex-search generation is shared; no background/costume operators were invented.

EN/JA/ES/DE viewer language remains authoritative. Friend-code copy and feedback remain anonymous. Its action now sits below profile metadata rather than squeezing the name on 320 px screens. The generated anonymous dex now includes the same supplemental legendary catalog as the signed-in app, fixing missing Mew/Mewtwo search numbers without importing private account data.

## D. Unified Searches

H/M/L/unprioritized groups use the unified declaration view, current intent, category and filter. Empty source groups produce no block. Exact aliases dedupe before search construction. Search presets refresh when the list filter changes. Both signed-in and anonymous public rendering use the explicit intent model.

## E. Legacy Edit Strategy

- Categorized canonical My List entries keep their normal write path.
- Board-only rows are read-only until **Enable editing** confirms creation of a canonical editable copy. Original Board storage is neither rewritten nor deleted.
- The copy uses a stable My List intent identity, retains exact qualifiers, is idempotent and survives canonical projection/reload. Exact duplicates show once with deterministic canonical preference and traceable aliases.
- After details differ, the retained original and edited copy remain distinct; the confirmation explicitly says so. Ambiguous same-species entries are not automatically merged.
- Deleting the editable copy does not delete its old Board source. The physical consolidation action is removed, not executed.
- This path works in the canonical cohort; the non-canary username/PIN limitation in A prevents general-release readiness.

## F. Board

Board is curation/export over the same LF/FT declarations. Selection changes only local references, never underlying records. The Image share mode retains Board access. A focused browser test enables editing for an old FT entry, verifies one displayed alias, generates the real PNG, checks nonblank pixels and confirms original storage is byte-for-byte unchanged.

The approved dense sprite layout, clean shiny marker and retirement of quantities/mirror/background-label controls are preserved. Existing unavailable-artwork omission remains unchanged: the PNG fixture's Mew has no drawable image in that run and is omitted; the saved declaration remains intact. This evidence does not claim every artwork source is available.

## G. Compare

The application consumes selected public v2 LF/FT and computes both reciprocal directions from declared intent and exact qualifiers. It does not infer inventory, stock, ownership guarantees or reservations. A v1 public projection retains wanted-overlap-only results and does not claim offer availability. Completion tests exercise the actual application summary function for both versions.

## H. Publication

Explicit copy waits for accepted projection publication, not a queued write. Legacy publication writes the exact snapshot and verifies readback; provider publication preserves its existing exact-content contract with v2 fields. The account-sync controller rejects deferred/failed projection callback results.

Pending/blocked/conflicting canonical state cannot be presented as current. Failure is retryable, private edits remain intact, stale dialog/account callbacks are ignored, and an edit during publication prevents the old snapshot being labeled/copied as current. Existing links may remain readable while the dialog reports publication pending or failed.

## I. Localization / Mobile

New editing/scope text is translated in EN/JA/ES/DE with exact locale parity. Chromium covered 320/390/430/1440 px; screenshot inspection found and corrected profile-action overlap beyond the original overflow assertion. Public tabs, metadata, friend-code action and editable/legacy rows fit the target widths. No physical-device, screen-reader or all-browser certification is claimed.

Evidence:
- [320 px public FT](completion-evidence/unified-public-ft-320-en.png)
- [390 px Japanese public LF](completion-evidence/unified-public-lf-390-ja.png)
- [430 px Spanish public FT](completion-evidence/unified-public-ft-430-es.png)
- [Desktop German public LF](completion-evidence/unified-public-lf-1440-de.png)
- [390 px canonical and legacy rows](completion-evidence/approved-entries-390.png)
- [Actual unified Board PNG](completion-evidence/unified-board-export.png)
- [Board curation](completion-evidence/trusted-journey-special-board-1440x900.png)

## J. Focused Tests

- **352/352 Node checks, 21 selected files**: product, localization/search, owning sync/runtime/repository/privacy, public payload, release integrity and catalog/sprite boundaries. Includes 11 new completion tests.
- **14/14 owning Functions checks**: six authority and eight public gateway checks. The authority file passed in the earlier 13-case run; the updated gateway file subsequently passed all eight. These are unique cases, not summed reruns.
- **9/9 local public-projection Rules checks** against demo Auth/RTDB emulators, including v2 fields, version separation, count bounds, public privacy and unchanged owner authorization.
- **17/17 targeted Chromium scenarios**: the final 16-case recipient/product set plus the additional legacy-edit/actual-PNG scenario. Four languages and four widths are exercised inside those scenarios.
- Workflow YAML, changed-source syntax, git whitespace hygiene and generated public dex freshness passed.
- Initial failures: missing anonymous legendary catalog; profile overlap discovered visually; stale exact-size/count/static assertions and fixture assumptions. Corrected and rerun. No production test data was mutated.
- No complete Functions, provider operator, Group E, full historical sync matrix, all-browser or full performance run was launched.
- Path-selected CI now installs owning Functions dependencies and uses the runner's Java 21 only when needed for local Rules checks. No safety suites were deleted; the obsolete destructive-consolidation assertion was replaced by a retirement guard.

Reproducible selections:

```sh
PRODUCT_BASE_SHA=794f8dbe08ee30a7de29ca73013b5ad77070ad44 node scripts/select-product-checks.cjs --plan
PRODUCT_BASE_SHA=794f8dbe08ee30a7de29ca73013b5ad77070ad44 node scripts/select-product-checks.cjs
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8896 node node_modules/@playwright/test/cli.js test tests/trusted-readiness.spec.js tests/anonymous-public-share.spec.js --project=desktop --workers=1
node scripts/generate-public-sprite-dex.cjs --check
```

Local counts above are execution evidence, not a claim about a future production rollout. Final remote CI state and commit hashes are recorded in the PR and visible completion message.

## K. Deferred Cleanup

**Physical duplicate migration is AFTER PRODUCT ROLLOUT.** It is not a release blocker. Preserve read-through compatibility, exact aliases and all originals until there is production history and a separate cleanup review. No migration framework or global purge was added.

## L. PR #64

Existing branch: `product/astra-end-to-end-review`.
Starting head: `babdac45e15be8d454d5ecbb65d75680381d76e1`.
Implementation commit: `48da68e`.
A following documentation/evidence commit records this report. Its final head and remote OPEN/DRAFT/MERGEABLE state are supplied in the PR body and completion message to avoid self-referential hashes. PR #64 remains unmerged and draft.

## M. Production Boundary

Read-only checks: main remains `794f8dbe08ee30a7de29ca73013b5ad77070ad44`; PR #63 remains OPEN/DRAFT at `aa9f9a7cac8c86737b59b7afcf8c47787b3d19dc`; deployed `sw.js` reports `2026-08-31.86`.

No merge, deploy, live identity/provider mutation, OAuth change or physical Board migration. Only source public-payload validators and their local candidate Rules were changed; public-read/owner-write authorization is unchanged. A later authorized release must coordinate the v2 reader/writer validators and Rules candidate before enabling v2 publication for provider accounts. PR #63 and its operator qualification are untouched.

PR #64 READY FOR FINAL OWNER REVIEW

