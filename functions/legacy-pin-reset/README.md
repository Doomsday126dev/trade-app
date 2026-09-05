# Owner-Assisted Same-UID PIN Reset

Status: **deployed and qualified in production `2026-09-05.88`; auth work closed**.
See [PRODUCTION_QUALIFICATION.md](PRODUCTION_QUALIFICATION.md) for completed live
synthetic proof and its limits. The separate non-owner probe was blocked by App
Check; it is not a passed live authorization test. The friend's account was not
reset during qualification. Owner Admin reset is enabled for eligible legacy users.
See [OWNERSHIP_BOUNDARY.md](OWNERSHIP_BOUNDARY.md) for the enforced exclusion
contract. Deployment must install the guarded Rules and remove the retired
SDK account's identity-write and impersonation privileges before enabling reset.
The clean-device contract permits one additive receipt, never canonical reseeding
or reactivation of the 66 reviewed recovery records.

The remainder records the original implementation and historical qualification;
the ownership boundary and final deployment record supersede its old launch gates.

Historically, before the rollout, production was `.87`, the friend's account
was unchanged, the new Admin action was disabled, and no backend revision
existed. The dedicated runtime service account was confirmed
absent by a read-only `gcloud iam service-accounts describe` on 2026-09-05.
Those pre-deployment observations are superseded by the qualification record;
they do not describe current production.

## Auth Contract

Legacy accounts use Firebase email/password authentication: a normalized trainer
name at `pogotrades.nyc`, with `_vN` for credential slots after version 1. The
six-digit PIN is the Firebase Auth password. `authVersion` selects the email
slot; it is not a password generation and MUST NOT increment during reset.

The historical Admin reset provisions another Auth UID and changes the mapping.
Its established-account guards remain unchanged. This endpoint never invokes it.

The only account mutation is the documented existing-user
[`projects.accounts.update`](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update)
request with `{localId: verifiedExistingUid, password: newPin}`. Native `fetch`
sends it once, without redirects/retries. The installed Admin SDK's HTTP client
retries network failures/503 responses, so its password-update wrapper is NOT
used. Missing users are not created. No credential is read back.

RTDB legacy PIN/hash fields are intentionally left untouched. Ready-directory
login accepts the new Firebase credential independently of the cached hash.
Even the cached-hash fallback requires Firebase credential authentication before
activating a session. Focused regression tests cover this boundary. No new
password hashing system or data-write permission is introduced.

The existing self-service PIN change already uses Firebase password replacement.
This endpoint adds no explicit `revokeRefreshTokens`, `validSince`, unlink, or
provider mutation. Firebase's normal password-change session invalidation still
applies to the affected UID, including its linked-provider sessions; it cannot
be restricted to one provider. Existing ID tokens can remain valid until expiry
unless a backend checks revocation. Do not promise immediate logout everywhere
or uninterrupted linked-provider sessions. See
[Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions).

## Single Callable

`ownerResetLegacyPin` accepts exactly one of:

- `inspect`: `action`, `username`; returns canonical name, target UID, creation
  timestamp and stable identity fingerprint. UI shows name/date, not UID.
- `reset`: `action`, `username`, `requestId` (UUIDv4), `targetUid`, `fingerprint`,
  `pin` (exactly six ASCII digits).
- `status`: the reset fields except `pin`; read-only receipt reconciliation.

Additional fields are rejected. Caller must have an unrevoked Firebase ID token,
fresh authentication (15 minutes), verified/unconsumed App Check token, the
deployment-pinned owner UID, and reciprocal `Doomsday126` ownership plus the
server `admins/{uid} === true` and `users/Doomsday126.isAdmin === true` records.
Ordinary admins are not admitted by this initial owner-only endpoint. Self-reset
is excluded; the owner's existing settings flow remains separate.

Target resolution proves exact `users`, `loginDirectory`, `authIndex`, positive
integer version, expected email, existing enabled Auth UID and password provider.
Duplicate mappings, normalized aliases, other Auth email versions, disabled or
frozen records, provider-only accounts, tenants and malformed evidence fail
closed. Inventory is bounded to 1,000 records/users, not silently truncated.
Username support is deliberately bounded to canonical ASCII legacy handles.
Any Firestore account, handle or conflict evidence is out of scope and blocks
reset, even when active: this transitional service cannot repair or migrate it.

