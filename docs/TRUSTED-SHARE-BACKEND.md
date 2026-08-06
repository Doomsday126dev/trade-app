# Trusted Share Backend and Activation Readiness

Status: **local architecture and zero-write planning candidate**

This milestone does not deploy a backend, rules, records, migrations, grants,
or feature flags. The active defaults remain:

```text
SHARE_VISIBILITY_MODEL_ENABLED = false
SYNCED_TRAINER_PREFERENCES_ENABLED = false
shareVisibilityConfig/writesEnabled = false or absent
trainerPreferencesConfig/writesEnabled = false or absent
```

The three diagnostic `confirmed_valid_identity` decisions remain diagnostic;
all 52 private review records remain `seedEligible: false` (three confirmed,
49 unreviewed). No record is selected as a production cohort.

## Recommended platform

Use narrowly scoped **Firebase Cloud Functions 2nd generation callable
functions** as the production trusted boundary.

| Property | Callable Functions | Cloud Run | Local Admin tool |
| --- | --- | --- | --- |
| Firebase Auth | Callable context is native | Token verification must be wired | Operator credentials only |
| App Check | Callable enforcement is native | Manual token verification | Not an end-user boundary |
| Small-scale cost | Scale-to-zero is suitable | Similar runtime, more setup | No hosting cost, high operator risk |
| Secrets | ADC/Secret Manager | ADC/Secret Manager | Local key custody |
| Emulator | Functions + Auth + RTDB Emulator Suite | Container/integration harness | Local tests only |
| Audit logging | Structured Cloud Logging | Structured Cloud Logging | Fragmented local logs |
| Rollback | Deploy previous function revision | Route previous revision | Remove/replace operator script |
| Maintenance | Small Firebase-native surface | More IAM and HTTP plumbing | Cannot support normal clients |

Cloud Run remains suitable if the functions outgrow callable limits. Existing
Admin SDK repair scripts remain exceptional, operator-approved tools and must
not become the normal client backend.

## Endpoint contracts

Every callable has one operation, an input allowlist, bounded input, Firebase
Auth UID authority, an idempotency request ID, redacted logs, and no arbitrary
path or bulk parameter. App Check is enforced before any production write gate
is enabled. A temporary monitor-only App Check rollout may record rejection
metrics, but cannot coincide with enabled production mutation.

### `reserveTrainerHandle`

- Input: `requestedHandle`, `requestId`.
- Backend reads the caller's account and the exact normalized claim.
- Normalize by trim, Unicode NFKC, then locale-independent JavaScript lowercase,
  preserving the NFKC display value. Reject empty, over 64 code points, or
  Firebase-illegal keys.
- Atomically create the account/directory claim when absent; an identical
  caller-owned claim is idempotent and a different UID is a collision.
- Never create Auth users, infer authority from profiles, or reassign identity.

### `claimTrainerTagLabel`

- Input: `tagId`, `action`, `label` when required, `requestId`.
- Caller UID is the only tag namespace. Labels are trim + NFKC + collapsed
  whitespace + case-insensitive comparison, with display capitalization kept.
- Enforce 40 Unicode code points and an exact per-viewer normalized claim.
- `claim`, `rename`, and `soft_delete` touch only the caller's tag and claim.
  Rename is atomic; soft delete leaves assignments harmlessly ignored.

### `verifyTrainerHistory`

- Input: exact owner UID, version/timestamp, declared count and fingerprint,
  public snapshot, `requestId`.
- Accept only `category` and `fingerprint` per entry and the four public list
  categories. Reject more than 1,500 entries.
- Count actual entries, canonicalize the bounded snapshot, recompute SHA-256,
  reject count/fingerprint disagreement, backward movement, and same-version
  fingerprint conflict.
- Write only the caller's exact history row after transaction revalidation.

### `setApprovedViewer`

