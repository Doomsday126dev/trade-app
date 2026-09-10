# Isolated Favorite resolver candidate

**Not deployed or enabled.** This package is independent of provider publication,
Google onboarding, PIN reset and E.1. Browser activation is also false by default.

`POST https://us-central1-trade-list-a4297.cloudfunctions.net/resolveLegacyFavoriteIdentities`
accepts exactly `{handles: [exactHandle, ...]}` (1–50 unique NFC, case-sensitive
handles, each at most 64 characters; 16 KiB body). A single addition uses the same
contract. The response has `version:1` and ordered `results`: either
`{handle,status:'resolved',targetUid,canonicalHandle}` or
`{handle,status:'unavailable'}`. Missing, conflicting, retired and self targets
share the latter response. No account repair or private-list access is provided.

Production adapters call Firebase Admin `verifyIdToken(token, true)` and
project-bound App Check `verifyToken(token,{consume:true})`; only the exact web
app ID and `alreadyConsumed === false` are accepted. One limited-use token is
consumed per batch. CORS permits only the production Pages origin and exposes
Retry-After. Authentication, attestation and caller validation apply to all rows.

The GCS generation-CAS budget is shared across instances/devices: 24 requests and
240 target checks per UID per 15 minutes, at most two in-flight caller requests,
four target read workers per request. Every submitted target is charged, including
unavailable identities. A legitimate initial 100-selection add uses two requests
and 100 work units. There are no refunds; release only removes a concurrency
lease. Leases last 60 seconds, longer than the 30-second platform timeout. The
handler stops scheduling work at 20 seconds. CAS retries are bounded to six.
Quota-store faults fail closed. The bucket has no browser access; see the
source-pinned approval manifest for permissions and retention.

## Identity and persistence boundary

The existing immutable reciprocal legacy bindings and retired-UID fences remain
authoritative. The resolver reads only `authIndex/<uid>/username`,
`users/<exact handle>/authUid`, and fence existence. Sequential reads rely on the
existing no-rebinding contract. Rules recheck both reciprocal tuples and both
fences when a Favorite is first created or a deleted generation is explicitly
re-added. A privileged repair must establish a fence before touching bindings.
An arbitrary administrator bypassing that contract is outside the guarantee.

The browser writes its own canonical Favorite plus derived capacity slots in one
ordinary-authenticated REST PATCH. REST is intentional: SDK `update()` emits
optimistic local events; treating those as canonical breaks the existing strict
version/substitution checks. The Firebase ID token uses Firebase's REST `auth`
parameter; App Check uses `X-Firebase-AppCheck`. URLs/tokens/errors are not logged.
No account parent read/write grant is introduced. Own-entity readback proves the
same operation ID before acknowledgement. Retries keep the operation ID, original
intent time and captured generation; a later removal cannot be resurrected.
Existing tags and values are preserved. Transport ambiguity remains pending.

`favoriteSlots/<owner>/s0..s99` is a derived admission index, not a preference store.
The first new addition indexes existing active Favorites in the same atomic
write. A slot referencing an active Favorite cannot be released unless a different
slot retains it or the canonical entity is deleted. Competing normal clients at
99 active Favorites cannot both obtain the last slot. Old clients can still edit
and remove Favorites; stale/duplicate slots are cleaned on the next addition.
RTDB Rules cannot count an arbitrary legacy collection. Therefore the hard slot
bound applies to indexed admissions; the normal client bootstrap includes all
legacy active records. It does not claim a retroactive security count over
preexisting unindexed records or malicious clients exploiting that legacy state.

## Recovery review

`previewPreservedFavorites([exactCandidateId, ...])` returns a session-bound,
read-only preview with an evidence SHA-256, complete candidates, original tag
links, canonical tags/Favorites, tombstones, pending operations and conflicts.
Completed reviews, deliberate deletions, missing tags and existing organization
require review; only a missing canonical Favorite with intact tags receives
proposed values. No writes, migrations or candidate-resolution calls occur.
Restoration requires a separate account-specific approval with candidate IDs,
evidence hash and resulting values. Re-read evidence immediately before any
approved reconciliation. Real affected-account evidence has not been inspected.

## Qualification

`npm ci --ignore-scripts --prefix functions/favorite-resolver`
and `npm --prefix functions/favorite-resolver test` run backend unit tests.
`firebase-tools@13.31.2 emulators:exec --only auth,database --project
 demo-pogo-saving-incident --config firebase.favorite-resolver.emulator.json
 'node scripts/check-favorite-resolver-emulators.cjs'` runs the integrated route
and real browser path. Set GCLOUD_PROJECT and the exact 9599/9500 emulator hosts.
App Check test tokens and quota storage in this harness are simulations, explicitly
excluded from the deployable package. They are not live attestation/GCS evidence.

Live resource changes, Rules installation, build, deployment and activation all
await approval of the exact manifest. The managed Functions build path does not
invoke the paused E.1 custom Pack/Docker helper. Its returned source archive,
build identity, build record and resulting immutable image must still be reviewed
before activation; a successful deploy response is not build-integrity proof.

## Locked dependency advisory review

The candidate lockfile pins Functions Framework 5.0.5. The package audit reports
11 moderate dependency entries propagating the single UUID advisory
GHSA-w5hq-g745-h8pq (v3/v5/v6 caller-supplied output buffer bounds). This endpoint
uses Node crypto.randomUUID for leases and SHA-256 for quota keys; no request
values reach UUID v3/v5/v6 or output buffers. The framework's CloudEvents helper
uses UUID v4 without a caller buffer. This is a recorded dependency limitation,
not evidence that advisories are absent. No force-upgrade across SDK major
versions was applied as an incident fix.
