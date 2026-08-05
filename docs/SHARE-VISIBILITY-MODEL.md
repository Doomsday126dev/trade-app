# Trainer Share Visibility Contract

Status: **emulator-only candidate, disabled, unseeded, and unsafe to deploy**

This candidate defines server-enforced visibility for published trainer shares.
It does not change the production client, production rules, or production data.
The production defaults remain equivalent to:

```text
SHARE_VISIBILITY_MODEL_ENABLED = false
LEGACY_PUBLIC_SHARE_COMPAT_ENABLED = true
```

The client constants currently live only in the unwired domain candidate
`js/domain/shareVisibility.js`. No production page loads that module.

## Security blocker

The deployed rules still inherit `.read: "auth != null"` at the database root.
Realtime Database child rules cannot revoke a read granted by a parent. A real
approved-viewer/private model therefore cannot be deployed until the root grant is
removed and every retained client read has an explicit narrow rule. The
candidate fixture `tests/firebase/database.rules.share-visibility.json` starts
with root reads and writes denied and contains no broad authenticated bypass.

## Final schema

### `shareVisibility/{ownerUid}`

```json
{ "mode": "public", "updatedAt": 0 }
```

`mode` is the locale-independent enum `public`, `approved_viewers`, or `private`.
The owner and protected admins may write it only while the emulator-only write
gate is enabled. Authenticated exact-mode reads are intentionally allowed so a
signed-in selected-trainer view can distinguish Approved Viewers from private;
anonymous visitors receive only a neutral restricted result. `updatedAt` is
owner/admin-only and is never exposed to an unauthorized viewer.

### `shareAccess/{ownerUid}/{viewerUid}: true`

This is an explicit owner-controlled **Approved viewers** list. The owner and
protected admins may add or revoke viewers. A viewer cannot self-grant. Revoking
the value immediately removes rules-level access to an Approved Viewers share.
Legacy username flags and profile roles grant nothing.

### `trainerShares/{ownerUid}`

The allowlisted projection contains:

```json
{
  "schemaVersion": 1,
  "shareVersion": 1,
  "trainerName": "DisplayName",
  "profile": {
    "friendCode": "optional",
    "bio": "optional",
    "discord": "optional",
    "avatarPokemon": "optional"
  },
  "lists": {
    "wishlist": {},
    "dynamax": {},
    "gmax": {},
    "costumes": {}
  },
  "publishedListTypes": {
    "wishlist": true,
    "dynamax": true,
    "gmax": true,
    "costumes": true
  },
  "publishedAt": 0,
  "updatedAt": 0
}
```

Rules read the mode and Approved Viewers by immutable Firebase Auth UID:

- `public`: readable anonymously.
- `approved_viewers`: readable by the owner, protected admins, and authenticated UIDs
  explicitly present under `shareAccess/{ownerUid}`.
- `private`: readable only by the owner and protected admins.

The projection is the only cross-trainer list source. Owned `users`,
`wishlist`, `dynamax`, `gmax`, `costumes`, and Inventory records are not a
fallback. Unauthorized reads cannot retrieve category names, counts,
timestamps, published types, or entries.

### `shareDirectory/{normalizedTrainerName}`

```json
{ "ownerUid": "uid", "trainerName": "DisplayName", "state": "published" }
```

An exact public lookup resolves a stable UID while preserving display casing.
Parent enumeration is denied by this rules contract. A future bounded search
index may expose only the minimum discovery fields. Directory writes must
match the UID account's canonical normalized handle. Username changes update
discovery metadata without moving `trainerShares`, `shareVisibility`, or
`shareAccess`.

### Compatibility indexes

`legacyShareOwners/{username}: ownerUid` is private and admin-managed.
`publicShares/{username}` remains available only when:

1. `shareVisibilityConfig/legacyCompatEnabled` is true;
2. the username has an explicitly reviewed UID mapping; and
3. that UID's mode is `public`.

This keeps an existing safe link stable during migration. Favorites/private
modes immediately disable anonymous legacy access. Unmapped legacy records and
parent enumeration remain denied. Compatibility writes are gated and
UID-authorized; the long-term writer targets `trainerShares/{ownerUid}`.

## Cross-device private trainer preferences

The final preference model syncs across signed-in browsers, iOS, Android, and
installed PWA sessions. It remains disabled behind:

```text
SYNCED_TRAINER_PREFERENCES_ENABLED = false
trainerPreferenceConfig/writesEnabled = false
```