- Input: target directory identity, `grant` or `revoke`, `requestId`.
- Caller must be the share owner. A protected administrative path, if retained,
  is derived only from `/admins/{auth.uid} === true`; legacy `isOwner`,
  `isAdmin`, username text, membership, and profile flags grant nothing.
- Resolve the target through reviewed UID directory data, reject self-grants,
  and modify only `shareAccess/{ownerUid}/{viewerUid}` idempotently.
- Favorites, Tags, Recents, Notes, and History are never read or written.

### `renameTrainerHandle` (future, separately enabled)

- Require the old claim, account UID, and authenticated UID to agree.
- Reserve the new normalized claim before releasing the old claim, in one
  transaction or compensating operation with a durable idempotency record.
- Update display metadata and compatibility indexes without moving UID-owned
  shares, visibility, access grants, or preferences.
- No identity reassignment, case-variant duplicate, or inferred ownership.

## Enforcement boundary

| Guarantee | RTDB rules | Trusted backend | Client UX only |
| --- | --- | --- | --- |
| Exact UID subtree privacy | Enforced | Rechecked | Path planning |
| Root enumeration denial | Enforced | N/A | N/A |
| Write gates | Enforced | Requires enabled rollout | Hidden while disabled |
| NFKC handle/tag normalization | Cannot compute | Enforced | Preview only |
| Atomic normalized uniqueness | Structural claim check only | Enforced | Conflict display |
| Actual history child count | Declared 0..1500 only | Recounted | Constructs bounded snapshot |
| Canonical history SHA-256 | Shape/monotonic metadata only | Recomputed | Preview only |
| Approved Viewer authority | Owner/admin path rules | Auth/target rechecked | Confirmation UI |
| App Check and replay defense | Not sufficient | Enforced | Request ID generation |

Strict hostile-client normalized uniqueness, arbitrary-map count
reconciliation, and canonical fingerprint verification are unsupported without
the trusted backend. The rules documentation must not claim otherwise.

## Additive rules readiness

- Live narrow-read baseline:
  `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`
- Additive candidate:
  `cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c`
- Preferred rollback is the live narrow-read baseline above. The historical
  broad-read artifact is not the rollback target for this additive change.

The candidate preserves all 19 live root entries byte-for-byte, including root
`.read: false` and `publicShares/{username}`. It adds 11 rule roots covering
11 registered future read surfaces plus config/denied group scaffolding.
Both new write gates remain false or absent, so unseeded roots are inert.

The registry now contains 41 surfaces: the 34 pre-preferences entries are
unchanged, and seven disabled preference surfaces were added. Eleven total future
surfaces are inactive, leaving 30 current, administrative, or legacy production
surfaces. This milestone changes none of them.

### Atomic Console deployment (separate approval required)

1. Re-run `npm run check:share-activation-readiness` and
   `npm run check:share-visibility-rules`.
2. Re-export the current deployed rules to the private mode-0600 ignored
   rollback artifact; verify its SHA equals the live baseline above.
3. In Firebase Console, open project `trade-list-a4297`, Realtime Database
   `trade-list-a4297-default-rtdb`, then **Rules**.
4. Copy the complete contents of
   `tests/firebase/database.rules.share-visibility.json`, replace the entire
   editor, and verify the staged SHA equals the additive candidate SHA.
5. Confirm both write gates are absent/false and click **Publish** once. Do not
   merge fragments or edit the live rules manually.
6. Smoke anonymous directory and exact public shares; TestUser exact-owned
   reads and reversible list edit; ordinary-user denial matrix; account switch;
   protected Admin open/close/reopen; final anonymous access.

Rollback immediately by replacing the complete editor with the verified live
narrow-read baseline if an existing read/write is blocked, a private path is
exposed, account isolation fails, Admin loses required access, or public shares
break. New roots remain empty; rollback requires no data deletion.

## One-record eligibility

`shareActivationPlanning.oneRecordEligibility()` is a pure gate. Exactly one
private record must pass every condition:

