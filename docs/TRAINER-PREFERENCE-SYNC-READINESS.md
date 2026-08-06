# Trainer Preference Sync Readiness

Status: **production-inactive client and emulator candidate**

This design completes the disabled synchronization contract for the existing
schema-v2 local trainer organizer. It does not enable a client read, expose a
sync control, deploy rules or Functions, seed data, or write Firebase.

```text
SYNCED_TRAINER_PREFERENCES_ENABLED = false
SHARE_VISIBILITY_MODEL_ENABLED = false
trainerPreferencesConfig/writesEnabled = false or absent
shareVisibilityConfig/writesEnabled = false
```

Only `local-only` is reachable in the production client. The local
`pogoTrainerHistory_v1:{uid}` partition remains the single authoritative store.

## Existing Foundation Inventory

Implemented and active locally:

- Organizer schema v2, owner-bound by exact authenticated UID and canonical
  username.
- One local implementation for Favorites, six Recents, snapshots, 24 private
  tags, tag assignments, and 240-character private notes.
- Device-local account partitions, local migration, NFKC tag matching, stable
  tag IDs, organizer search/filtering, and logout/account-switch transient reset.
- Explicit public-share publication that excludes organizer data.

Implemented but production-inactive:

- Pure Favorite, tag, Recents, and history merge helpers.
- Exact private repository reads and owner-path transaction adapters.
- A bounded UID-partitioned preference operation queue.
- Entity revision, operation-ID, tombstone, migration, and conflict contracts.
- Hidden future status, preview, conflict, retry, and cloud-removal UI models.
- Additive owner-only RTDB rules and emulator tests.
- Purpose-specific trusted `claimTrainerTagLabel` and
  `verifyTrainerHistory` callable candidates.

Modeled only:

- Production rollout, client wiring, first-sync execution, tombstone cleanup,
  cloud deletion execution, App Check enforcement, and staged activation.

Not present:

- A generic Firebase writer, a bulk organizer endpoint, username-keyed private
  preference data, automatic login migration, anonymous import, public notes or
  tags, or any Favorite-to-Approved-Viewer coupling.

## Data Boundaries

Syncable private preferences:

- Favorite trainer stable UIDs and display metadata.
- Private tag definitions and normalized label claims.
- Private trainer notes and trainer-tag assignments.
- Fixed-slot Recents and bounded public-only seen-history snapshots.
- Preference schema, migration, count declarations, and sync timestamps.

Device-only transient state:

- Open dialogs, dirty drafts, active filters, scroll position, search text,
  pending confirmations, focus state, and operation progress presentation.
- Interface locale. Different devices may intentionally use different
  languages, and the existing browser/base-language/English fallback remains
  preferable to an account override.

Separate data domains:

- Public shares remain under `publicShares/{username}` today and the disabled
  `trainerShares/{ownerUid}` visibility candidate later.
- Identity remains under Firebase Auth, `users`, `authIndex`, and `accounts`.
- Community records and the legacy offline write queue remain separate.
- Approved Viewers remain under `shareAccess`; Favorites, tags, notes, Recents,
  and history neither create nor imply access.
- Signed-out data is never imported automatically into an account.

## Private Server Schema

All private paths are keyed by authenticated viewer UID. Trainer names are
display metadata only.

```text
userPreferences/{viewerUid}/metadata/
  schemaVersion: 1
  revision
  updatedAt
  favoriteCount: 0..100
  tagCount: 0..24
  lastSuccessfulSyncAt
  migrationState: not-started | pending | verified | conflict
  migrationFingerprint

userPreferences/{viewerUid}/favoriteTrainers/{ownerUid}/
  trainerName
  addedAt
  revision
  updatedAt
  operationId
  deleted
  deletedAt (tombstones only)

userPreferences/{viewerUid}/trainerMetadata/{ownerUid}/
  note
  tagIds/{tagId}: true
  revision
  updatedAt
  operationId
  deleted
  deletedAt (tombstones only)

userPreferences/{viewerUid}/trainerTags/{tagId}/
  label
  normalizedLabel
  labelKey
  active
  createdAt
  updatedAt
  revision
  operationId
  deleted
  deletedAt (tombstones only)

userPreferences/{viewerUid}/trainerTagLabels/{labelKey}: tagId

userPreferences/{viewerUid}/recentTrainerSlots/{00..29}/
  ownerUid
  trainerName
  lastOpenedAt
  revision
  operationId

userPreferences/{viewerUid}/trainerHistory/{ownerUid}/
  lastSeenShareVersion
  lastSeenUpdatedAt
  lastSeenFingerprint
  entryCount: 0..1500
  lastSeenSnapshot/{stableEntryId}/{category,fingerprint}
  revision
  operationId
```

