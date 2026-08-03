# Global Identity Schema Contract (Emulator Only)

Status: **disabled, unseeded, and unsafe to deploy**

This document defines the Commit 4 Firebase Realtime Database contract for the
trainer-first global app. The companion rules fixture is
`tests/firebase/database.rules.global-identity.json`. It exists only for the
Firebase emulators. The production client does not reference these paths, and
the fixture must not be published while the current authenticated root read
grant remains active.

## Deployment blocker

The deployed rules still include root `.read: "auth != null"`. Realtime
Database read rules cascade: a read allowed at a parent cannot be revoked by a
more restrictive child rule. Therefore, while that root grant exists, any
authenticated user can read proposed private nodes such as `accounts`,
`trainerHandles`, `privateProfiles`, `unlistedShareOwners`, and
`legacyUsernameIndex`.

`globalIdentityConfig/writesEnabled` gates every new data write, but it cannot
make reads private. The emulator suite intentionally characterizes this
transitional exposure. The candidate must remain undeployed and unseeded until
the client no longer depends on global reads and narrow production rules have
been deployed and verified.

## Disabled feature gate

```text
globalIdentityConfig/
  writesEnabled: boolean
```

- Missing and `false` both disable every write to the new data paths.
- Only a protected `/admins/{uid} === true` identity may change the flag.
- The production client has no reference to this flag or any new path.
- Emulator tests may set it to `true` only inside an isolated demo project.

## Path contracts

### `accounts/{uid}`

Private UID-centered identity record:

```json
{
  "trainerName": "DisplayName",
  "normalizedTrainerName": "displayname",
  "status": "setup",
  "legacyUsername": "DisplayName",
  "createdAt": 0,
  "updatedAt": 0
}
```

- Owner/admin read; owner/admin write only while enabled.
- `status` is one of `setup`, `active`, `frozen`, or `disabled`.
- An ordinary owner may initially create only `status: "setup"` and only after
  the matching handle reservation points to the same UID.
- The owner cannot self-change the trainer name, normalized handle, creation
  time, or status after creation. Admin review owns those transitions.
- Authentication email, provider tokens, PINs, contact fields, and list data
  do not belong here.

### `trainerHandles/{normalizedTrainerName}`

Private uniqueness reservation:

```json
{
  "uid": "firebase-auth-uid",
  "trainerName": "DisplayName",
  "state": "active",
  "claimedAt": 0,
  "updatedAt": 0
}
```

- Owner/admin exact read; never an anonymous search directory.
- Initial self-claim requires the authenticated UID, verified email/provider
  claim, an absent record, and enabled writes.
- Contention is resolved by one transaction at the exact normalized-handle
  node. Only one initial create can win.
- Ordinary users cannot overwrite, reassign, rename, or delete an established
  reservation. `uid` and `claimedAt` are immutable; freeze/rename/recovery is
  an admin-reviewed future workflow.
- The display value preserves capitalization. The key uses the Commit 3
  deterministic `trim -> NFKC -> toLowerCase` normalizer.

Before any production claim, the local migration gate must also prove that
every normalized value is a legal RTDB key. If the final Pokemon GO trainer-name
grammar permits `.`, `#`, `$`, `[`, `]`, or `/`, this path design must change to
a deterministic encoded or hashed key before deployment; those characters must
not be silently stripped from the public handle.

The account write follows a successful handle transaction. A full atomic
cross-root reservation plus account creation cannot be enforced from current
RTDB state alone; the future client must treat the handle as authoritative,
retry account synchronization idempotently, and never overwrite a conflicting
record.

### `privateProfiles/{uid}`

Owner-only settings and contact source:

```json
{
  "setupComplete": false,
  "visibility": "private",
  "avatarPokemon": "Pikachu",
  "bio": "...",
  "contacts": {
    "friendCode": { "value": "...", "visibility": "private" },
    "discord": { "value": "...", "visibility": "private" },
    "contactEmail": { "value": "...", "visibility": "private" }
  },
  "updatedAt": 0
}
```

- Owner/admin read and write only while enabled.
- Profile visibility is `private`, `unlisted`, or `public`.
- Every contact field independently defaults to private and has the same three
  visibility choices.
- Authentication email is not copied here automatically. `contactEmail` is an
  explicit user-entered sharing field, not the Firebase Auth email.

### `publicProfiles/{uid}`

Allowlisted public projection:

```json
{
  "trainerName": "DisplayName",
  "visibility": "public",
  "avatarPokemon": "Pikachu",
  "bio": "...",
  "contacts": { "discord": "explicitly-public-value" },
  "publishedAt": 0,
  "updatedAt": 0
}
```

- Anonymous exact-record read; no anonymous parent enumeration.
- Verified owner/admin write only while enabled and the private profile is
  public.
- `publishedAt` is set on first publication and remains immutable; later
  projection refreshes update `updatedAt` only.
- Contact values are accepted only when the corresponding private contact has
  `visibility: "public"` and the values match.
- Unknown fields are rejected. Auth email, UID, PIN, raw user record, inventory,
  quantity, offers, trades, and private metadata cannot be projected.

### `publicLists/{uid}`

Allowlisted published list projection:

```json
{
  "wishlist": { "pokemon-key": { "name": "Pikachu", "priority": "H" } },
  "dynamax": {},
  "gmax": {},
  "costumes": {},
  "forTrade": { "pokemon-key": { "name": "Eevee", "note": "..." } },
  "updatedAt": 0
}
```