Identity is reread immediately before the password request and after success.
Auth and RTDB/Firestore do not share a transaction. A deployment window MUST
enforce exclusion of concurrent privileged identity deletion/recreation, repair
or migration. An operator promise alone does not satisfy the final review.
A detected postcondition change produces an ambiguous result, never identity
rewrites or rollback to an old PIN. The endpoint's durable lock serializes its
own resets, not unrelated administrative systems.

## Receipt And Uncertainty

One private GCS object stores a bounded ledger of at most 1,000 requests. Its
generation-match CAS atomically reserves both request ID and target UID. It is
provisioned exactly once with `{"schemaVersion":1,"records":[]}`. Missing or
malformed storage is an error, NEVER permission to initialize an empty history.

The receipt binds owner, username, UID, identity fingerprint and a keyed HMAC of
the exact replacement request. Six-digit PINs must not be stored as plain hashes:
an unkeyed digest permits trivial offline enumeration. The dedicated secret is
at least 32 cryptographically random bytes, encoded for storage, and is never
shared with provider services. No plaintext PIN, ID token, SDK error, credential
hash, or request body is logged by the endpoint.

Completed exact replay returns its historical completion receipt without another
Auth update. Changed target/PIN replay is rejected. A later independent reset
can change the credential again; the earlier receipt is NOT a current-PIN probe.
Pending/ambiguous records lock their target indefinitely. No timeout, lease
takeover, cleanup job or retry loop can repeat an uncertain Auth mutation.
Failure before mutation may be recorded as aborted. A lost completion write
acknowledgement is reconciled by reading the same request.

The UI stores only request identity in owner/target-scoped sessionStorage before
dispatch, clears PIN inputs immediately, and offers Check result after a lost
response. If receipt persistence fails, no request is sent. A not-recorded status
is not permission for automatic resubmission: an earlier request might still be
in flight. Operator reconciliation is required for unresolved cases. There is
deliberately no repair/force-unlock endpoint in this task.

## Least-Privilege Plan

`deployment-plan.json` is a review artifact, not an IAM provisioning script.
Use a new dedicated runtime, never a provider-authority or default broad runtime.

| Resource | Runtime authority |
| --- | --- |
| Auth, exact project | Custom role: `firebaseauth.users.get`, `firebaseauth.users.update` |
| Product RTDB | `firebasedatabase.instances.get` only; read-only, no Rules/data writes |
| `phase-e-identity` database | Custom role: `datastore.entities.get/list`, database-restricted IAM condition; read-only |
| App Check, exact project | `roles/firebaseappcheck.tokenVerifier` for consumption |
| Dedicated GCS ledger object | Custom `storage.objects.get/create/delete`, bound on its private bucket with exact-object condition |
| Dedicated HMAC secret | `roles/secretmanager.secretAccessor` on this secret only |

No Auth create/delete, token signing/minting, claims operation, provider secret,
RTDB update, Firestore write, bucket IAM management, project Editor/Admin or
service-account token-creator role. Auth IAM cannot limit `users.update` to the
password property or a target UID; the fixed adapter and reviewed server-side
authorization enforce that remaining boundary. RTDB read permission is broader
than individual paths; only four identity/authorization roots are read and
nonidentity fields are stripped. Do not describe IAM as field-level security.

GCS overwrite requires create AND delete permission. Versioning protects evidence
from accidental overwrite, but runtime write compromise is still within this
trust boundary. No object deletion/recreation, journal rollback, old-generation
restore, lifecycle deletion or secret rotation while receipts remain actionable.
Generation-pinned reads and no SDK write retries are mandatory. Keep requests
and private audit evidence inaccessible to browser users.

