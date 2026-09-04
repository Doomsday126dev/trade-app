# Provider Identity Pipeline Integration

## A. Verdict

PROVIDER IDENTITY PIPELINE CORRECTED - MERGE BLOCKED

This is an integration correction on draft PR #63, not launch qualification.
Both production CLIs retain `live_window_audit_blocked` before approval,
credentials or production state. No real approval was consumed.

## B. Integrated Preparation Contract

`prepare-provider-identity-bundle.cjs` produces a create-only, sealed
`preparation.json` in a private run directory. It carries the existing plan,
not a second deployment-plan format, plus its approval-request and manifest
digests. The request binds the plan; the outer bundle adds the request digest
afterwards to avoid circular hashing.

The single plan includes target identifiers, source main/operator commits and
trees, authority/gateway fingerprints and file hashes, six exports, candidate
and rollback Rules, provisioning contract, version-1 secret reference, runtime
service accounts, before/after authority configuration, invocation IAM, gateway
rollback map, Rules release and project IAM evidence. The loader checks the
reviewed Git versions of the candidate Rules and provisioning contract as well
as the runtime source files. Bundle/request substitution fails before commands.

The bundle is consumed directly by the production-side composition module.
The production runtime collector does not yet automatically assemble all
required reviewed runtime/rollback input. The legacy metadata-only plan alone
is not accepted by the new coordinator dry-run.

## C. Concrete Executor Integration

`providerIdentityPipeline.cjs` constructs `Infrastructure`,
`SecretCommands` and `ProviderDeploymentExecutor` itself. Tests cannot replace
their deployment methods. The new persistent fixture injects only the command
transport, Rules transport and data boundary.

The complete run executes API enablement, secret creation, version addition
through stdin, exact secret IAM, candidate Rules, authority build/deploy, six
gateway deployments, verification, rollback and cleanup through those concrete
classes. Command captures retain arguments and stdin length, never key bytes.
Version-add response loss does not submit another key.

Existing isolated executor tests remain separate evidence; they are no longer
the only evidence connecting the concrete executor to the coordinator.

## D. Long-Running Recovery

**Not qualified.** The concrete gcloud runner is still synchronous with a
180-second timeout. It does not persist cloud operation IDs before waiting or
query/drain all pending remote mutations after a process dies. The injected
`operationsDrained` boundary is checked before freeze and before closeout, but
there is not yet a production implementation that supplies this proof.

A pending-operation regression explicitly prevents terminal closeout. This is
a passing containment test, NOT a successful recovery case. It leaves an
unfinished restoration-only ledger. We cannot claim all injected cases reached
one of the requested terminal states.

Five actual separate-process SIGKILL tests after completed concrete command
boundaries resume restoration without redeploying. These do not substitute for
a SIGKILL while a real-model asynchronous operation is pending.

## E. Rules, Freeze, Inventory and Admission

The integrated local Auth/RTDB/Firestore emulator test passes one continuous
coordinator run using the production REST identity adapter, production
inventory readers, real candidate Rules and Firestore read-time clock evidence.
Only transport URLs/resource names are mapped to a demo project on loopback;
non-loopback requests are rejected before network dispatch.

Verified sequence:

1. Install candidate Rules while freeze is absent; legacy provisioning succeeds.
2. Activate both stores with the same immutable 35-minute hard expiry.
3. Deny new legacy activation while existing login reads and same-identity
   profile updates succeed.
4. Read the post-freeze inventory through production readers.
5. Verify eight canonical identities, migrate twenty and protect thirty holds;
   verify 58/58 handles and persist completion.
6. Create the exact certification. The real Firestore authority adapter accepts
   its evidence inside an emulator transaction deliberately aborted at the
   first attempted create; the production inventory is unchanged by the probe.
   All creation/invocation gates in the simulated deployment stay false.
7. Invalidate certification, release freeze, prove provisioning works again,
   and seal a healthy closeout.

This found and fixed a real wire-format mismatch: RTDB removes null children,
while Firestore retains `releasedAt: null`. The REST adapter now canonicalizes
only an omitted active-freeze `releasedAt` field. Other identity, timestamp,
digest and freeze fields retain exact comparison.

The real production Rules release transport and complete CLI boundary wiring
remain unqualified. The emulator proof is not authorization to deploy.

## F. Rollback Ownership

Rules, authority and gateway ownership receipts are create-only and sealed,
bound to run and plan. Rollback compares current state to exact prior or
recorded run-installed state and rejects foreign replacements. Changed
authority state is preserved for manual review. Missing receipts after
ambiguous command success are not invented from desired final shape.

Secret creation/version metadata is preserved in the sealed infrastructure
journal. Cleanup rejects a changed resource, foreign version or foreign IAM.
Provider use preserves the compatibility key. No temporary project role is
granted, and foreign project policy is never removed as if run-owned.

**Remaining limitation:** the new full-pipeline fixture models all six
gateways as initially absent. It verifies creation and owned deletion, not
source-generation-pinned restoration of the two pre-existing production
gateways. Their existing `gs://` rollback source path is not yet made immutable
and independently verified by the executor. This remains the previously
identified rollback-source qualification gap.