- Anonymous exact-record read only when the matching public profile is public.
- Verified owner/admin write only while enabled and the private profile is
  public.
- Published entries may include variant identity, priority where applicable,
  lucky/shiny/XXL/XXS flags, and notes.
- Quantity and raw legacy Inventory records are rejected. Offers, trades,
  schedules, private contacts, auth fields, and arbitrary metadata are also
  outside the allowlist.

### `unlistedShares/{shareId}` and `unlistedShareOwners/{shareId}`

`unlistedShares` is an allowlisted point-in-time/profile-list projection reached
through a high-entropy opaque ID. It contains `trainerName`, optional projected
profile/contact fields, optional projected list entries, `active`, optional
`expiresAt`, `createdAt`, and `updatedAt`.

- Anonymous visitors may read an exact active, unexpired share ID.
- Parent enumeration is denied.
- The public share record contains no UID.
- Ownership is stored separately at private
  `unlistedShareOwners/{shareId}: uid`.
- Initial owner-index creation is UID-bound; verified owner/admin share writes
  require enabled writes. Arbitrary/private fields are rejected.

### `legacyUsernameIndex/{username}`

```text
legacyUsernameIndex/{legacyUsername}: uid
```

- Private owner/admin exact read under the narrow contract.
- Admin-managed writes only while enabled.
- It supports migration/recovery compatibility; it is not a public search
  directory and grants no authorization by itself.

## Authority summary

| Operation | Anonymous | Signed-in other user | Record owner | Protected admin |
| --- | --- | --- | --- | --- |
| Read account/private profile/handle/index | No | No after root cutover | Yes | Yes |
| Claim absent handle | No | Own UID + verified only | Own UID + verified only | Yes |
| Reassign established handle | No | No | No | Reviewed admin workflow only |
| Write private profile | No | No | Yes while enabled | Yes while enabled |
| Read exact public profile/list | Yes | Yes | Yes | Yes |
| Publish public projection | No | No | Verified owner while enabled | Yes while enabled |
| Read exact active unlisted share | Yes | Yes | Yes | Yes |
| Enumerate public/unlisted parents | No | No by this contract | No | No implicit enumeration |
| Write legacy username index | No | No | No | Yes while enabled |

The “No after root cutover” qualification matters: with the current deployed
root read, authenticated-other-user reads still succeed and are covered as a
known vulnerability characterization test.

## Production-seeding gate

No record may be written to these paths until all of the following are true:

1. Current client global subscriptions have been removed or replaced.
2. A narrow-read rules candidate passes the full anonymous/owner/other/admin
   emulator matrix and old-client compatibility review.
3. Narrow production rules are deployed with a captured rollback artifact.
4. Cross-account reads of `accounts`, `trainerHandles`, `privateProfiles`,
   `unlistedShareOwners`, and `legacyUsernameIndex` are proven denied in a
   minimal production smoke.
5. The UID/handle mapping dry-run has zero unresolved collisions or bindings.
6. A separately approved, idempotent seeding plan includes counts, checksums,
   a write manifest, and rollback steps.

Until then the contract is documentation plus emulator fixtures only.

## Cross-cutting implementation acceptance criteria

Every later global-app commit must preserve the following boundaries. Any
temporary exception requires an explicit maintenance-log entry, removal plan,
and test boundary.

### Modularity and maintainability

- Keep domain rules, validation, data access, Firebase integration,
  presentation, and feature-flag decisions in separate layers.
- New global functionality should live in focused modules under boundaries such
  as `js/domain`, `js/data`, `js/services`, and `js/ui`; do not add substantial
  new feature logic to the existing `index.html` monolith when a module is a
  reasonable fit.
- Reuse the canonical trainer-name normalizer and future projection/visibility
  validators. Do not create parallel normalization, privacy, or publication
  rules in event handlers or render functions.
- Define explicit inputs/outputs and predictable success/error shapes at module
  boundaries. Avoid adding implicit mutable-global dependencies.
- Add focused unit tests for domain and validation logic, emulator/integration
  tests for Firebase contracts, and browser coverage for user-facing workflows.
- Flag changes that materially increase coupling or global mutable state before
  implementation approval.

### Internationalization readiness

- Stored identifiers, normalized handles, Firebase keys, and enum values such
  as `private`, `unlisted`, `public`, `setup`, and `active` remain
  locale-independent. Presentation translates labels, never stored values.
- User-facing text must not live in domain, validation, data-access, or Firebase
  modules. UI modules consume stable translation keys and complete message
  templates with named placeholders.
- English is the fallback catalog, not a structural assumption. Locale loading
  must support catalogs such as `en`, `ja`, `es`, and `de` without changing
  domain or persistence code.
- Use `Intl` APIs for dates, times, numbers, and relative time. Do not assemble
  sentences from separately translated fragments or rely on capitalization for
  meaning or behavior.
- Pokemon-name localization is a separate catalog/data concern from general UI
  translation and must not alter canonical Pokemon keys.
- New layouts must tolerate longer translated labels and different writing
  systems.

The translation catalog foundation is a required roadmap milestone before
substantial Settings, privacy, profile, or Find Trainer UI is implemented. This
Commit 4 contract adds no translation system or user-facing text.
