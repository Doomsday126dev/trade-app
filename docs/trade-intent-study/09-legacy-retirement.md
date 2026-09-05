# Finite legacy retirement, not permanent compatibility

Concept only. No migration, account enumeration, freeze, backfill, certification,
deletion or PR #63 operator workflow executed. Small user base is an assumption
from the brief, not a verified migration inventory. Provider identity transition
and product-data simplification are separate scopes and approvals.

## Data we cannot lose

Immutable UID and ownership binding; valid access relationships and login continuity;
explicit wants/offers with all variants, notes, priorities and ordering; private
tags/saved people; publication visibility and approved-viewer grants; user-created
event/coordination information; deletion/tombstone semantics; unresolved recovery
evidence and reviewed decisions; original receipts and historical source references.
No credential/PIN/token export. Auth/provider bindings remain in their qualified
identity authority, not a downloadable re-creatable account record.

## Value versus representation

| Current representation | Long-term treatment | Why |
|---|---|---|
| Managed canonical entries / revisions / tombstones | Live authority | Intent and deletion semantics |
| Legacy category maps and old Board rows | Archive + deterministic import | Preserve exact qualifiers/order; retire duplicate live writes |
| Alias/source references in unified declarations | Transition provenance, then archive | Helpful for lossless reconciliation, not permanent UI concepts |
| Published snapshots | Rebuildable projection with consent version | Public data not full-account truth; revoked grants stay revoked |
| Favorite/share session caches | Derived, expire | Never substitute cache for authorization |
| Private tags / saved people | One UID-scoped private collection | Real user-authored value, not a public index |
| Recovery candidates + reviewed66 receipts | Retained evidence with typed state | Historical count is not active conflict count |
| Zero-seed device receipts | Additive audit | Legitimate evidence, not canonical mutation |
| Display names, sprite URLs, counts | Derive from stable IDs and catalogs | Asset changes must not rewrite identity |
| Obsolete stock/mirror fields | Versioned archive, explicit import review if needed | Not silently revived as core product |
| Test canary receipts / rollout manifests | Operator archive with access controls | Not normal-user navigation or live read dependency |

## Proposed transition state machine

DISCOVER -> ARCHIVE_VERIFIED -> IMPORT_VERIFIED -> CANONICAL_WRITES_ONLY ->
LEGACY_READS_DISABLED -> RETIRABLE. Every arrow is reversible or has an explicit
recovery route; skipping a failed verification is forbidden. Unknown state blocks
deletion, not sign-in to read-only recovery.

1. Inventory by exact UID-scoped schema/ownership, not username heuristics. Record
   source version, tombstones and pending local writes; recognize offline devices.
2. Create encrypted, access-controlled per-user archive with schema/catalog version,
   source revision, content manifest/digest, created timestamp and receipt lineage.
   Verify read-back and restoration on synthetic fixtures; owner export excludes
   other people's private data and all credentials. Retention is a separate policy.
3. Deterministic converter outputs one canonical intent model. Stable variants and
   unknown raw qualifiers both survive. Conflicts become explicit review items,
   never 'latest timestamp wins' where ownership or deletes would change.
4. Compare semantic before/after sets, visibility, notes, order, deletes and review
   states. Idempotent import keyed by UID/archive digest/import version. Canonical
   entry revisions fence delayed writes. Re-running receipt generation cannot reseed.
5. Switch writes through a server-enforced capability floor. Old clients fail safe
   with a recoverable upgrade/read-only path. Do not let obsolete offline clients
   silently rehydrate deleted objects or keep dual writes alive forever.
6. Stop live legacy reads after observed coverage and qualified returnee restore.
   A dormant account authenticates the same UID, verifies its archive, restores
   deterministically once, and reviews unsupported qualifiers before publication.
7. Delete adapters only when no supported caller, Rule or operator requires them,
   restore rehearsals pass, archives are verified, and rollback authority is clear.
   Deleting historical user data itself requires a separately approved retention gate.

## Recovery and rollback

Before canonical-write cutover, rollback is routing only. After new writes exist,
never restore an older archive over newer canonical data. Use append-only revision
history plus forward reconciliation; read-only mode is safer than split-brain dual
writers. UI rollback must still respect the new write floor. Identity bindings
remain immutable throughout; provider migration must separately qualify the reset
exclusion boundary. Preserving data does not mean reactivating old mutation paths.

## What we would not build today

Permanent username-keyed parallel truth, separate Board/intent storage, ever-growing
bootstrap migration branches in every normal load, implicit flags encoded into
priority strings, and multiple caches pretending to be the source. One canonical
product store with versioned adapters and one finite restore path is the target;
its database choice is not settled merely by preferring fewer components.
