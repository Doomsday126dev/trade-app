# Approved My List integration and release .102

Approved reference: `f718f9036109660bac39aa070f23bccb7cdbaef4`, preserved in branch history and local `approved/my-list-f718f90`. The owner approved all nine refinement screenshots before integration. No further design change or approval checkpoint is introduced.

Fresh repository and HTTPS served-manifest inspection confirmed main and production at `503c915cb0d36e6b87925cc1b9a73996b43f9a05`, release `2026-09-07.101`, run `34176003429`. No existing My List PR or deployment was found. Archive-proof PR #93 remains separate.

## Integration

Merge `65a6a8e` brings current main into the approved branch. The sole textual conflict was in `tests/domain-display-localization.test.cjs`: retain both the export display-name and product-declaration assertions, and retain main’s Acorn-delimited `buildStrings` assertion. Application and HTML merges were reviewed by function/section. Compared with the approved application, the only changed function is `ensureAccountSyncRuntime`, which is byte-identical to .101 main. Startup dependency bindings follow .100.

All six signed-in boot removals remain, including the independent anonymous implementation. The anonymous/offline route retains its own scripts. Session/runtime/generation checks after awaited snapshots, failures and runtime stop are retained. Identity, accountSync implementation, PIN-reset, retired-UID, provider, data and security files are unchanged from main. No historical records are changed. Same-species distinctions are preserved; the existing new-entry storage-slot limitation remains.

Retired background metadata no longer triggers a compact manual-check disclosure. No background selector, badge, export label or search qualifier is restored. The approved fixture contains no backgrounds and its presentation is unchanged by this restriction.

## Release controls

Next unused runtime ID checked remotely: `2026-09-07.102`. Release markers change only in index, clientRelease and service worker. Existing tags never move. Current selector `release-pages-control-cf4502bb47f1e7e7b177b3567a080059908663a4` pins control `5ab10694abf119fc88f442c24ebd61e8c20aa8a4`. Its frozen frontend inventory equals the integrated inventory; its trusted Firebase read checker passes (48 surfaces, 25 get, zero onValue). No repin is needed. The guarded expected-live SHA is the freshly served runtime, rechecked at dispatch/deploy.

## Qualification

Local integration-sensitive contracts: 215 passed, one existing skip (including boot boundaries and accountSync async race tests). Mandatory `check:pages-release`: 110 passed plus domain/community/global identity checks. Integration browser checks: 17 passed (priority workflow, refinement, and signed-in/anonymous/offline boot boundaries). Exact PR CI, screenshot comparison, deployment and postdeploy results will be recorded in the PR and final release report.

Approved evidence remains immutable in `refinement/after`; integration captures are separate. Frontend fixture checks are synthetic and do not establish real-backend two-account verification. No ordinary-user writes or credential resets are permitted for smoke testing. The .101 two-account live check remains pending absent authorized accounts.

Rollback target is immutable `release-2026-09-07.101` at `503c915cb0d36e6b87925cc1b9a73996b43f9a05`, compatible with the same control. Rollback must use the guarded path and exact current expected-live SHA; it has not been executed.
