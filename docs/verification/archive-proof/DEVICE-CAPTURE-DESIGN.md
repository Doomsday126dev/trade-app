# Known-device capture and versioned import on return

This is a proposed follow-on design, not a production migration implementation.
Evidence is the `.100` source at
`c3fd690a2a2c46dab448873b244e496199283694`. No live browser profile, IndexedDB
database, account or Firebase endpoint was inspected for this proof.

## What exists today and what a server cannot capture

| Store / source | Current behavior and evidence | Server-side capture limit |
| --- | --- | --- |
| `accountSync/<uid>/{meta,tradeEntries,favorites,tags}` | Canonical v1 authority; repository reads the owner root and validates committed records. `js/data/accountSyncRepository.js:13`, `js/domain/accountSyncMerge.js:45` | Includes accepted state only. Never infer that every device's pending mutation is represented |
| `accountSync/<uid>/profile` versus legacy `users/<username>` profile | Canonical provider-profile support is distinct from the current legacy profile path; `accountSyncRepository.js:17,122`, `application.js:9249` | Capture the proven profile authority; do not merge two divergent profile authorities or use a browser cache as evidence that a write succeeded |
| `accountSync/<uid>/{migrations,recoveryCandidates}` and `authIndex/<uid>/accountSyncRecoveryReviews` | Create-only migration/candidate evidence plus explicit review acceptance. `accountSyncRepository.js:65–108` | Remote copies can be archived; a candidate/acceptance existing remotely does not imply all device evidence has arrived or every local conflict is resolved |
| IndexedDB `pogoAccountSync_v1`, version 1, stores `entities`, `operations`, `conflicts`, `meta`, `recoveryCandidates` | `accountSyncModel.js:4`, `accountSyncJournal.js:5,18–29`. Each store is owner-indexed | A server cannot read these stores. They must be captured on each relevant browser/PWA installation |
| Journal `operations` | Original operation ID, input hash, patch, kind, base generations/field revisions, timestamps; wrapper has status, retries and errors. `accountSyncJournal.js:82,95–123` | Unsent/offline/blocked work and original conflicting intent are not recoverable from canonical server rows alone |
| Journal `entities` | Wrapper `{key,ownerUid,entityType,entityId,entity}`; can hold optimistic work alongside accepted observations. `accountSyncJournal.js:87,131–136`, `accountSyncController.js:246–301` | A local entity is not automatically canonical. Copying it over server state can erase another device's work |
| Journal `conflicts` | Stores original operation binding, fields, current revision, timestamp and resolution state. `accountSyncJournal.js:118–143`, `accountSyncController.js:421–439` | Canonical state does not preserve the losing local value by itself. Capture both the operation patch and conflict/current evidence |
| Journal `meta` | `migration-complete`, `legacy-source:<migration-id>`, `provider-profile-pending-v1`, `provider-publication-pending-v1`. `accountSyncRuntime.js:6–15,163–225,242–306,434–504` | Retained source snapshots, queued profile values or unpublished projections can be device-only. Capability metadata can be represented without enabling that capability |
| `pogoTrainerHistory_v1:<encoded uid>`, current payload v3 | Favorites/tags local projection, recents and snapshots; owner includes UID and username. `trainerHistoryStore.js:3–5,13–17,32–93` | Checked/new-since-checked baselines and recents are local. Canonical Favorites/Groups do not imply those baselines are synced |
| Favorite checked snapshots | Explicit `rememberChecked` records `seenAt`, target UID and snapshot. Group baselines use `{lists,declarations?,updatedAt}` from `favoriteShareSessionCache.js:90–98`; `application.js:5185–5213` | Do not replace `seenAt` with restore time or treat a renamed/rebound Favorite's old UID baseline as the new target's history |
| `pogoListSnapshots_v1` | Per viewer `encodedUid:encodedUsername`, then list type/trainer: keys, values and `savedAt`. `application.js:11117–11154` | This viewed-list diff history is not part of canonical accountSync. Shared-browser buckets must not be mixed |
| `pogoSessionCache_v2` | Owner-bound `protected:{owner,data}` plus public login-directory cache. Old `pogo3` is a legacy cache. `sessionCacheBoundary.js:3–36,93–138` | Own cached lists/profile may contain unsent changes; the whole cache can also include other people or credential-bearing legacy user records. Never archive it wholesale |
| `pogoSyncQueue_v2` / old `pogoSyncQueue_v1` | Owner-bound entries and quarantined whole-list replacements. `sessionCacheBoundary.js:6–10,35–83`; application queue handling at `application.js:1236–1325` | Preserve queued `null` deletions and quarantined intent. Do not replay old whole-list replacement or treat it as the canonical latest list |
| `pogoMyListOrder_v1:<uid>:<lane>` | Version 1, owner pair, H/M/L/U arrays; `application.js:7087–7130` | Device ordering can precede server acceptance or be a migration input. Capture as a device observation even where canonical `sortOrder` also exists |
| `pogoAccountSyncDevice_v1:<uid>` | Install ID used in migration evidence; `application.js:3074,3260–3268` | Not an authentication credential. A copy is evidence, not permission to impersonate or auto-merge another device |
| Locale/theme/search/export and other local choices | `pogoTheme`, Pokémon GO search locale/override, export style, safe-transfer defaults/prefilter, speed-add/advanced controls and UI preferences; see `application.js:294–298,1844,6907–6927,10169–10220,10657` and `accountSyncProduct.js:9–12` | A server profile is not a full device-settings backup. The proof represents a defined subset; a real capture adapter must classify all persisted preference keys before retirement |
| `pogoActivityLog_v1` | Per-user local activity counts, already trimmed to an age/count window. `application.js:10455–10484` | Can preserve only remaining correctly attributed events; neither server export nor this proof reconstructs entries already pruned |
| In-memory `combinedEditor`, add tray, undo stack, transient filters/dialogs and pending publication triggers | Application editor/undo logic and `publicSharePublication` gate hold transient state; `application.js:549–610,6604–6628` | Unsaved RAM-only draft text is not guaranteed to be in either server or IndexedDB. The proof explicitly marks volatile unsaved edits not captured |
| Firebase Auth persistence, PIN-reset pending state, provider continuation, App Check/session state | Auth storage and pending credential flows can contain reusable or short-lived secrets; see `application.js:1157–1200,1520,8938–8997` | Excluded. They cannot be preserved as a substitute for re-authentication |