Sources: [Firebase permissions](https://firebase.google.com/docs/projects/iam/permissions),
[Firestore IAM](https://firebase.google.com/docs/firestore/security/iam),
[App Check enforcement](https://firebase.google.com/docs/app-check/cloud-functions),
[GCS permissions](https://docs.cloud.google.com/storage/docs/access-control/iam-permissions),
[generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions).

## Historical Deployment Gates And Current Rollback

1. Complete one independent Astra Ultra audit limited to authorization, same UID,
   least-privilege IAM, cross-account isolation, idempotency and preservation.
2. Designate an existing safe synthetic production trainer, never the friend.
   No random production Auth creation is authorized. Pin verified owner UID
   privately; do not take the caller's claimed username as authority.
3. Provision only the dedicated SA, custom scoped roles, private versioned bucket
   and HMAC secret after reviewing effective inherited permissions. Validate the
   exact Firestore/bucket IAM conditions and denied product writes. If any needed
   permission is unresolved, STOP; do not substitute broad roles.
4. Deploy only `functions:legacy-pin-reset` with
   `firebase.legacy-pin-reset.json`, `--project trade-list-a4297`, and
   `LEGACY_PIN_RESET_ENABLED=false`. No provider codebase is selected. Inspect
   deployed runtime identity, configuration, secret version, endpoint, App Check,
   logs/redaction, CAS behavior, and rollback before enabling it for safe proof.
5. During the bounded proof, exclude other privileged identity operations. Use
   only the designated synthetic identity to verify old/new PIN login, same UID,
   links and protected before/after data, including reviewed recovery evidence.
   Reconcile the exact receipt; do not retry an ambiguous reset. Capture backend
   revision and immutable source SHA. None of these live gates has been claimed
   as completed by source/emulator tests.
6. Only after those gates pass, enable the owner-only UI in a separate reviewed
   Pages release with a new release ID/cache version. Do not change `.87`'s tag
   or publish edited files under its existing asset URLs.

Rollback: set backend enablement false (or remove invocation access), keep the
UI gate false, and revoke only this runtime's Auth update permission if needed.
Quiesce in-flight requests; retain the latest journal/secret and all receipts.
Disabling a service cannot undo an already dispatched password update. Never
restore an old PIN, remap ownership, restore old ledger content or delete Auth.
Rollback does not require a provider change or product-data migration.

For current `.88`, use a bounded reset-function configuration deployment to set
`LEGACY_PIN_RESET_ENABLED=false`, preserving its owner/boundary settings, runtime
identity and exact secret. Verify the deployed revision rejects new requests,
then wait for in-flight requests to finish and reconcile pending/ambiguous journal
entries before any break-glass ownership operation. Do not replay an ambiguous
password mutation. A frontend-only Pages rollback is not a backend disable.
Use [the guarded Pages rollback](../../docs/PAGES-DEPLOYMENT.md) if reverting the
UI; do not restore mutable ownership Rules or retired SDK privileges while reset
is enabled. No rollback or disable is executed by the design-study closeout.

## Focused Qualification

```sh
npm --prefix functions/legacy-pin-reset ci --ignore-scripts
node --test functions/legacy-pin-reset/test/*.test.cjs tests/admin-reset-safety.test.cjs tests/legacy-pin-reset-login.test.cjs tests/session-transient-state.test.cjs
firebase emulators:exec --project demo-legacy-pin-reset --config firebase.legacy-pin-reset.emulator.json --only auth "node --test --test-name-pattern='same-UID PIN reset preserves' tests/account-sync-runtime.test.cjs"
npx playwright test tests/legacy-pin-reset.spec.js --project desktop --workers 1
node scripts/check-firebase-reads.js
```

The Auth emulator uses the real single-send credential adapter. Its focused
runtime test establishes 66 reviewed records, resets the same UID, rejects old
PIN, accepts new PIN and reopens the real sync runtime without migration or
recovery activation. Canonical storage is the existing in-memory repository
harness; GCS CAS and the browser callable transport use deterministic doubles.
This is not live IAM, deployed App Check, real GCS or production-data proof.
The browser journey uses the real Admin renderer/dialog and backend core, with
all production Firebase traffic blocked; it covers desktop and mobile sizing.
The unchanged legacy reset remains blocked. No PR63, Group E, broad provider,
full historical sync, all-browser, full Functions or performance suite is run.

Accepted local results (2026-09-05): 60 focused unit/contract tests, one real
Auth-emulator plus recovery-runtime journey, and one targeted browser journey.
Desktop/mobile screenshots were inspected. The browser journey also proves that
owner-session loss removes the dialog and clears partly entered PINs. Syntax,
diff whitespace and the existing Firebase read registry remain clean (48
surfaces, 25 direct get sites, zero unregistered onValue sites).

## Simplification And Retirement

No self-service recovery, email delivery, PIN generator, new password hash,
scheduled reconciliation, account repair, migration, provider mutation or
product-data writer. One codebase, callable and bounded receipt object exist
only because an irreversible password update needs durable non-replay evidence.
The existing generic trusted adapter would require product write authority and
cannot provide this boundary, so it is not reused. No new Firestore database.

Remove the Admin action and dedicated runtime after every remaining legacy user
has a verified replacement sign-in/recovery method and PIN sign-in is retired.
Preserve required receipts until reconciliation and retention obligations end;
then remove only the dedicated IAM grants, secret and journal resources.
