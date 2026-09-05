# Final Same-UID PIN Reset Security Review

Reviewed input: `9209409c03429793291c2b164495072d92e80c89`.
Date: 2026-09-05. Branch: `feat/same-uid-pin-reset`.
Experimental context management reports enabled. The active model/Ultra effort
could not be independently verified or switched; this is not an attestation that
a separately selected Astra Ultra reviewer ran.

## A. Verdict

**SAME-UID PIN RESET BLOCKED -- CONCRETE SECURITY ISSUE**

Do not push, merge, deploy, grant runtime IAM, or enable the UI on the strength
of local test exit codes. The external identity-writer race remains reachable.
No production account was read for credential testing, reset, created or deleted.

## B. Findings

| Severity | Reachable path and evidence | Disposition / regression |
| --- | --- | --- |
| P1, open | `reset.js`: after the second `identity()` finishes, an independent privileged writer can remap the trainer or delete/recreate the same Auth UID before `updatePassword()`. The GCS lock is not consulted by that writer. The postcondition returns ambiguous only AFTER one mutation. | Two `LAUNCH BLOCKER` tests reproduce mapping and account-incarnation races. They assert the unsafe mutation occurred, not that isolation passed. Enforced coordination/exclusion across identity-changing writers is required; another read cannot eliminate the interval. No identity repair, provider, freeze or certification code was changed. |
| P1, fixed | Installed Firebase Functions SDK logs a malformed envelope containing a PIN before invoking the callable handler; tagged malformed decode values can also be logged. | `envelope.js` rejects unsupported envelope/value shapes without logging before SDK entry, preserves callable discovery descriptors, and leaves Auth/App Check enforcement intact. `sdk-boundaries.test.cjs` reproduces the unguarded leak and asserts guarded logs remain empty. |
| P2, fixed | `journal.js` accepted completed records without credential HMAC or valid completion metadata; a status request could report success from such a record. Missing GCS generation could also omit the intended precondition. | Exact record fields/types, UUID/UID/HMAC/timestamps, duplicate IDs/locks, and read-generation validation now fail closed. Malformed status and missing-generation tests pass. |
| P2, fixed | `reset.js` legacy alias search did not recognize NFKC-compatible names in the three identity roots. | Collision comparison now folds NFKC without changing the actual synthetic-email contract. Tests cover users, directory and index aliases. |
| P2, fixed | Admin dialog retained partly entered PINs on history/page navigation; an old completed receipt overstated current credential validity. | Clear/remove on tab navigation, popstate, hashchange and pagehide; disable autocomplete, release request references, and describe completion as historical. Desktop/mobile journey covers cleanup and receipt recovery. Browsers/password managers can ignore autocomplete; JS strings cannot be securely zeroized. |
| Qualification gap, open | Clean-device enrollment invokes existing `ensureMigration()` and creates a third device migration receipt where two existed before. Canonical entities and reviewed66 remain identical. | The strict unchanged-migration-evidence assertion remains an explicitly failing TODO subtest, not a pass. Reset and same-device restart do not add receipts. No account-sync implementation was changed or requalified. |

## C. Same-UID Contract And Mutation

Re-read `authEmail`, `authVersionForUser`, `signInWithAuthVersionScan`,
`ensureFirebaseIdentity`, `doLogin`, and the established-account reset guards.
The six ASCII digits are passed unchanged as Firebase's password. Username is
lowercased with non-alphanumeric characters replaced by underscores; version 1
has no suffix and later slots use `_vN`. Keep authVersion unchanged to address
the same account. The new service rejects ambiguous multi-slot inventories.

Changing only the existing Auth password is sufficient for healthy ready-directory
login. An old RTDB PIN/hash can remain stale; it is deliberately not rewritten.
A cached hash cannot unlock a bound account without Firebase credential success.
The normal login path may perform its existing lastSeen/hash-upgrade writes;
the reset endpoint does not. No full production browser login is claimed here.