Each record rejects unknown fields where practical. Timestamps, revisions,
operation IDs, stable UIDs, categories, and schema enums are locale-independent.
Serialization and migration fingerprints sort object keys deterministically.

Rules validate the declared Favorite/tag counts and history bound, but RTDB
rules cannot prove a declared count equals the number of arbitrary map children.
Strict reconciliation requires fixed slots/chunks or a trusted operation. The
existing history callable performs true snapshot counting. Record payload
shape and fixed Recents slots remain server-enforced.

## Conflict Contract

| Case | Result |
| --- | --- |
| Favorite add + Favorite add | **Merge; earliest timestamp preserved.** Keep one UID entity, earliest `addedAt`, and newest display metadata. |
| Favorite delete + metadata edit | **Tombstone wins** for Favorite visibility. Metadata is a separate revisioned entity and may be retained, but it is inert while the Favorite is deleted. |
| Note edit + note edit | **Explicit user conflict.** Exact metadata base revision is required. |
| Tag rename + tag rename | **Explicit user conflict.** Exact tag base revision and normalized-label claim are required. |
| Tag delete + assignment | **Tombstone wins.** Inactive/deleted tag IDs are ignored and cannot be newly assigned. |
| Offline edit + newer remote edit | **Reject.** A stale base revision never overwrites the higher remote revision. |
| Stale-schema client + current server | **Reject.** A newer server schema requires a compatible client. |
| Account switch + pending operation | **Reject.** Suspend the old queue; another identity cannot drain or resume it. |
| Recents from two devices | Merge by owner UID, keep greatest `lastOpenedAt`, sort deterministically, retain slots `00..29`. |
| Trainer history | Greater share version wins; same-version fingerprint mismatch is a conflict; unavailable shares never advance history. |
| Exact operation replay | Same operation ID and complete normalized operation is idempotent. |
| Reused operation ID, different input | Reject as an idempotency conflict. |
| Newer server schema | Stop and require a compatible client. |
| Account switch or auth loss | Suspend immediately; another UID cannot drain or resume the queue. |

Tombstones are retained for at least 90 days. Expiration is a later trusted,
watermark-aware cleanup task, not a client clock decision. Removing a tag uses
a tombstone and ignores prior assignments; it does not scan or rewrite an
unbounded collection. User intervention is limited to true note, rename,
delete/edit, same-version history, or migration conflicts.

## Offline Queue

`pogoTrainerPreferenceSync_v1:{uid}` is a separate local queue from the legacy
community queue. It stores schema version, exact UID and username ownership,
and at most 128 operations. Each operation has a 16-80 character operation ID,
kind, entity, base revision, schema version, deterministic fingerprint,
attempt count, retry time, and redacted error code. Retry is exponential and
bounded at eight attempts.

Same-ID replay compares the complete normalized operation. The fingerprint is
a compact correlation and verification value, not the sole equality check.
Persisted operations are normalized again on every queue read; a changed UID,
extra payload field, invalid attempt counter, mismatched key, or malformed row
is quarantined from draining. An interrupted local acknowledgement leaves the
operation pending, but the server-side operation ID and complete request
fingerprint make replay non-destructive.

The queue exposes no network or Firebase adapter. It cannot enqueue, select,
retry, or acknowledge work unless both future client and server-gate options
are true. Summaries expose counts only. Payloads, notes, labels, UIDs, and names
are never logged. Logout/auth loss suspends draining; an exact identity match is
required to resume. A different account cannot read or send another partition.

## Explicit First Sync

Future flow:

1. **Sync this device's saved trainers** opens an owner-only preview.
2. Complete exact reads of metadata, Favorites, trainer metadata, tags, claims,
   Recents, and history for the current hydration generation.
