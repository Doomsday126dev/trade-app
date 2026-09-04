# Provider Identity Operator Correction And Qualification

## A. Verdict

PROVIDER IDENTITY OPERATOR CORRECTED - MERGE BLOCKED

This is a substantial implementation increment, not qualification of the live
window. Both production CLI entry points retain `live_window_audit_blocked`
before reading approval, credentials, or production state. PR #63 must remain
draft and unmerged. No real approval was consumed or requested.

## B. R1-R4 Dispositions

| Blocker | Implementation and evidence | Remaining limitation |
| --- | --- | --- |
| R1 | Run-bound request, HMAC-sealed execution/restoration capabilities, stdin approval command, private-path and source/target/action/deadline checks, phase-specific normal authority, chained action ledger. Rejection tests cover target, manifest, plan, Rules, operator/runtime, edits, copied directory, stale capability and terminal reuse. | The supported production coordinator remains deliberately unwired and blocked; this is not a qualified production authorization path. |
| R2 | Fsynced append-only sealed events, immutable freeze/deadline intent, 25-minute normal budget plus 10-minute reserve, SIGINT/SIGTERM containment, SIGKILL takeover into restoration only, expiry in candidate Rules/client/server admission, sealed terminal closeout and interrupted-closeout completion. | A real production clock/inventory/admission adapter must be connected and exercised in the same pipeline as the concrete deployment executor. |
| R3 | New provider-specific command executor consumes a bound runtime contract, stages Git-object source, verifies six exports, inactive environment, secret version, build/image/readback, Rules and rollback. Historical Group E pins are unchanged. | Existing preparation CLI still produces a metadata-only plan without the complete runtime/rollback contract. Concrete long-running cloud operation recovery, exact rollback source ownership/generation, and complete command failure coverage are not qualified. |
| R4 | Executable Secret Manager commands, crypto-to-stdin key material, metadata-only version reconciliation, exact secret-level accessor, sealed infrastructure journal, pre-provider-use rollback checks, preservation on unexpected provider use/foreign IAM. | Real deployment/secret sequencing has not been proved in one production-equivalent persistent command pipeline. Foreign IAM/provider-use tests intentionally stop in a manual-restoration state, not a falsely sealed restored closeout. |

The concrete test `current metadata-only deployment plan cannot masquerade as an
executable rollback contract` reproduces the remaining R3 gap and rejects it
before any deployment. This is within the existing R3 finding, not an unrelated
scope expansion.

The command runner currently invokes synchronous gcloud commands. A process can
die after a cloud deployment is accepted but before its operation result is
recorded. Source staging and local intent are not sufficient evidence that the
remote operation has drained before rollback/terminal closeout. That lifecycle
must be implemented and tested before removing containment.

## C. Approval And Provenance

`providerIdentityRun.cjs` creates a privacy-safe request binding project,
Firestore database, RTDB URL, run ID, manifest/plan/Rules digests, operator commit
and tree, both runtime fingerprints, exact action sets, timestamps and lifecycle.
The request itself grants no authority.

The future stdin approval format is:

```text
APPROVE LIVE IDENTITY PREP WINDOW
RUN=<exact-run-id>
REQUEST=<exact-request-digest>
```

This is a format description, not a real approval request. Only synthetic
fixtures minted capabilities in this task. No production run/request digest was
generated and no real execution/restoration capability exists from this work.

The approval command accepts no phrase in argv or environment. Its output is
constant and does not echo submitted input. Artifacts are 0600 in canonical
0700 directories; symlinks/hardlinks are rejected. Capabilities bind the run
directory path, device and inode. The sealing key is a separate local integrity
key, not provider-subject HMAC material. This trusts the operator's OS account;
it does not claim protection against that account deliberately replacing an
entire directory and its local integrity key.

Code checkpoint: `3f098c2ce2c0b12865d8ffad17e1fa56c189ba52`.
Code checkpoint tree: `db04e14a311bbc706f0e0c6033b9da9051ed1a55`.
Authority fingerprint:
`cd9a2a55974ddc1774a79e09ce6844746ead86a7645d157b05a3f531c1964436`.
Gateway fingerprint, unchanged:
`9f9fd9e5b1fc79151f7aa2d28107d8a723ae17eaf5327795fba017cd21cce411`.