The only runtime Auth account mutation is a single documented
[`projects.accounts.update`](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update)
POST using service-account OAuth, with exactly `localId` and `password`. No
email, provider, UID, claims, validSince, delete, create or generic update input
is sent. HTTP 200 with absent/different returned UID fails. No retry or redirect.
Admin SDK transport has retries, so replacing this single-send primitive was
not justified. SDK libraries contain general user-management APIs, but none
are reachable from this service's exported operation. Emulator setup alone
creates synthetic users and links its synthetic Google subject.

## D. Owner Authorization

Valid callable Firebase Auth and consumed App Check are required. The named
Admin app is pinned to `trade-list-a4297`; `verifyIdToken(..., true)` checks
signature/project and revocation. UID must match callable context, pinned owner,
reciprocal Doomsday126 records, users.isAdmin=true and server admins=true.
Ordinary users and non-owner admins do not satisfy the pinned UID.

Recent authentication uses integral `auth_time`, max 15 minutes with at most
30 seconds future skew, not `iat`. Refreshing an ID token does not restart this
window. Tests reject stale/malformed auth_time even with fresh iat. Installed
Admin SDK tests reject foreign audience/issuer, malformed subject and revocation;
installed callable middleware tests reject missing/invalid App Check. Consumed
App Check, server-admin removal and mismatched caller tests pass. Remote token
signature/App Check consumption services were not exercised live.

## E. Target Resolution

Server derives the target from fresh users/loginDirectory/authIndex evidence;
browser UID/fingerprint fields are equality constraints, not authority. Missing,
one-sided, conflicting, malformed, frozen, disabled, provider-only, duplicate and
incorrect-email/version evidence is rejected. Any named Firestore identity,
handle or conflict evidence excludes the target from this transitional endpoint.
Identity is rechecked after reservation and after mutation. This closes stale
inspect results, but NOT the P1 interval between final read and Auth update.

## F. Cross-Account Isolation

Username A with UID B, changed username/target/fingerprint, changed PIN replay,
extra update fields, case/NFKC collisions and pre-reset mapping changes reject
before mutation. Duplicate same-request and different-request same-target calls
permit one update through ledger CAS. External identity repair and same-UID
recreation do NOT meet the required pre-mutation rejection guarantee.

## G. Credential Handling

Exactly six ASCII digits, string only, no trimming or number conversion;
`001234` is preserved. No new PIN/hash is written to product stores. Durable
binding is a server-secret HMAC over owner/request/target/identity/PIN, not a
guessable standalone digest. The key and HMAC are absent from browser receipts.
No production PIN was placed in arguments/history/files or used in this audit.
Synthetic credentials exist only in test fixtures. Captured intentional failure
and malformed-envelope tests contain no plaintext credential in emitted logs or
structured responses. PIN inputs clear on submit/session loss/navigation;
pending sessionStorage contains only request identity. Runtime request references
are cleared when no longer needed, not a claim of cryptographic memory erasure.

## H. Receipts And Ambiguity

Private GCS generation CAS binds owner, request, target, identity and HMAC.
Completed exact replay is historical and never repeats the update; changed PIN
or target fails. Lost reservation acknowledgement never starts an update.
Lost Auth response stays ambiguous. Lost completion acknowledgement can recover
only from a durable completed record. Simulated process death after mutation
leaves pending locked after restart, with no expiry/takeover. Check result is a
bounded read, not a retry or proof of the current PIN. Missing/malformed ledger
fails closed. Actual GCS access controls, CAS and crash behavior remain live gates.

## I. Sessions