3. Verify organizer schema v2 and exact UID plus canonical username ownership.
4. Normalize the actual local records, deduplicate stable entities, enforce the
   100 Favorite, 24 active-tag, 30 Recent-slot, and 1,500-entry-per-history
   bounds, and show those derived counts rather than stored counters.
5. Require explicit confirmation and both future gates.
6. Execute idempotent entity operations against the captured base revision.
7. Preserve conflicts for review; never overwrite a newer server schema/state.
8. Recheck the local source fingerprint, reread every server section, and
   verify the migration fingerprint. Any local change after preview invalidates
   the plan and requires a fresh preview.
9. Mark migration verified. Keep local data; a later explicit deletion choice
   may remove local, cloud, or both copies.

The plan is resumable and produces zero public-share writes. Login, hydration,
and rendering never start migration.

## Direct Writes And Trusted Boundary

Least-privilege recommendation:

- Owner-authenticated exact RTDB transactions: trainer metadata, fixed Recents,
  and migration metadata. Rules fully enforce exact UID ownership, allowlisted
  fields, revisions, timestamps, operation IDs, tombstones, note/tag bounds,
  active tag references, fixed `00..29` Recents keys, and monotonic activity.
- Favorite entity transactions currently have the same owner, shape, revision,
  operation-ID, and tombstone enforcement, but **cannot be activated as direct
  writes** because RTDB Rules cannot prove the arbitrary map contains at most
  100 Favorites. This is the explicit activation blocker below.
- Existing purpose-specific trusted callable `claimTrainerTagLabel`: NFKC tag
  uniqueness and atomic tag/claim create, rename, and tombstone with a required
  base revision and idempotency operation ID. Its authoritative transaction
  also enforces the true 24-active-tag limit.
- Existing purpose-specific trusted callable `verifyTrainerHistory`: authorize
  the source share, calculate true entry count and canonical fingerprints, and
  advance monotonic history with server-derived entity revisions.

No new callable is implemented by this candidate. The existing callables remain
undeployed and gate-disabled. Preference activation requires a separately
reviewed Favorite-count solution; the recommendation is a narrow trusted
Favorite mutation callable, not a generic path writer. If a later canary proves
migration finalization cannot be safely expressed as exact owner transactions,
a narrowly scoped `finalizePreferenceMigration` may also be separately designed.
Auth administration, public-share writing, Approved-Viewer coupling, identity
repair, arbitrary paths, and bulk maps remain prohibited.

## Favorite Count Activation Decision

Strict reconciliation of the arbitrary Favorite map is unresolved and blocks
sync activation. Declared `favoriteCount` metadata is useful for diagnostics but
is not a server-enforced map count and cannot make direct Favorite writes safe.

| Design | Correctness and concurrency | Enforcement and operations | Cost and migration |
| --- | --- | --- | --- |
| Fixed Favorite slots | Strict 100-slot cap; concurrent slot allocation can conflict and tombstones consume/recycle slots. | Rules can allow only `000..099`; clients need stable allocation and compaction rules. | Low callable cost, higher client/migration complexity and awkward offline retries. |
| Chunked Favorite records | Strict only when chunk keys and per-chunk slots are fixed; cross-chunk moves need coordination. | Rules validate bounded chunks, but dedupe and deletion across chunks remain complex. | Fewer reads for partial pages, more migration, compaction, and observability work. |
| Narrow trusted Favorite mutation callable | Transaction counts actual active records, enforces 100, applies exact revisions/tombstones, and makes idempotent offline replay observable. | Strongest practical correctness; fixed adapter and schema, no arbitrary path or bulk input. | One callable per mutation and modest transaction cost; simplest safe migration and telemetry. |
| Declared count + periodic reconciliation | Concurrent hostile clients can exceed 100 before reconciliation; not strict. | Rules validate only the declaration. A trusted repair job would detect rather than prevent drift. | Lowest initial write cost, but recurring scans, ambiguous conflicts, and weak activation safety. |

**Recommendation:** design, implement, emulator-test, and separately approve a
narrow trusted Favorite mutation callable before enabling the preference gate
or client flag. It must transact the caller's exact Favorite collection, enforce
100 actual active records, preserve earliest `addedAt`, apply revisioned
tombstones, support complete-fingerprint idempotency, and expose redacted
operational metrics. This decision is not implemented here and grants no
deployment or activation approval.