## D. Deadlines And Closeout

The coordinator takes time from its cloud adapter, persists activation intent
before touching either store, and never reconstructs deadlines from restart
time. Activation latency conservatively consumes the normal budget. Freeze v2
has `expiresAt = activatedAt + 2100000`; server admission rejects legacy
non-expiring freezes, malformed expiry, expired freezes and certificates that
outlive their freeze or 15-minute certificate TTL. Candidate RTDB Rules reopen
legacy provisioning at hard expiry even if cleanup never runs. No candidate
Rules or runtime was deployed.

Restoration capabilities remain usable after normal expiry. Interrupted runs
do not resume migration/hold creation. Exact certification invalidation precedes
two-store release. Terminal artifacts include capabilities, request, provenance,
coverage, Rules/revisions, IAM and freeze/certification evidence. A crash after
closeout sealing but before terminal ledger append completes locally with zero
cloud writes. Closed invocations perform zero mutations.

## E. Deployment Executors

`providerIdentityDeploymentExecutor.cjs` is separate from historical executors.
It requires the complete `runtimeContract`; hashes/revision labels alone do not
substitute for it. Git staging rejects modified files and wrong export sets.
Concrete command tests exercise authority build/deploy, wrong image, exact
Rules readback, all six function exports and repeated rollback.

The complete coordinator rehearsal still uses a simulated deployment facade.
The concrete command executor is tested separately. These two levels must not
be presented as the requested single fully qualified end-to-end command proof.
The real Rules transport, authoritative clock, namespace/admission checks,
cloud-operation drain/reconciliation and immutable rollback evidence remain
integration work. The coordinator's production CLI therefore stays blocked.

## F. Secret And IAM

The implementation generates 48 random bytes, encodes key material in memory,
pipes it directly to `gcloud secrets versions add ... --data-file=-`, and clears
the mutable buffers afterward. No provider key is written into arguments,
environment, repository, artifact, temporary file or command captures. Command
stdout/stderr are not forwarded to logs.

API enablement is conditional. Exact run labels establish newly created secret
ownership; foreign pre-existing configuration is rejected. Version-add response
loss reconciles exactly one enabled version 1 without sending another key.
`latest` is not used. The only secret accessor binding is
`serviceAccount:e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com`
with `roles/secretmanager.secretAccessor` at secret scope.

No temporary project role is granted by this implementation. The before-policy
is captured and compared at cleanup. Unexpected policy changes are not removed
as if the operator owned them. Rollback checks provider account/provider/reverse
claim usage before reverting infrastructure or deleting a newly created unused
secret. Unexpected provider use preserves the key and stops normal work.
Simulated API enablement remains enabled after failed-window secret cleanup;
the executor does not disable a project API as a side effect of deleting an
unused secret.

## G. Persistent Rehearsal

The synthetic inventory reproduces 68 records: 8 canonical accounts, 20 eligible
migrations, 30 holds and 10 unpaired reviews. Healthy execution creates 110
identity documents, verifies 58 protected handles, creates/invalidates the exact
certificate, releases both freezes and seals `CLOSED_HEALTHY`.

Coverage includes 50 normal failure boundaries, 13 actual SIGKILL/restart points,
SIGINT/SIGTERM, 9 restoration interruption points, normal deadline expiry,
closeout sealing interruption, and version-add pre-commit/lost-response cases.
Those coordinator scenarios close healthy or blocked/restored, with zero unsafe
sealed terminal states. Two deliberately adversarial infrastructure tests
(foreign IAM and newly observed provider use) stop without a terminal closeout.

Therefore **the universal requested full-pipeline qualification is NOT met**.
Do not report "all injected cases CLOSED_*" or a universal "unsafe states = 0"
for the entire production command matrix. The zero-unsafe-sealed-terminal result
is limited to the coordinator matrix actually exercised.

## H. Focused Tests

Local distinct test coverage totals 200 passing tests across these scoped sets:

- `npm run test:provider-identity-window`: 57.
- `node --test functions/test/provider-identity-orchestrator.test.cjs`: 106
  (94 core cases plus 12 additional deadline/restoration/terminal cases).
- `node --test functions/test/provider-identity-executors.test.cjs`: 11.
- `node --test tests/legacy-provisioning-freeze.test.cjs`: 6.
- `bash scripts/check-provider-identity-window-rules.sh`: 17.
- Local `firebase emulators:exec --only auth,firestore --project
  demo-pogo-e1-authority --config tests/firebase/firebase.e1-authority.json`
  running `node --test --test-concurrency=1 --test-name-pattern='provider creation
  atomically|namespace certification blocks|expired uncleaned freeze'
  functions/test/e1-firestore-authority-emulator.test.cjs`: 3.
- `node --check` for 16 changed JavaScript files and `git diff --check`: passed.

The small source changes in authentication readiness and the authority adapter
are necessary for freeze-expiry consistency. Only their directly affected
policy/admission tests were run. No whole Functions, account-sync, Pages, browser
performance, Playwright, My List, Events, sprite, Special Board, Group E or
Discord suite was run. The first Rules attempt lacked network access; its
authorized local-emulator retry passed. An initial direct Firestore test start
without its emulator was stopped and replaced with the scoped emulator command.

Focused PR CI includes the old 57 tests, all 117 new operator/executor tests,
the six client policy tests and patch hygiene. The performance workflow skips
this operator branch; manual performance dispatch and other PRs are unchanged.

## I. PR #63

Starting head: `177a4a83cd86e6e51d29218a4500cb250848e435`.
Implementation commit: `3f098c2ce2c0b12865d8ffad17e1fa56c189ba52`.
Documentation follows in a separate commit. PR remains draft/unmerged.
Main remains `794f8dbe08ee30a7de29ca73013b5ad77070ad44`.
There is no merge commit and no release.

## J. Preparation Artifacts

No fresh production preparation run was generated: its prerequisite is a
qualified merge, which did not occur. New manifest/plan/approval-request digests
are therefore not applicable, not silently inherited from the old run.

All 35 historical files under
`/Users/amityaagarwal/Documents/Codex/private/provider-identity-window/20260901T203950Z`
were rechecked against the prior hash/mode/link inventory: zero changes.
The separate metadata-only production check is stored privately at
`/private/tmp/provider-operator-check-20260904/production-readonly.json`.
It is a status report, not a preparation snapshot or execution authority.

Candidate combined Rules digest:
`84c277d05cf53843d3782fb2e2312bc1bbc92e6e5d5c71230e83d3269193a65c`.
New provisioning contract digest:
`77c4f3bb77e6d87d86bf80afb5dcde4151e764a784c7262fedfc19785d66733b`.

## K. Production Boundary

Read-only verification at `2026-09-04T21:29:37.168Z` found production
`2026-08-31.86`, 38 auth-index records, 58 users, 58 directory records, 8 accounts,
8 handles, 8 operation-request records, zero migrations and zero provider-only
accounts. Firestore freeze, RTDB freeze and certification were absent.
The authority remains `e1-identity-authority-00061-jbt`; the two existing gateways
remain `reade1accountfoundation-00057-tuw` and
`reservee1trainerhandle-00057-wuy`. Existing deployed gates remain false and
Group E disabled. New provider gates are absent in that older deployed revision,
not freshly deployed explicit false values.

Secret Manager API remains disabled. Secret existence cannot independently be
verified while that API is disabled; no API was enabled to inspect it. This task
performed no production freeze/data/backfill/hold/certification, secret/API/IAM,
Rules/backend/Pages, Auth/API-key/OAuth, provider account or canary mutation.
Google/Discord configuration was not changed or enabled. Public Google
visibility was not independently browser-retested in this operator-only task.

## L. Next Boundary

PREPARE OWNER FOR ONE MONITORED LIVE IDENTITY WINDOW

That boundary remains gated by R1-R4 integration qualification and a qualified
PR #63 merge. Do not start the window, mint a real execution capability, request
the approval phrase, or perform the whole-app design audit from this report.
