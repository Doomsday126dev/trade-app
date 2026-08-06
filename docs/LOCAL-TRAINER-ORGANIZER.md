# Local Trainer Organizer

Favorites, recent trainers, private tags, and private notes use the existing `trainerHistoryStore` browser partition. Version 2 extends the prior Favorites and Recents schema in place; it does not create a second store or Firebase path.

## Ownership And Migration

- Storage remains keyed by authenticated UID and validates the exact UID and canonical username on every read.
- Version 1 records migrate additively and idempotently when their owner binding matches.
- The historical `pogoTrainerHistory_v1:` key prefix is intentionally retained as the single live partition key; record-level schema and migration versions advance to 2 in place, so no competing legacy key remains active.
- Malformed legacy favorites and recents are skipped and counted without exposing their contents.
- Account switching and logout replace the active store and clear organizer-only transient state.
- Favorites are ordered predictably by canonical display name. Recents retain newest-first ordering.

## Local Bounds

- Favorites retain the existing 20-record bound.
- Recents retain the existing 6-record client bound.
- A partition may contain at most 24 private tags.
- A favorite may reference at most those 24 stable tag IDs.
- Tag labels are normalized with NFKC for duplicate detection and are limited to 40 characters.
- Private notes are normalized with NFKC and limited to 240 characters.

These bounds keep device storage and compact-screen controls predictable. Display capitalization is preserved even though matching is case-insensitive.

## Privacy Boundary

Tags and notes never enter public-share snapshots, exports, Firebase reads, Firebase writes, share-access grants, or cross-trainer lookups. Find Trainer continues to read another trainer only through `publicShares/{username}`. Favorites and tags do not imply Approved Viewer access.

The active sync state is `local-only`. Future states (`pending-sync`, `synced`, `conflict`, and `sync-error`) are modeled for compatibility, but the synced-preferences feature flag and server write gate remain disabled. No automatic migration runs. A future migration must require exact UID and username ownership, completed server reads, explicit approval, enabled gates, and reread verification before local data can be removed.

## Non-Goals

This release does not sync organizer data across devices, grant share access, migrate signed-out data, expose tags on public trainer cards, or provide a production preference repository. It performs no Firebase read or write for tags or notes. Conflict resolution and remote persistence remain disabled future work.
