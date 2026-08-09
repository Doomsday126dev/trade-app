# Local Trainer Organizer

Favorites, recent trainers, and private tags use the existing `trainerHistoryStore` browser partition. Version 3 removes the former Favorite-note field in place; it does not create a second store or Firebase path.

## Ownership And Migration

- Storage remains keyed by authenticated UID and validates the exact UID and canonical username on every read.
- Older records migrate additively and idempotently when their owner binding matches. Version 3 drops former Favorite-note fields while preserving Favorites, tags, assignments, Recents, history, and account partitioning.
- The historical `pogoTrainerHistory_v1:` key prefix is intentionally retained as the single live partition key; record-level schema and migration versions advance to 3 in place, so no competing legacy key remains active.
- Malformed legacy favorites and recents are skipped and counted without exposing their contents.
- Account switching and logout replace the active store and clear organizer-only transient state.
- Favorites are ordered predictably by canonical display name. Recents retain newest-first ordering.

## Local Bounds

- Favorites retain the existing 20-record bound.
- Recents retain the existing 6-record client bound.
- A partition may contain at most 24 private tags.
- A favorite may reference at most those 24 stable tag IDs.
- Tag labels are normalized with NFKC for duplicate detection and are limited to 40 characters.

These bounds keep device storage and compact-screen controls predictable. Display capitalization is preserved even though matching is case-insensitive.

## Privacy Boundary

Tags never enter public-share snapshots, exports, Firebase reads, Firebase writes, share-access grants, or cross-trainer lookups. Find Trainer continues to read another trainer only through `publicShares/{username}`. Favorites and tags do not imply Approved Viewer access.

The active sync state is `local-only`. Future states (`pending-sync`, `synced`, `conflict`, and `sync-error`) are modeled for compatibility, but the synced-preferences feature flag and server write gate remain disabled. The separate readiness contract adds entity revisions, tombstones, bounded UID-partitioned operations, conflict states, and explicit schema-v2 migration planning without changing this store. No automatic migration runs. A future migration must require exact UID and username ownership, current-generation completed server reads, explicit approval, enabled gates, and reread verification. Local data is never deleted automatically.

## Non-Goals

This release does not sync organizer data across devices, grant share access, migrate signed-out data, expose tags on public trainer cards, or activate the production preference repository. It performs no Firebase read or write for tags. The disabled conflict, queue, migration, rules, and UI contracts are documented in `TRAINER-PREFERENCE-SYNC-READINESS.md`.