Some server recovery evidence and device evidence overlap; other evidence does
not. Coverage is per source and per device, not a single “backup complete” flag.
The proof's server-only case intentionally cannot recover the device-only note.

## Known-device capture before retirement

1. **Establish ownership independently.** Require a fresh authenticated canonical
   owner and reviewed UID/alias/fence evidence. A local username hint, copied install
   ID, old UID token or self-asserted archive receipt is insufficient. Ambiguous or
   retired UID bindings remain unassigned review material until explicitly resolved.
2. **Freeze a capture boundary.** A future capture UI should pause local writes,
   coordinate tabs/PWA contexts and record owner/session generation. Read all five
   IndexedDB stores in one readonly transaction; read relevant raw localStorage
   keys before calling normalizers. Re-read version/fingerprint boundaries across
   storage systems. If owner or state changes, discard the candidate capture and
   retry; do not delete any source records.
3. **Capture pending work before cleaning caches.** Read every operation status,
   conflict, recovery candidate, optimistic entity and relevant metadata record.
   Capture legacy queue/quarantine, typed `legacy-source` snapshots, owned local
   lists, checked history and ordering. Preserve original operation IDs, input
   hashes, tombstones and base generations/revisions. Do not run queue drain,
   migration, history normalization or cache pruning merely to make capture easy.
4. **Use explicit field adapters.** Verify owner keys and nested bindings; extract
   only the owner and non-secret fields. Legacy whole-user records may contain PINs;
   Firebase browser storage is never an archive source. Unknown fields or versions
   block retirement pending classification, rather than being silently dropped or
   copied as opaque JSON. Third-party cached projections are included only as the
   bounded observations needed for this owner's baselines/recovery.
5. **Account for volatile drafts.** Either explicitly capture supported editor
   drafts as non-executable proposals or tell the user they must save/export those
   drafts before capture. The current proof implements neither production path and
   must not claim RAM-only work was captured.
