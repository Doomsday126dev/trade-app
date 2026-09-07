# PIN reset: bounded Admin diagnostics (.98)

This release changes only owner-Admin error presentation. It does not change
reset eligibility, deploy a backend, or repair production identity records.
The approved .97 My List presentation is unchanged.

## Generic Regression Classes

An established legacy account can have a ready versioned login directory while
its reciprocal index is absent. Reset must reject that synthetic test shape with
reset/identity-conflict before Firestore eligibility checks. A separate test
verifies that multiple Auth slots are rejected even with a reciprocal index.
Neither case gives the credential-reset endpoint authority to repair identity,
delete Auth users or remap ownership. The existing legacyOnly contract is not
loosened speculatively. Account-specific operational findings stay in the owner's
local report, outside public PR notes.

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

The remaining CI failure was trace-recorder pollution: the instrumented run
34137751945 measured a 396 ms task at 4862.9 ms, before the first interaction at
5642.2 ms. The fixture was already settled. A same-fixture, same-4x-CPU local
profile attributed 222 ms of sampled CPU to Playwright's `visitNode` DOM snapshot
traversal; that function was absent without tracing. The shared configuration's
`retain-on-failure` records snapshots during every run, not just after failure.
Only this isolated benchmark now turns tracing off. It retains failure screenshots,
timestamped long-task diagnostics, every product timing limit and every behavior
assertion. Real measured application long tasks remain subject to the 200 ms cap.

There is no live synthetic mutation in this frontend-only correction. Existing
production synthetic proof is historical, not claimed as a new live result.
An identity inconsistency must be reviewed outside the credential-reset endpoint.

Rollback is a normal Pages rollback to .97. The reset backend remains at its
previous qualified revision, with latest receipts and secret preserved. Never
restore a password, delete an Auth user, or rewrite ownership as UI rollback.
