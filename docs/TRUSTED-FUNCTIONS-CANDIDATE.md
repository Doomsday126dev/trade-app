# Trusted Functions Candidate

Status: **local emulator-only, undeployed, production-inactive**

This workspace implements four Firebase Cloud Functions 2nd generation callable
entrypoints as a review candidate:

- `reserveTrainerHandle`
- `claimTrainerTagLabel`
- `verifyTrainerHistory`
- `setApprovedViewer`

There is no deployment script, production project alias, credential, live URL,
browser wiring, generic path writer, bulk operation, identity repair, projection
generator, or `renameTrainerHandle` endpoint. The existing client flags remain
false and both RTDB write gates remain false or absent. Each service checks its
server write gate before reserving an idempotency record, so accidental
deployment remains mutation-disabled.

## Callable schemas

All requests are strict plain objects. Unknown fields are rejected. Every
response contains only `{ ok, operation, status, replay }`; no identity or
private content is returned.

| Callable | Request fields | Maximum |
| --- | --- | --- |
| `reserveTrainerHandle` | `requestedHandle`, `requestId` | 4 KiB; handle 64 code points |
| `claimTrainerTagLabel` | `action`, `tagId`, `label` when required, `baseRevision`, `requestId` | 4 KiB; label 40 code points |
| `verifyTrainerHistory` | `ownerUid`, `shareVersion`, `shareUpdatedAt`, `declaredEntryCount`, `publicSnapshot`, `requestId` | 256 KiB; 1,500 entries |
| `setApprovedViewer` | `viewerUid`, `action`, `requestId` | 4 KiB |

Request IDs are 8-128 characters and limited to stable ASCII identifier
characters. Tag IDs are locale-independent `tag_...` identifiers. Error codes
are stable domain values; translated client messages remain outside Functions.

## Authorization and App Check

Firebase Auth context supplies the caller UID. No request accepts a caller UID.
Handle and preference writes are always scoped to that UID. Approved Viewer
owner UID is the Auth UID and cannot be overridden. This milestone deliberately
does not expose administrative grant management; a future admin variant would
require an explicit owner field and `/admins/{callerUid} === true`.

Canonical comparison uses Unicode NFKC followed by JavaScript `toLowerCase()`
without a locale argument. This is deterministic across supported Node
runtimes, but it is simple lowercase normalization rather than full Unicode
case folding; it does not merge every linguistically equivalent form. Handle
validation additionally rejects invisible/bidirectional controls and mixed
Latin/Cyrillic/Greek strings. Same-script visual confusables still require a
future reviewed confusable-data policy or trusted library update.

Every production callable uses `enforceAppCheck: true` by default. A bypass is
accepted only when all three conditions hold:

```text
FUNCTIONS_EMULATOR=true
GCLOUD_PROJECT starts with demo-
TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS=true
```

The bypass fails closed outside that combination. A future web/PWA rollout must
register the provider, obtain SDK-managed App Check tokens, monitor rejected
calls with mutation gates still off, and only then seek approval for hard
enforcement plus writes. Rollback disables the client feature and server gate;
App Check supplements Auth and RTDB rules rather than replacing either.

## Fixed writes and immutability

`reserveTrainerHandle` uses one root transaction because the account and
normalized directory claim must be checked and committed atomically:

```text
accounts/{callerUid} = {
  trainerName: display NFKC value,
  normalizedTrainerName: NFKC + JavaScript toLowerCase authority key
}
shareDirectory/{normalizedTrainerName} = {
  ownerUid: callerUid,
  trainerName: display NFKC value,
  state: unpublished
}
```

Once established, `normalizedTrainerName` and `ownerUid` cannot change through
this endpoint. Display case is preserved at first reservation. A missing or
inconsistent account/claim pair is rejected for separate review rather than
repaired. A rename needs a
separately reviewed endpoint and is not implemented.

Tag create/rename/soft-delete transactions are confined to
`userPreferences/{callerUid}` and update only `trainerTags` and
`trainerTagLabels`. Rename releases and claims labels atomically. Soft deletion
does not scan or rewrite Favorite assignments; inactive assignments are ignored
by the client domain. Each accepted mutation advances the tag revision and
stores the idempotency request ID; a stale base revision is rejected.
The additive rules candidate denies direct client writes to both tag roots, so
normalized label claims cannot bypass this trusted operation.

History writes are confined to
`userPreferences/{callerUid}/trainerHistory/{ownerUid}`. The callable reads the
exact `trainerShares/{ownerUid}` source and the exact visibility/access records,
then compares its canonical public snapshot to the supplied snapshot. This is
safer than trusting client data because the backend verifies availability and
content without reading `users`, owned lists, Inventory, or other private data.
Restricted, absent, or changed sources cannot create removal history.
Accepted history advances store a server-derived entity revision and the
idempotency request ID alongside the verified snapshot metadata.
The additive rules candidate likewise denies direct client history writes.

Approved Viewer changes are confined to
`shareAccess/{callerUid}/{viewerUid}`. Target identity must have a coherent
`accounts/{viewerUid}` and `shareDirectory/{normalizedName}` claim. Favorites,
Tags, Recents, Notes, and History are untouched.

## Idempotency and replay

Each request reserves:

```text
trustedOperationRequests/{callerUid}/{operation}/{requestId}
```