1. Fresh production read-only audit.
2. Exact source-audit and private-review hashes.
3. `confirmed_valid_identity` remains present.
4. `seedEligible` is still false and no conflict/protected/drift flag exists.
5. Complete current public projection.
6. Canonical UID ownership is still consistent.
7. Explicit account-owner approval.
8. Private one-record dry run reviewed.
9. Rollback reviewed.
10. Separate explicit approval to change `seedEligible` for that one record.

Passing the pure gate reports `eligible_for_separate_seed_approval`; it does
not change `seedEligible`, select a cohort, or authorize a write. Therefore no
current record can be a cohort without a later, separately reviewed state
transition.

## Zero-write planners

### UID seed planner

`uidSeedDryRun()` accepts exactly one already-gated private record and fresh
baseline fingerprints. It plans only these logical targets:

```text
accounts/{uid}
shareVisibility/{uid}
shareDirectory/{normalizedTrainerName}
trainerShares/{uid}
legacyShareOwners/{username}
```

It emits deterministic before/after fingerprints, a proposed visibility, an
explicit stale warning, `seedEligible: false`, and `writes: 0`. It has no apply
mode, Firebase adapter, bulk target, identity repair, or private-list projection
generator. A later mutation tool must re-read every baseline and use a separately
reviewed write payload; this planner output is never permanent authority.

### Preference migration planner

`preferenceMigrationDryRun()` requires exact UID-and-username partition
ownership and completed server reads. It previews deterministic Favorite
deduplication with earliest `addedAt`, newest bounded Recents, highest-version
History with timestamp tie-breaking, and normalized Tag conflicts that require
review. It reports `writes: 0`, has no apply mode, never deletes local state,
and requires a later reread after any separately approved server persistence.

Detailed future reports belong under `.local/uid-handle-audits/`, mode 0600,
ignored and untracked. Normal output is aggregate and redacted.

## Threat model and failure behavior

| Threat | Required response |
| --- | --- |
| Normalized handle/tag collision | Server normalization and atomic claim reject |
| Self-grant or forged viewer UID | Auth owner/target resolution rejects |
| Cross-owner grant | Reject unless protected admin is read from `/admins/{uid}` |
| Stale offline client | Transaction reread; reject backward version/time |
| Same-version fingerprint attack | Recomputed SHA and conflict rejection |
| Arbitrary-path injection | Fixed target allowlist; no path input |
| Oversized payload | Code-point, entry-count, and request-size bounds |
| Replayed callable | Required idempotency key and stored result semantics |
| Missing/failed App Check | Reject once production mutation is enabled |
| Legacy admin/profile spoof | Ignore; only authoritative admin registry counts |
| Log leakage | Structured codes/counts only; redact identity and payloads |
| Partial multi-path failure | Atomic transaction; otherwise fail closed and report no reconciliation |

No general-purpose Admin endpoint, bulk operation, arbitrary database path,
identity repair, projection reconstruction, or hidden fallback is part of this
candidate.

## Backend emulator gate

Preference activation remains blocked even after this backend gate passes:
RTDB Rules cannot strictly reconcile the arbitrary Favorite-map count. A narrow
trusted Favorite mutation callable is the current recommendation and requires a
separate design, implementation, emulator, deployment, and activation approval.

Before any callable implementation is deployable, the Functions/Auth/RTDB
Emulator Suite must exercise authenticated owner, ordinary user, protected
admin, removed admin, unauthenticated, and invalid/missing App Check contexts.
It must cover normalization collisions, UID preservation, per-viewer tag
isolation, rename/soft-delete atomicity, actual history count and SHA mismatch,
oversized history, stale/same-version conflict, self/cross-owner grant denial,
idempotent replay, fixed target allowlists, redacted logs, and transaction
failure with zero partial state. Emulator tests must also prove a grant changes
no preference subtree and a preference mutation changes no access subtree.

The fixed callable candidates are local and undeployed. Their pure contracts and
emulator suites define these validation decisions without production credentials
or access; a separate staging deployment review remains mandatory.