Use Firebase's normal password-change invalidation; do not add a second explicit
revocation operation. The old password fails immediately after confirmed update.
Existing refresh sessions can be invalidated for the UID, including Google-linked
sessions; there is no provider-specific revocation guarantee. Already-issued ID
tokens can persist until expiry unless checked for revocation. Fresh linked
Google authentication remains possible. See
[Firebase session semantics](https://firebase.google.com/docs/auth/admin/manage-sessions).
No immediate-everywhere logout or live-session revocation proof is claimed.

## J. IAM

Proposed runtime: `legacy-pin-reset-runtime@trade-list-a4297.iam.gserviceaccount.com`.
Read-only describe still returns NOT_FOUND. No new IAM bindings exist from this
task. The plan uses custom Auth get/update, RTDB instances.get (read-only),
Firestore entity get/list restricted to `phase-e-identity`, App Check token
verification/consumption, exact private GCS object access, and only the dedicated
reset HMAC secret. No default/provider runtime, product write, Auth create/delete,
token creator, provider secret or project Editor grant is proposed.

Residuals: Auth users.update is neither UID- nor password-field-scoped; RTDB
instances.get reads beyond the four selected roots; the GCS overwrite permission
set includes deletion authority on that object. This is not field-level IAM.
Secret generation, inherited grants, database/object conditions, act-as restricted
to this SA, denied product-write tests, private bucket settings and deployed
invocation policy all remain mandatory UNVERIFIED gates. Do not replace missing
permissions with broad roles. Public HTTP invocation is not permission to reset;
the callable still enforces owner Auth and App Check.

References: [Firebase permissions](https://firebase.google.com/docs/projects/iam/permissions),
[Firestore IAM](https://firebase.google.com/docs/firestore/security/iam),
[Storage permissions](https://docs.cloud.google.com/storage/docs/access-control/iam-permissions),
[App Check enforcement](https://firebase.google.com/docs/app-check/cloud-functions).

## K. Data Preservation

Local exact snapshots preserve UID, canonical entities, fixture LF/FT/unprioritized,
Board, Favorites/tags, profile, public ownership and provider links through reset.
The real sync-runtime harness retains all 66 recovery records, reviewed=66,
unresolved/active=0 after reset, new-PIN login, restart and clean-device adoption.
Reset and same-device restart preserve migration evidence. Clean-device adoption
adds one device receipt: strict migration equality fails. Product persistence is
the in-memory repository harness; the Auth credential transition uses the actual
Auth emulator. This is not a production database snapshot or physical Board test.

## L. Linked Google Legacy User

The emulator's signInWithIdp Google path succeeds before and after reset with
the identical UID and isNewUser not true. providerData remains equal. No relink
occurs during reset. This is stronger than merely comparing providerData, but it
is not live Google OAuth proof. Provider-only identities are rejected.

## M. Admin UI

One Playwright journey covers real Admin rendering/dialog and core logic with
synthetic transport, desktop and 390x844 mobile. Screenshots inspected: no
overflow. Owner-only gating, exact trainer/date, masked double-entry, mismatch,
in-flight disabling, no PIN persistence, lost-response Check result, session loss
and history/tab/page navigation cleanup pass. Production UI remains hard-off.

## N. Integration And Rollback

Local corrections only; no push, PR, merge, backend revision, secret/bucket or IAM
deployment. Deployment plan now explicitly says audit-blocked-not-deployed.
If later authorized and qualified, rollback disables invocation/UI and quiesces
in-flight work while retaining receipts; it never restores an old PIN, old journal
generation, UID or mapping. No rollout is authorized by this review result.

## O. Safe Synthetic Proof

No existing designated production test identity was established by available
local documentation. No ordinary account was selected and no identity created.
Because the security gate already fails, production account discovery/testing
was not expanded. Live old/new-PIN, same-UID, IAM and preservation proof NOT RUN.

## P. Production Boundary

Public release marker read back `2026-09-04.87`. PR63 remains OPEN/DRAFT at
`aa9f9a7cac8c86737b59b7afcf8c47787b3d19dc`; no operator work was run. Google
public rollout is unchanged, Discord was not enabled, and no provider identity,
freeze/certification, migration or product deployment was performed.

## Q. Friend Boundary And Test Accounting

Friend untouched. Owner is NOT cleared to use this new reset backend yet.
84 focused unit/contract checks complete; two intentionally reproduce the open
race and must not be interpreted as safety passes. One Auth-emulator journey
completes its credential/Google/recovery checks with one explicitly failing TODO
for strict clean-device migration equality. One desktop/mobile browser journey
passes. Syntax, whitespace and Firebase read registry checks pass. No unrelated
test matrices were run. Experimental context management was not changed/committed.

Required next boundary: an authorized design must enforce exclusion/coordination
of other identity-changing writers during credential mutation, and resolve the
strict clean-device evidence gate before renewed deployment qualification.