The production device-local store remains authoritative until private narrow
rules, migration, and multi-device behavior are validated.

### Favorite Trainers

```text
userPreferences/{viewerUid}/favoriteTrainers/{ownerUid}/
  trainerName
  addedAt
  note
  tagIds/{tagId}: true
```

This is a private bookmark keyed by the selected trainer's stable owner UID.
The optional note is capped at 240 characters. `addedAt` is immutable. Only the
viewer and protected admins can read or write the viewer's preference subtree.
The tagged trainer and other ordinary users cannot enumerate or read it.

Favorite Trainers never participate in `trainerShares` read rules. Favoriting
B does not let B read A, and granting B under `shareAccess/A/B` does not create
a personal favorite for either account.

### Private custom tags

```text
userPreferences/{viewerUid}/trainerTags/{tagId}/
  label
  normalizedLabel
  labelKey
  active
  createdAt
  updatedAt

userPreferences/{viewerUid}/trainerTagLabels/{labelKey}: tagId
```

`tagId` is an opaque, stable client-generated ID. Labels are NFKC-normalized,
trimmed, internal whitespace is collapsed, and comparison is case-insensitive;
display capitalization is preserved. Labels are limited to 40 Unicode code
points. `labelKey` is a deterministic Firebase-safe encoding of the normalized
label. The private claim index rejects reassignment of an existing normalized
label to another tag ID.

Creating and renaming a tag first reserves the normalized claim, then writes
the tag record. Assignments reference only active tags in the same viewer
namespace. Deletion is a non-destructive `active:false` soft delete: old card
assignments are ignored, avoiding an unbounded multi-path cleanup. The same tag
ID can be reactivated; old label claims may be retired later through a bounded,
separately tested cleanup. Strict verification that a supplied `labelKey`
matches NFKC normalization cannot be expressed in RTDB rules alone, so the
canonical domain helper owns that derivation; if hostile self-corruption must
be prevented, tag writes should move behind a trusted callable service rather
than weakening privacy rules.

### Bounded Recent Trainers

```text
userPreferences/{viewerUid}/recentTrainerSlots/{00..29}/
  ownerUid
  trainerName
  lastOpenedAt
```

The fixed 30-slot shape prevents indefinite growth at the rules layer. Clients
transactionally merge by owner UID, retain the newest timestamp, sort by
`lastOpenedAt` descending with owner UID as a deterministic tie-breaker, and
replace the oldest slot. Favorites may also appear in Recents; the persistent
Favorite Trainers list means eviction never loses a bookmark. Concurrent
devices retry the transaction against the latest slots.

### Bounded seen history and unread changes

Every new `trainerShares/{ownerUid}` publication has a monotonically increasing
`shareVersion`. Per-viewer history stores only the last seen public comparison
representation:

```text
userPreferences/{viewerUid}/trainerHistory/{ownerUid}/
  lastSeenShareVersion
  lastSeenUpdatedAt
  lastSeenFingerprint
  entryCount
  lastSeenSnapshot/{stableEntryId}/
    category
    fingerprint
```

The snapshot contains stable public entry IDs, category, and a fingerprint of
allowlisted public fields only. It contains no private list record or contact
metadata. The domain helper derives `entryCount` and refuses to construct more
than 1,500 entries; rules require a numeric declaration from 0 through 1,500
and validate every stored entry's shape. RTDB rules cannot prove that a declared
count equals the number of arbitrary map children. Strict server reconciliation
of that declaration requires a trusted callable/backend. This representation is
sufficient to calculate added, removed, modified, and category-moved entries.
Larger shares retain version and aggregate unread state but require an on-demand
comparison strategy rather than unbounded preference duplication.

Unread is derived from `currentShareVersion > lastSeenShareVersion`; it is not
an independently writable boolean. Merely rendering Favorites performs no
write. Opening an authorized, available trainer advances the seen version and
baseline. Rules reject a lower version or timestamp and reject a different
fingerprint for an already-recorded version, so a stale device cannot replace
or move the baseline backward. The rules enforce the declared range and entry
structure; the domain helper constructs the bounded snapshot. Restricted,
unavailable, malformed, and failed reads do not update history and therefore
cannot become a mass-removal diff.

### Local-to-synced migration

Migration occurs once per verified UID-and-username local partition after the
private rules are live:

1. Bind the active Firebase UID and canonical username.
2. Reject any local partition whose UID or username differs.
3. Read the viewer's existing server preferences exactly.
4. Normalize and deduplicate favorite trainers and tags.
5. Merge Recents into the 30-slot transaction.
6. Preserve whichever seen state has the higher share version; use timestamp
   only as a tie-breaker.
7. Write one owner-scoped preference transaction and verify it by rereading.
8. Mark the local partition imported, but do not delete it until a later
   successful session confirms server persistence.

The rollout flag can return the app to local-only behavior without deleting
either copy. No other local account partition is inspected or imported.

### Planned Favorites UX

Find Trainer/profile views retain Favorite/Unfavorite. Favorites shows private
tag chips and supports trainer-name plus tag search and one-or-more-tag filters.
An accessible dialog or mobile sheet creates, renames, deactivates, and assigns
tags with keyboard, mouse, and touch support. Compact cards wrap tag chips on
mobile; desktop may expose richer filtering. Loading, offline, sync-error,
empty, and conflict-safe states use translation keys. The UI may say that
favorites are synced, but it does not expose Firebase terminology.

### Future groups are reserved, not implemented

The candidate reserves denied paths for future designs such as:

```text
shareGroupAccess/{ownerUid}/{groupId}: true
groups/{groupId}/members/{viewerUid}: true
```

Group invitations, roles, revocation, and audit history require a separate
review. No group rule currently grants access.

## Client compatibility layer

The unwired `trainerShareRepository` is read-only. With the model disabled it
plans only `publicShares/{username}` reads. With the model enabled it resolves
the owner UID and reads only `shareVisibility/{ownerUid}/mode` when signed in
and `trainerShares/{ownerUid}`. It exposes no write, grant, migration, or
private-list method.

`trainerPreferences.js` is likewise unwired and defaults synced preferences to
off. It centralizes tag normalization, bounded recent merging, monotonic seen
updates, and UID-partition migration checks without any Firebase access.

Client presentation states are stable identifiers:

- `published_public`
- `published_authorized`
- `restricted`
- `approved_viewers_restricted`
- `private`
- `private_owner`
- `not_published`
- `projection_incomplete`
- `projection_unsupported`
- `transport_error`

Anonymous Approved Viewers/private responses use the same translated neutral
restricted presentation. Signed-in exact mode lookup may distinguish
Approved Viewers from private without revealing list metadata. All eventual UI
labels and messages must use translation keys.

## Read-only migration audit design

The later audit reuses the existing private identity-report workflow and reads
only reviewed identity mappings plus existing public projections. It must not
read owned lists to fabricate a share. Every record remains `seedEligible:
false` and is classified as one of:

- `valid_complete_public`
- `incomplete_profile_only`
- `missing_projection`
- `unsupported_malformed`
- `inactive_legacy`
- `duplicate_conflict`
- `unresolved`

Valid complete projections may be proposed for an explicit public default.
Incomplete and missing records stay unpublished until their owner republishes.
Conflicts and unresolved identities require manual review. Console output is
aggregate-only; detailed reports remain private, git-ignored, and non-write-
capable. No migration runs in this milestone.

## Staged deployment and rollback

1. Finish the explicit narrow-read rules map for every active client surface.
2. Run this emulator matrix alongside existing rules suites.
3. Audit current public projections and UID mappings without writes.
4. Deploy narrow reads first and prove cross-account private-path denial.
5. Seed only approved UID mappings and valid existing public projections.
6. Validate private preference rules and perform an owner-matched local import
   for test accounts with the synced-preference flag still off.
7. Enable the client model for a controlled cohort while retaining legacy
   public-link compatibility.
8. Enable synced preferences separately after multi-device convergence smoke.
9. Remove compatibility only after stable links have migrated.

Rollback before rules deployment is deletion/revert of these inactive files.
After a future staged activation, turn the client flag off first, restore the
captured prior rules artifact if legitimate reads fail, and leave all legacy
records untouched. A mode leak, cross-account read, grant bypass, blocked owner
access, or broken safe public link is an immediate rollback trigger.

## Production blockers

- Authenticated root `.read` remains live.
- Current production shares are username-keyed and lack reviewed UID owner
  mappings for this contract.
- The migration audit has not classified all current projections.
- No production `shareVisibility`, `shareAccess`, `trainerShares`, or
  compatibility-owner records exist.
- No production private preference records exist, and the current local
  favorites/history partitions have not been migrated or cross-device tested.
- The production client does not yet resolve the UID share path or render the
  new authorization states.

These are expected gates, not reasons to weaken the rules candidate.
