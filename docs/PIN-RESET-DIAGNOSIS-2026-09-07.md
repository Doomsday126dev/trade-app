# PIN reset: bounded Admin diagnostics (.98)

This release changes only owner-Admin error presentation. It does not change
reset eligibility, deploy a backend, or repair production identity records.
The approved .97 My List presentation is unchanged.

## Read-only finding

The reported established legacy account has a ready v3 login directory and an
enabled, matching v3 Firebase Auth password account, but the current UID has no
reciprocal authIndex document. The exact deployed reset contract rejects this
at its first target reciprocity gate with reset/identity-conflict, before its
Firestore legacyOnly check. Target identifiers and credentials are not published.

A separate enabled v2 password account exists in the same legacy login namespace
on another UID. The duplicate-slot check would also reject the target even if the
missing reciprocal index were supplied. This service is not authorized to decide
ownership, add that index, delete the older Auth account, or remap either UID.

The current target's Firestore account, normalized handle and conflict-event
documents are absent, so legacyOnly returns true. Its restrictive transitional
contract is not the cause of this report and is not loosened speculatively.

The deployed reset revision's six security/adapter source modules exactly match
reviewed source. Enablement, pinned owner, runtime account and immutable-bindings
configuration match; current RTDB Rules exactly match the qualified guard. Owner
server admin evidence, reciprocal index and existing enabled Auth user agree.
The recorded production attempt has VALID Auth and App Check verification.

No historical owner ID token was captured. Its request-specific auth_time and
explicit revocation result cannot be recovered from those sanitized logs. Their
enforcement is verified in deployed source and focused SDK/core regressions, not
misrepresented as a fresh authenticated live probe. The response body was not
logged; reset/identity-conflict is reproduced from the proven failing contract.
Targeted RTDB collision queries require unavailable indexes; no index/schema
change or broad user dump was made. Shallow target-name collision checks passed.

## Presentation

The owner-only dialog now distinguishes bounded identity, legacy eligibility,
owner authorization and service errors. A collapsed Owner diagnostics section
retains only an explicitly allowlisted code. Unknown SDK messages and arbitrary
identifiers are never echoed. Inspect failures keep both PIN fields and submit
disabled. Receipt-status failures retain the warning against another reset.

An identity failure no longer suggests repeated owner sign-in. Ordinary users
still cannot open this owner-only dialog. No authorization, receipt, HMAC,
single-send password, same-UID, replay or ownership-fencing code changed.

## Qualification and release

- 73 focused core/adapter/callable/login/Admin tests pass, including the v3
  missing-index failure before Firestore reads, independent duplicate-slot
  rejection, and successful inspect for a consistent existing v3 identity.
- Five installed-SDK boundary tests pass with the unchanged pinned dependencies.
- Two focused browser journeys pass, including desktop/mobile error layout,
  safe-code display, masked credentials, session cleanup and replay handling.
- The single existing Auth-emulator/reset/recovery journey passes, including
  its additive-receipt subtest: same UID, old PIN rejection, new PIN success,
  unchanged provider links/canonical data and reviewed66 state.
- Required affected-source CI and normal immutable Pages release checks must
  pass before merge/deployment. No backend or Rules deployment is selected.

The required My List interaction benchmark exposed delayed fixture work in its
measurement window. Timestamped profiling showed a 239 ms setup task ending
before measurement but arriving in the cleared observer buffer afterward.
The test now settles fixture rendering/painting and filters entries by the
measurement start. All existing duration/behavior limits remain unchanged;
the six local performance cases pass. No My List runtime change accompanies it.

There is no live synthetic mutation in this frontend-only correction. Existing
production synthetic proof is historical, not claimed as a new live result.
The reported trainer is not reset and remains blocked for an explicit identity
review outside this credential-reset endpoint.

Rollback is a normal Pages rollback to .97. The reset backend remains at its
previous qualified revision, with latest receipts and secret preserved. Never
restore a password, delete an Auth user, or rewrite ownership as UI rollback.
