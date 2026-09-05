# PR #64 Normal Legacy Sync Qualification

Current report for the single remaining blocker, starting at `c44c6e92f8b90fa54d411b69daee27b47bcbdeea`. Approved LF/FT, public v2/v1 compatibility, viewer-language searches, Board curation/export, neutral priority, reciprocal Compare, navigation and publication-before-copy behavior are unchanged. Physical duplicate migration remains deferred until after product rollout.

The [previous completion report](https://github.com/Doomsday126dev/trade-app/blob/c44c6e92f8b90fa54d411b69daee27b47bcbdeea/docs/product-audit/completion.md) retains accepted product evidence; its non-canary blocker is superseded here.

## A. Verdict

**PRODUCT PR #64 REVIEW-READY — NORMAL LEGACY SYNC ELIGIBILITY QUALIFIED**

Every existing Username/PIN account satisfying the exact identity, migration, recovery and listener-health contracts can obtain canonical product mutation authority without historical canary membership. This is source qualification, not deployment authorization or a claim that every production record is healthy.

## B. Previous Allowlist Purpose

The hash gate limited entry into the entire migration/runtime path, bounding exposure to initial adoption, recovery and publication. It was not database authorization: repository and Rules already require the exact authenticated owner UID. Merely deleting the comparison would not have supplied reciprocal identity verification or validated returning legacy metadata.

## C. Normal Eligibility Contract

`accountSyncRolloutEligible` derives the owner from `auth.currentUser`, rejects a different caller UID, requires protected database readiness, and reads only `authIndex/<owner>`, `users/<username>/authUid` and `accountSync/<owner>`.

`normalSyncEligibility` requires exact string identities and reciprocal mapping. No trimming/coercion repair, username/profile/email inference, identity creation or client-selected UID is used. Existing metadata must have exact supported schema, owner, feature version, initialization fields and valid timestamps. Malformed evidence blocks authority rather than selecting a legacy write fallback.

Admission is not permission to edit immediately. Mutation authority still requires the accepted runtime, verified projection, healthy listener/controller and no blocked/conflicting/review-required state. Auth-object identity, transient session generation, runtime generation and username bind asynchronous work. The controller checks the session before and after watched writes/publication. Source acquisition rechecks session and remote profile owner before capturing local state.

## D. Canary Separation

`ACCOUNT_SYNC_CANARY` and `accountSyncCanaryMember` retain the historical hash only as a separate cohort query. Normal eligibility never calls it. The app passes verified `admitted:true`, not an expanded UID list. The historical low-level `allowlistedUids` option remains for isolated fixtures; explicit admission takes precedence and the application no longer uses that option.

`normalEnrollmentEnabled` is a simple new-adoption switch. False blocks new/unfinished enrollment but permits compatible initialized accounts without cohort membership. Do not use global runtime/write emergency switches as an enrollment pause; those disable the runtime itself. No rollout-management framework or permanent username list was added.

## E. First-Use Initialization

Identity and canonical metadata are inspected before activation; the listener must then establish authority. Existing `ensureMigration`/`buildMigrationPlan` reads four legacy lists, Board, local lists/Board, retained queue, orders, Favorites and tags. Source snapshots are preserved before seeding/bounded replay.

Deterministic IDs, owner journal, create-only migration evidence and exact watched readback remain authoritative. Empty canonical state cannot replace an unread legacy list. Ambiguous responses reconcile once; missing/divergent evidence blocks without blind resend. Conflicting values use bounded preserved recovery, not silent winner selection. Existing migration tests cover Favorites/tags and unresolved identities. No migration architecture or identity repair was introduced.

## F. Returning Canonical Users

An exact completed device receipt resumes without rereading/reseeding legacy sources. Incompatible metadata now blocks legacy startup and later account callbacks, including removal of initialized metadata after projection readiness.

A clean device uses accepted per-device adoption, not another account initialization. Stale legacy data cannot overwrite canonical entries. Startup may refresh the single existing public key from accepted rows; it does not add another source or duplicate declarations. Provider initialization/linking behavior is unchanged.

## G. Recovery Safety

The new 66-record test uses normal admission and an empty canary list. It creates 66 stale candidates, reviews the exact set, restarts the same journal and adopts from a clean second device. All records remain preserved and inactive; canonical entities are byte-for-byte unchanged, no entity mutation is replayed, and account metadata initializes once.

This is a synthetic regression of the historical failure shape, not a live read/rewrite of the owner's records. Changed evidence and conflicting acceptance markers still require review or block. Chromium separately proves unresolved recovery prevents FT creation without fallback writes.

## H. Product Actions

The formerly non-canary Chromium fixture uses real application admission, runtime, IndexedDB, repository transactions, product actions and publication. Only the Firebase transport/auth boundary is simulated; unexpected legacy/identity writes throw.

It verifies legacy list/Board adoption, UI Enable editing, priority selection, LF/FT additions, unprioritized LF, qualifier edits, deletion, intact original sources, accepted public LF/FT content, and page close/reopen with the same IndexedDB. Reopen performs no canonical write or legacy list-source read. Existing completion tests retain alias and publication-before-copy safety.

## I. Cross-Device Proof

A normal-admission two-device runtime case initializes metadata once, adopts the same entity, queues competing same-field priorities, and confirms the first accepted value wins while the loser remains explicit recoverable conflict. Accepting the saved value restores health. The 66-record case independently proves stale clean-device sources cannot overwrite canonical data.

Browser close/new-page reopen exercises persistent IndexedDB, not a physical installed PWA or Safari certification. No live production sign-in/mutation was performed.

## J. Identity Rejection Matrix

Tests reject missing auth, another UID, missing/conflicting/malformed index, missing/non-string user UID, malformed path/name, non-object canonical data, incompatible owner/schema/feature/timestamps/shape, and same-UID auth-object/generation replacement. Owning runtime tests cover blocked/ambiguous migration, listener failures, recovery and same-field conflict. Browser broken-index rejection makes zero product writes.

## K. Privacy-Safe Impact

Production identity inventory was **not collected**. Healthy, already-canonical, non-canonical, conflicting, malformed and unpaired counts are unknown, not zero. No account names/UIDs were enumerated. Prior approximate user totals are not verified reciprocal-identity counts.

## L. Tests

- Local: **245/245 Node tests across nine owning files**, including 22 admission checks, normal recovery66 and two-device conflict, runtime/repository/controller/recovery, product/publication and selection safeguards.
- Local: **2/2 focused desktop Chromium scenarios**, real IndexedDB and isolated transport. The reopen screenshot was inspected; fixture UI explicitly reflects its authenticated online state.
- Changed-source syntax and whitespace hygiene pass.
- The shared controller lifecycle change justifies its owning domain suite; migration/repository/recovery suites protect ambiguous writes and retained data.
- No complete Functions, Rules emulator, provider operator, Group E, full historical matrix, all-browser, full performance, Events or artwork suite was run for this correction.
- Previous selected PR evidence: successful CI run `33936929765` at exact starting head `c44c6e9`. Synchronize CI inherits it only after checking a successful exact-head run of this workflow and unchanged ancestry; otherwise it falls back to full PR comparison. Ready-for-review always checks the full PR. Final remote counts/status are recorded in the PR and visible completion message.

Reproduce focused local proof:

```sh
node --test tests/account-sync-eligibility.test.cjs tests/account-sync-runtime.test.cjs tests/account-sync-repository.test.cjs tests/account-sync-product.test.cjs tests/product-completion.test.cjs tests/my-list-sync-safety.test.cjs tests/account-sync-domain.test.cjs tests/account-sync-recovery.test.cjs tests/product-check-selection.test.cjs
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8896 node node_modules/@playwright/test/cli.js test tests/normal-sync-product.spec.js --project=desktop --workers=1
```

Initial failures: incompatible metadata now surfaces earlier than old assertions; a browser fixture selected an unavailable/non-tradeable catalog entry. Assertions now verify the earlier fail-closed code and the fixture uses a valid tradeable species. No production data was changed.

## M. PR #64

Branch `product/astra-end-to-end-review`; starting head `c44c6e92f8b90fa54d411b69daee27b47bcbdeea`. Only this existing PR is updated. It stays open, draft and unmerged for owner review; review-ready is the qualification verdict, not a merge action. Final hashes and remote mergeability are supplied in the PR and visible completion message to avoid self-referential hashes.

## N. Production Boundary

Read-only checks confirm main `794f8dbe08ee30a7de29ca73013b5ad77070ad44`, PR #63 open/draft at `aa9f9a7cac8c86737b59b7afcf8c47787b3d19dc`, and deployed `sw.js` release `2026-08-31.86`.

No merge, deploy, identity/provider/cloud-data mutation, OAuth change, Rules change or physical Board migration. Existing Rules remain strict owner-UID and schema/entity authorization; exact identity reads are already owner-authorized. A later authorized release still owns deployment sequencing and rollout observation, including previously accepted public-v2 validator/Rules coordination. PR #63 is untouched.

PR #64 READY FOR FINAL OWNER REVIEW