## Rules And Read Boundaries

The additive fixture is based on the live narrow-read baseline. It preserves
root denial, every live root, Admin authority rules, and legacy
`publicShares/{username}` byte-for-byte. Future preferences add seven exact
owner-only live surfaces: metadata, Favorites, trainer metadata, tags, tag
claims, Recents, and history. All are registry-mapped and inactive.

Private preferences deliberately have no Admin read exception. A future support
access process would require its own explicit, audited, time-bounded design.
Collection-wide and cross-UID reads are denied. Every write is denied while
`trainerPreferencesConfig/writesEnabled` is false or absent.

When the gate is eventually enabled, client rules permit exact owner writes
only for metadata, Favorite entities, trainer metadata, and fixed Recents
slots. Direct client writes to tag definitions, normalized tag claims, and
history are always denied; those paths are reserved for the two fixed trusted
callables, whose Admin SDK access is constrained by their schemas, adapters,
gate checks, idempotency records, and tests rather than RTDB Rules.

The rollback artifact is the current narrow-read baseline, not the historical
broad authenticated-read rules. Neither candidate nor rollback is deployed by
this milestone.

## Disabled UI

The hidden view model covers local/cloud counts, migration preview, pending,
synced, recoverable error, conflict, last-success time, retry, and two explicit
cloud-removal choices. With the flag off it is hidden, non-interactive, and all
write controls are disabled. Production continues to say organizer data is
saved on this device. All future strings exist in English, Japanese, Spanish,
and German. User-created labels and notes are never translated.

## Privacy, Retention, And Deletion

- Favorites, tags, notes, Recents, and history are visible only to their owner.
- They are never visible to public users, other trainers, Approved Viewers,
  advertisers, or Admin UI.
- Notes never enter public shares or existing exports. A future private backup
  may include them only with an explicit warning and encrypted/private handling.
- Delete-one-trainer creates Favorite and metadata tombstones.
- Delete-one-tag releases its normalized claim through the trusted callable and
  stores a tag tombstone; old assignments become inert.
- Delete-all-cloud-preferences requires explicit reauthentication, a preview,
  exact owner scope, verified completion, and an independent keep/remove-local
  choice.
- Account deletion cleanup is a trusted UID-scoped deletion after Auth account
  deletion authorization; no username scan is permitted.
- History is fixed at 1,500 declared entries per trainer and Recents at 30 slots.
- Cloud deletion keeps tombstones for at least 90 days. History replacement is
  bounded and monotonic; no append-only event log is retained indefinitely.
- A user may keep local data, remove local data after verified cloud deletion,
  or remove both through separate explicit choices. Existing exports remain
  public-list/legacy features and do not export private notes or tags.
- Privacy and deletion controls cannot be paywalled.

## Existing Community Queue Audit

The pre-existing reload write used `pogoSyncQueue_v2`, owned by the
`sessionCacheBoundary` exact UID-and-username partition. Queue entries are
last-write-per-path objects `{path,data,ts}`. They are created by ordinary
owned/community/list writes, retried after connectivity or Auth recovery, and
removed after a successful exact Firebase `set`. Permanent authorization
failures are dropped; transient failures retry after five seconds.

Auth loss suspends the cache and clears the in-memory queue. Logout clears both
stored and in-memory entries. Account activation exposes only an exact matching
UID-and-username partition; switching accounts resets incompatible cached
owners. The queue has no `userPreferences` operation and no relationship to the
organizer store. The observed pre-existing community write completing on reload
was expected retry behavior; no organizer or list mutation was observed. This
queue is not reused for preference sync.

## Activation Gates

Before any production activation, separately approve and complete:

1. Resolve the strict 100-Favorite reconciliation blocker through a separately
   reviewed implementation, emulator suite, and deployment approval.
2. Additive rules deployment with the preference gate false.
3. Trusted callable staging and synthetic canary validation.
4. App Check, per-UID limits, logs, alerts, and rollback readiness.
5. A one-record synthetic migration dry run and reread verification.
6. A separately approved user cohort and deletion/support procedures.
7. Server gate, then client cohort flag, with immediate rollback criteria.

This candidate grants none of those approvals.