## G. Persistent Failure Rehearsal

The new 45-test command-pipeline file contains 38 injected scenarios:

- 20 normal infrastructure/freeze/migration/hold/certification boundaries.
- Five separate-process SIGKILL/restarts.
- Five restoration interruptions followed by restart.
- Four committed-response-loss cases.
- Three foreign-infrastructure/provider-use cases.
- One unresolved pending-operation case.

Counting completed command-pipeline runs, including the ordinary happy path:

- `CLOSED_HEALTHY`: 2 (ordinary success and reconciled version response loss).
- `CLOSED_BLOCKED_RESTORED`: 31.
- `CLOSED_BLOCKED_MANUAL_INFRA_REVIEW`: 5.
- Unclosed pending-operation case: 1.

The emulator sequence adds one healthy closeout. Bundle tampering is a separate
pre-execution rejection, not a completed run.

Unsafe **sealed terminal** states observed: zero. Universal safe termination is
**not proven** because the pending-operation case cannot close. Do not summarize
this as an all-safe production-equivalent failure matrix.

Manual closeout requires certification absence, inactive freeze, restored
provisioning, disabled provider gates, drained operations and no temporary
run-owned privilege. It records exact component/error codes, preserves
committed identities, foreign IAM and any provider-used key, and invalidates
both run capabilities through terminal closure.

## H. Focused Tests

Passing local commands:

- `npm run test:provider-identity-window`: 57 tests.
- `node --test functions/test/provider-identity-orchestrator.test.cjs
  functions/test/provider-identity-executors.test.cjs`: 117 tests in the local
  run before two additional classification checkpoints; focused CI rechecks
  the committed checkpoint additions.
- `node --test functions/test/provider-identity-pipeline.test.cjs`: 45 tests.
- `node --test tests/legacy-provisioning-freeze.test.cjs`: 6 tests.
- `node --check`: 14 changed JavaScript files; `git diff --check`: passed.

Integrated emulator command (one passing test):

```sh
npx --yes --package firebase-tools@15.24.0 firebase emulators:exec \
  --only auth,database,firestore --project demo-pogo-provider-pipeline \
  --config tests/firebase/firebase.provider-pipeline.json \
  'node --test functions/test/provider-identity-pipeline-emulator.test.cjs'
```

Local execution used OpenJDK 21 and the existing Firebase emulator cache.
The first fixture checkout was stopped because it unnecessarily copied sprites;
the harness now uses a sparse checkout. Initial emulator attempts exposed the
missing HTTP clock header and RTDB null serialization; the corrected run passed.
The safety review initially rejected a production-shaped test URL. Inspection
proved the existing loopback-only rewrite/rejection guard, and the exact
emulator rerun was approved. No production network request escaped that test.

No account-sync, Pages, browser performance, broad UI, Events, sprites, Special
Board, Group E, Discord or complete Functions suite was run. The PR workflow
runs only operator/executor/pipeline/client-policy tests and patch hygiene.

## I. PR #63

Starting head: `984809aac772d233c617874a528bf2aa260b3e0e`.
Implementation: `ec61d44bb5d3f900473639e71a6d12557b02555f`.
Implementation tree: `bf973001c2b16db09b6925b844dead10b520d53b`.
This report is a separate documentation commit.

Keep draft/unmerged. Main remains
`794f8dbe08ee30a7de29ca73013b5ad77070ad44`. No release is created.
Pending-operation recovery, existing-gateway immutable rollback source and
complete production preparation/transport wiring still block qualification.

## J. Fresh Preparation Set

No post-merge preparation set was generated because no qualified merge occurred.
New production manifest, bundle and approval-request digests are not applicable.
Synthetic test bundles/capabilities are not real owner approval artifacts.

All 35 historical files were verified unchanged against their recorded hashes,
permissions, link counts and symlink status. A separate status-only read is at
`/private/tmp/provider-pipeline-check-20260904/production-readonly.json`;
this is not an execution preparation set.

## K. Production Boundary

Read-only verification at `2026-09-04T22:17:43.897Z`:

- Release `2026-08-31.86`.
- 58 users/directory entries, eight canonical accounts/handles, zero migrations
  and zero provider-only accounts.
- Both freezes absent; certification absent.
- Authority `e1-identity-authority-00061-jbt`; original two gateway revisions
  unchanged; existing deployed gates false and Group E disabled. New provider
  gates are absent in the old runtime, not newly deployed false settings.
- Secret Manager API disabled; secret existence not independently observable
  while the API is disabled.

No production writes, secret/API/IAM changes, Rules/backend/Pages deployment,
freeze/certification mutation, provider creation or canary occurred. Auth,
Google, Discord and the 66 recovery records were not changed.

## L. Next Boundary

ONE MONITORED LIVE IDENTITY PREPARATION WINDOW

Still gated by the concrete limitations above. Do not begin it, consume or
request owner approval, create real capabilities, or start a design review.
