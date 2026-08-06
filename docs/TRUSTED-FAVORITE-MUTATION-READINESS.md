# Trusted Favorite Mutation Readiness

Status: **local, undeployed, production-inactive candidate**

## Decision

Use the narrow `mutateFavoriteTrainer` callable. Fixed slots strictly cap 100
but add allocation, compaction, and migration complexity. Bounded chunks still
need cross-chunk deduplication and coordination. A declared count is useful
metadata but RTDB Rules cannot prove that it equals an arbitrary map's child
count. The callable reuses the existing trusted-operation boundary and performs
one transaction over the caller's exact Favorite map, which is the smallest
subtree that can count every active row atomically.

No generic writer, batch endpoint, owner UID, arbitrary path, note, tag, share,
grant, identity mutation, or Auth operation is accepted. The existing four
callable contracts are unchanged; this adds one purpose-specific fifth export.

## Contract

```text
mutateFavoriteTrainer({
  operation: "add" | "remove",
  trainerUid,
  canonicalTrainerLabel,
  expectedRevision,
  requestId,
  schemaVersion: 1
})
```

Firebase Auth supplies `callerUid`. The target must have a coherent
`accounts/{trainerUid}` and `shareDirectory/{normalizedTrainerName}` identity,
and its stored canonical label must equal the normalized request label. Unknown
fields, nested payloads, owner UIDs, bulk maps, unsupported schemas, malformed
identifiers, and payloads over 4 KiB are rejected.

## Transaction Semantics

The adapter transacts only
`userPreferences/{callerUid}/favoriteTrainers`. Every transaction callback:

1. validates the actual map and record revisions;
2. counts records whose `deleted` value is exactly `false`;
3. rejects a new or restored add at 100 active rows;
4. checks the exact expected revision;
5. preserves an active Favorite without rewriting it;
6. restores a tombstone with revision + 1 and the earliest valid `addedAt`;
7. removes an active Favorite with revision + 1 and a server-time tombstone;
8. treats absent remove as a deliberate no-op; and
9. preserves every unrelated Favorite.

The existing caller/operation/request idempotency record stores only a request
fingerprint and bounded result. Exact terminal replay returns that result. A
reused request ID with changed normalized input is rejected. Concurrent RTDB
transaction retries always rerun the real count and revision checks.

## Disabled Integration

Direct Favorite writes are denied in the undeployed additive rules candidate.
Owner exact reads additionally require the future preference read gate. The
client feature flag and server write gate remain false or absent, so the
callable rejects before idempotency acquisition and the queue cannot drain.

The disabled queue can translate one bounded `favorite-upsert` or
`favorite-delete` record only to `mutateFavoriteTrainer`; it cannot supply an
owner UID or path. Future migration uses one idempotent callable per Favorite,
requires a stable target UID and source fingerprint, and remains explicit,
previewable, resumable, and local-data-preserving. No batch migration endpoint
or payload exists.

## Privacy And Activation

Logs contain only operation class, result class, mode, correlation hash,
duration, App Check presence, and replay state. Labels, UIDs, notes, tags,
payloads, paths, and preference contents are excluded. Favorite mutations never
read or write public shares, Approved Viewer grants, private notes, tags,
history, identities, or Auth users.

This candidate does not authorize a rules or Functions deployment, either
server gate, either client feature flag, queue draining, migration, staging
resource creation, or production activity. All 11 formal approvals remain
`undecided`.