The record contains a SHA-256 canonical request fingerprint, `pending` or
terminal status, timestamps, expiry, and a bounded non-sensitive result. It
never stores request content. A same-ID/same-fingerprint terminal replay returns
the prior result; a different fingerprint is rejected; an in-flight duplicate
returns `unavailable` and cannot execute concurrently. Domain mutations use
transactions after hydrating their exact transaction reference from the server,
so a warm Admin SDK cache cannot misclassify current state. After the reservation
transaction grants one executor, terminal
recording rereads and verifies the exact request fingerprint and pending state,
writes only that fixed request record, then verifies the persisted terminal
state. If terminal recording fails after a mutation, retries remain blocked as
pending rather than risking a duplicate mutation.

Transaction result classifications are recomputed on every callback invocation;
they do not retain status inferred from an earlier local-cache callback when RTDB
retries against authoritative server state.

Records use a seven-day retention timestamp. A future separately reviewed
scheduled cleanup may delete only expired terminal records. No cleanup function
or scheduler exists here.

## Logging and errors

Structured logs allow only operation, success/error class, emulator/production
mode, request-correlation hash, bounded duration, App Check presence, and replay
status. They exclude UID, email, handles, normalized keys, labels, tag IDs,
owner/viewer identity, snapshots, payloads, tokens, credentials, URLs, and
identifier-bearing Firebase paths.

Stable errors are: `unauthenticated`, `app_check_required`, `invalid_argument`,
`permission_denied`, `conflict`, `stale_state`, `replay_mismatch`,
`payload_too_large`, `unavailable`, and `internal`. Raw Admin SDK errors are
mapped to `internal`.

## Threat model

| Threat | Control |
| --- | --- |
| Forged caller or owner UID | Auth context is sole caller/owner authority |
| Missing App Check | Production-default platform and handler rejection |
| Handle/tag collision | Server NFKC normalization plus transaction claim |
| Mixed-script confusable handle | Conservative Latin/Cyrillic/Greek mixing rejection |
| Replay or concurrent duplicate | Canonical fingerprint and pending/terminal request record |
| Arbitrary-path injection | No path parameters and fixed adapter methods only |
| Oversized or private snapshot | Byte, count, field, category, and fingerprint allowlists |
| Fabricated or unavailable history | Exact authorized public share verification |
| Stale history | Monotonic version/time and same-version fingerprint checks |
| Viewer self-grant/cross-owner grant | Self rejection; Auth UID is immutable owner |
| Legacy privilege spoof | No profile, community, username, or Favorite authority |
| Partial mutation | Transactional domain updates; blocked replay after ambiguous completion |
| Log disclosure | Allowlisted redacted event schema with correlation hash |
| Accidental deployment | No deploy command, demo-only config, disabled server gates |

## Local verification

Unit and static contract checks require only Node.js:

```sh
npm run check:trusted-functions
npm run check:trusted-functions-contract
```

Install the isolated ignored runtime before the emulator gate with
`npm --prefix functions install --ignore-scripts --no-audit --no-fund --no-package-lock`. This
creates only `functions/node_modules/` and package-manager metadata for this
workspace; it does not modify the root application dependencies.

The emulator wrapper uses only project `demo-pogo-trusted-functions` and the
local Auth, RTDB, and Functions emulators. Its root-level config keeps both
`functions/` and the canonical
`tests/firebase/database.rules.share-visibility.json` fixture inside the same
effective Firebase project directory. Synthetic setup and Functions both use
the demo project's default RTDB namespace
`demo-pogo-trusted-functions-default-rtdb`:

The Functions Admin app selects that URL only when `FUNCTIONS_EMULATOR=true`,
the project begins with `demo-`, and the RTDB host is loopback. Production uses
normal Firebase initialization and embeds no database URL or project alias.

```sh
npm run check:trusted-functions-emulator
```

It requires Java 11+ and installs no production credential. If the wrapper
hangs after tests finish, press `Ctrl+C` once, confirm the test summary first,
then stop lingering emulators with `pkill -f firebase.*emulator` only if needed.
No command in this workspace deploys Functions.

The reviewed production runtime is Node 22. Node 24 is intentionally not
accepted by the emulator wrapper. The wrapper deliberately invokes npm
`firebase-tools@15.24.0` under the active Node 22 and passes that absolute Node
binary to the test command; it does not use the standalone Firebase CLI's
bundled Node 18. With `nvm`, use:

```sh
nvm install 22
nvm use 22
node --version
npm --prefix functions install --ignore-scripts --no-audit --no-fund --no-package-lock
npm run check:trusted-functions-emulator
```

Without `nvm`, Homebrew can provide the same runtime:

```sh
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
hash -r
node --version
npm --prefix functions install --ignore-scripts --no-audit --no-fund --no-package-lock
npm run check:trusted-functions-emulator
```

`node --version` must print `v22.x`. Node 24 is unsupported for this candidate;
the dependency deprecation warnings do not change this gate.

## Future approval gates

Before deployment: re-review all fixed paths, deploy additive rules separately,
keep write gates false, run Auth/RTDB/Functions emulator integration, configure
App Check and redacted monitoring, approve one production function revision,
and smoke with writes still gated. A second explicit approval is required for
any server gate, client feature flag, UID seed, preference migration, or cohort.
Rollback removes client invocation, disables gates, and restores the prior
function revision. No current private review decision becomes seed-eligible.
