# Cross-Device Sync

Cross-device sync is an owner-only private-state layer for the existing account UID. It is additive, allowlisted for one production owner canary in `.71`, and does not change authentication, public-share authority, or retired inventory paths.

## Canonical State

Realtime Database stores canonical private state below `accountSync/{firebaseUid}`:

- `meta`
- `tradeEntries/{entryId}`
- `favorites/{targetUid}`
- `tags/{tagId}`
- `migrations/{deviceMigrationId}`
- `recoveryCandidates/{candidateId}`

The Firebase UID is both the account partition and immutable `ownerUid`. Rules permit only `auth.uid === $uid`, deny account-root replacement and enumeration, and validate each fixed entity field together with its revision and mutation evidence.

Trade entry identity is derived from schema, surface, lane, and canonical Pokemon catalog identity. Priority, variant, gender, Lucky, Shiny, XXL/XXS, `backgroundId`, row order, quantity, note, and mirror are mutable fields. Moving an entry to another lane or changing catalog identity is delete plus add.

`publicShares` remains a derived publication target. It never participates in private merge or migration decisions.

## Local Journal

Each browser keeps an owner-partitioned IndexedDB database named `pogoAccountSync_v1` with `entities`, `operations`, `conflicts`, `meta`, and `recoveryCandidates` stores.

An operation and its optimistic entity state are committed atomically before the product UI changes. A journal failure leaves the visible product state unchanged. Product edits contain a random stable operation ID, exact target, generation, base field revisions, absolute patch, canonical input hash, and client timestamp. First-run migration seeds and safe legacy-queue replays instead use a deterministic ID derived from their complete canonical mutation input and a fixed diagnostic client timestamp; identical simultaneous tabs therefore converge idempotently, while divergent snapshots conflict and block migration rather than overwriting either source.

Transient failures retry after 1, 2, 4, 8, 16, and 30 seconds, then remain at bounded 30-second intervals until the automatic-attempt limit. Exhausted or non-retryable work becomes `blocked`; it is retained for explicit retry. Same-field conflicts are not retried as transport failures.

## Merge Contract

Server transactions validate the operation hash and merge against one logical entity:

- Different-field concurrent edits merge.
- The first server-accepted same-field edit wins.
- A losing same-field operation becomes one recoverable conflict containing every conflicting field.
- If both devices independently converge on the same value, the later operation is an idempotent no-op without revision churn.
- Duplicate delivery and response loss are idempotent through the operation ID and input hash.
- Delete advances the lifecycle generation and leaves a tombstone.
- Stale operations cannot edit or resurrect an earlier generation.
- Explicit re-add after observing deletion advances generation again.

Conflict review offers two deliberate choices: keep the canonical account values, or submit this device's values as a fresh operation based on current revisions. Resolving a conflict also resolves the retained optimistic operation so reload cannot reapply it.

## Migration

First activation reads legacy remote and device-local My List lanes, Special Trade Board LF/FT, the retained queue, row orders, Favorites, and tags. The migration plan is fingerprinted per account, installation, and exact source snapshot.

Distinct canonical entries are unioned record by record. A known queued update is replayed when the canonical row still exactly matches the legacy remote base from which that edit was made. If the canonical row has diverged, or the retained queue contains a delete whose base cannot be revision-bound safely, the intent becomes a recovery candidate instead of overwriting newer account state. Catalog-unresolved rows, unresolved username-only Favorites, and ambiguous cache-only differences are preserved the same way.

Migration records are create-only. A restart with an existing migration re-verifies every canonical seed and recovery candidate, then confirms canonical metadata before projection becomes active. Legacy inputs are retained; migration never authorizes deleting the source snapshot.

While migration is pending, retained whole-profile writes that contain Special Trade Board state are held rather than sent as parent replacements. After canonical verification, unrelated profile fields resume as child updates; the migrated board source is never removed or overwritten by legacy queue flushing.

## Product Scope

Synced:

- My List `wishlist`, `dynamax`, `gmax`, and `costumes` lanes
- H/M/L priority, row order, and all structured qualifiers
- Special Trade Board LF/FT entries, including quantity, note, mirror, Shiny, background, and order
- Favorites keyed by an exact forward-and-reverse resolved target UID
- private Favorite tags and assignments

Device-local:

- collapsed sections
- recent trainers and viewed-list history/snapshots
- language, theme, search locale, export style
- temporary filters, dialogs, community state, and caches

Retired `have`, inventory, offer, trade, decrement, scheduling, and community workflow roots never become sync authority.

## Projection And Privacy

Only an acknowledged private canonical entity can update the product projection. The existing publication gate then derives the public share using active product values only. Operation IDs, field revisions, mutation hashes, tombstones, tags, migration records, recovery candidates, and local journal details are excluded. A publication failure cannot roll back private canonical state.

## Rollout And Rollback

The checked-in `.71` rollout permits exactly one domain-separated SHA-256 owner hash. `enabled`, `writesEnabled`, and exact allowlist membership must all pass before the journal, repository, or listener is constructed; every non-allowlisted account remains inert. Raw owner UIDs, usernames, and sign-in material are not embedded in the public bundle.

Rollout order:

1. Validate deterministic two-device and emulator suites.
2. Deploy only the additive owner-only Rules.
3. Keep client dispatch disabled and verify ordinary startup.
4. Enable one domain-separated owner hash for two-device validation.
5. Verify migration, offline/reconnect, conflict, delete, Favorites/tags, background, Special Board, and public projection behavior.
6. Expand only after reviewed evidence.

Rollback disables dispatch and listeners. Canonical private state, IndexedDB operations/conflicts, recovery candidates, and untouched legacy/local source data remain available. Rollback never deletes sync data.

## Verification

Run the local deterministic suite with:

```sh
npm run test:account-sync
```

Rules are validated through the SEC-02 production candidate build and the dedicated `tests/firebase/account-sync-rules.test.cjs` emulator suite. Real-device acceptance requires two independent browser/device sessions for the same allowlisted UID; it is not simulated by the deterministic harness.