6. **Seal and acknowledge.** Produce a versioned device bundle with source versions,
   device attribution, coverage, field dispositions and hashes. Independently retain
   an authenticated capture receipt outside the supplied bundle. Verify a clean
   offline restore and durably retain originals before recording capture complete.
   A failed/partial capture never authorizes deletion of device/server history.

The current trainer-history reader can migrate, trim, drop oversized snapshots or
reset foreign/future state. A production capture adapter must therefore inspect
raw storage bytes before invoking that reader. The fixture builder uses the reader
only to create valid synthetic examples, not to capture a real legacy browser.

## Versioned import on return for dormant devices

A known-device list cannot prove that every installation was contacted. The
alternative is a small future import-on-return bridge that retains **data decoders**
for known storage versions, not full historical app runtimes or Firebase writers.

Proposed handshake (not a deployed endpoint):

```text
DeviceCaptureV1:
  captureId, sourceDeviceId/install evidence, assertedOldOwner,
  sourceStorageVersions, captureTime, sourceFingerprint,
  ownedNonSecretSections, excludedFieldDispositions, bundleHash

Admission receipt:
  freshlyProvenCanonicalOwner, verifiedAlias/FenceEvidence,
  captureId, acceptedBundleHash, disposition, durableArchiveReceipt
```

The return sequence must be:

1. Load the new shell without deleting old origin storage. Do not activate the old
   accountSync queue or copy stale `pgu` identity into a new session.
2. Inspect supported local storage versions read-only, preserve an original bundle
   locally, then ask the user to authenticate/recover access through the current
   approved mechanism. No old PIN/token is uploaded as archive data.
3. Bind the bundle to independently proven canonical ownership. A retired UID
   requires explicit fence/alias proof to the surviving owner. Unknown ownership or
   unsupported source versions stay quarantined; a shared browser's other owners
   are not merged into this account.
4. Ingest the bundle as **archive/review data**, idempotently keyed by canonical
   owner, capture ID, source-device identity and bundle digest. For each operation,
   retain `(operationId,inputHash)`; a repeated ID with different contents is a hard
   conflict, not “latest timestamp wins.” A repeated identical bundle is an
   acknowledgement, not a replay.
5. Compare each pending proposal with the current canonical entity's generation,
   field revisions and committed mutation evidence. An operation already accepted
   must not be applied twice. A deleted entity must not resurrect. Stale patches,
   conflicting baselines or changed exact catalog mappings require review. Explicit
   user-approved changes would become **new** current-version operations with new
   IDs and current base evidence; original old operations remain archived.
6. Keep old FT/inventory/background/trade records inert. Preserve device-specific
   checked baselines and source timestamps without treating them as another
   device's “checked now.” Preserve pending profile/publication intent as review;
   never re-enable sharing, provider access or privileged claims from the bundle.
7. Return a durable receipt only after archival verification. Any later local
   cleanup needs separate policy/authorization and must not be inferred from this
   design. Preserve archive originals indefinitely, including rejected proposals.

Necessary future runtime work: early startup storage discovery before cleanup,
cross-tab capture quiescence, owner re-verification, a device-capture/review UI,
version negotiation, authenticated archive receipt storage, and explicit conflict
resolution into current operations. **None is implemented in this task.** The
offline reader only proves that data can survive once a coherent bundle exists.

## Exact limits of server-only preservation today

A server-only archive cannot capture a not-yet-sent patch, a rejected local value,
a local conflict record, an unuploaded optimistic entity, a local-only profile or
publication proposal, retained device-only legacy sources, checked/viewed-list
baselines, unsubmitted ordering/preferences, or an in-memory draft. It also cannot
recover a lost device or content already pruned from every source. A future server
archive must state these gaps even if every canonical collection hashes correctly.

The synthetic adapter demonstrates closed, typed representation of the listed
record families. It is not an exhaustive production extractor for arbitrary
browser caches, every preference key, every old board shape or every possible
provider/identity history. Unsupported fields cause a visible failure, preserving
the source until a reviewed adapter exists. That remaining capture work is a
retirement gate, not evidence that the missing data is disposable.
