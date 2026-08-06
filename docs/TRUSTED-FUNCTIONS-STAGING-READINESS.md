# Trusted Functions Staging Readiness

Status: **local design candidate; no staging or production resources exist**

This package reviews a future synthetic-only deployment of
`reserveTrainerHandle`, `claimTrainerTagLabel`, `mutateFavoriteTrainer`,
`verifyTrainerHistory`, and `setApprovedViewer`. It contains no Firebase adapter for staging setup, deploy
script, project alias, credential, client wiring, enabled gate, or live target.

## Isolation and configuration

Create a dedicated project with a placeholder-style name such as
`<ORG>-pogo-functions-staging-<RANDOM_SUFFIX>`. It must have separate Auth and
RTDB instances, synthetic users only, and no production export, Auth user,
service-account key, audit report, identity, or shared tenant. Do not add a
`.firebaserc` alias. Local operator configuration stays ignored; the tracked
`functions/.env.staging.example` contains placeholders only.

The candidate is Gen 2, Node 22, 256 MiB, 30 seconds, `minInstances: 0`, and
`maxInstances: 5`. Start staging concurrency at 10. The committed callable
candidate currently declares `us-east1`, but that is **not approved for
deployment**. Verify the staging RTDB location in Firebase Console under
Realtime Database before choosing a Functions region. For a US RTDB,
`us-central1` is recommended because RTDB's US location is `us-central1` and
these callables are transaction-heavy. Use `<REGION>` until that decision is
approved. Lower user latency does not justify cross-region database latency and
operational ambiguity at this scale.

## Identity and IAM separation

Use three identities:

| Identity | Candidate access | Explicit exclusions |
| --- | --- | --- |
| Runtime service account | `roles/firebasedatabase.admin`, `roles/firebaseappcheck.tokenVerifier`, `roles/logging.logWriter` | no deploy, IAM, rules, Auth-user administration, project ownership |
| Deployment identity | `roles/cloudfunctions.developer`, `roles/iam.serviceAccountUser` on the runtime account, `roles/serviceusage.serviceUsageConsumer` | no runtime use, no project Owner/Editor, no rules publishing unless separately approved |
| Rules operator | reviewed custom rules-release publisher role | no Functions deploy, runtime impersonation, database administration |
| Human reviewer | Functions, Logging, and Monitoring viewer | no mutation |

RTDB IAM is instance-level, not data-path-granular. The predefined
`roles/firebasedatabase.admin` is therefore broader than the five callable data
contracts. The compensating controls are mandatory: isolated staging project,
dedicated runtime identity, fixed adapters, strict schemas, disabled gates,
reviewed additive rules, App Check, mutation-root tests, redacted logs, and
separate deployment authority. Production must re-review this limitation; IAM
alone cannot prove path confinement.

The callable platform verifies Firebase Auth tokens and supplies `request.auth`;
the runtime does not list or mutate Auth users. App Check token consumption
requires `roles/firebaseappcheck.tokenVerifier`. Deployment permissions must be
validated with an IAM dry review before assignment; service-agent roles are not
granted to human or runtime identities.

### Exact data matrix

| Callable | Reads | Writes |
| --- | --- | --- |
| `reserveTrainerHandle` | share gate, caller account, normalized directory claim, exact idempotency record | caller account, normalized directory claim, exact idempotency record |
| `claimTrainerTagLabel` | preference gate, caller tag/label claims, exact idempotency record | caller tag/label claims, exact idempotency record |
| `mutateFavoriteTrainer` | preference gate, exact target account/directory claim, caller Favorite map, exact idempotency record | caller Favorite map, exact idempotency record |
| `verifyTrainerHistory` | preference gate, exact UID share, visibility mode, exact grant, protected-admin bit, caller history row, exact idempotency record | caller history row, exact idempotency record |
| `setApprovedViewer` | share gate, exact target account/directory claim, exact owner/viewer grant, exact idempotency record | exact owner/viewer grant, exact idempotency record |

`functions/staging/readinessContract.cjs` contains the complete path strings.
There is no arbitrary path input or generic Admin operation.

## Rules prerequisite and gates

Staging starts from the reviewed live narrow-read baseline SHA-256
`e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`
and the additive candidate SHA-256
`ba7322a59a4c3cf6b503dc52b1394313ac9421106a6c05fc6835200d49e3e72d`.
Before Functions deployment, verify those files locally, export the staging
rules rollback artifact privately, replace staging rules atomically with the
additive candidate, and keep both write gates false.

Staging infrastructure and callable deployability do not remove the preference
sync activation blocker. The local narrow Favorite callable enforces the real
100-active-record limit, but neither preference gate may be enabled before its
emulator evidence, deployment review, and synthetic canary are approved.

Verify anonymously and with synthetic Auth that root reads fail, legacy exact
reads still work, all new roots are non-enumerable, private preferences remain
private, and disabled roots remain denied. With Functions deployed but gates
false, each callable must return `operation/write_gate_disabled` before creating
an idempotency record.

Gate changes are staging operator actions against exact config booleans. No
callable can change its gate. The sequence is:

1. Additive rules, both gates false.
2. Functions deployment, both gates false.
3. Disabled-gate canaries for all five callables.
4. Enable share visibility; test handles and grants; disable it.
5. Enable preferences; test Favorites, tags, and history; disable it.
6. Review evidence before any simultaneous staging enablement.

Manual Console changes are acceptable for the first isolated staging canary if
the operator records before/after values and immediately restores false. A
future exact-path operator tool is preferable before repeated use. It must never
be part of a callable or browser Admin panel.

Rollback rules by setting both gates false first, then atomically restoring the
verified staging narrow-read baseline. Production rules are never touched.

## App Check rollout

Use reCAPTCHA Enterprise for the staging web/PWA app. Register a separate
staging web app and site key. Debug tokens are limited to named local test
devices, stored only in ignored local configuration, rotated after the test, and
never placed in source or chat.

1. Keep mutation gates false and observe callable verification logs.
2. Test a synthetic client with valid, missing, invalid, and consumed tokens.
3. Confirm browser and installed-PWA token refresh behavior.
4. Canary limited-use tokens because `consumeAppCheckToken: true` adds token
   verification latency and consumes one assessment per invocation.
5. Enable staging enforcement only after accepted/rejected metrics are healthy.

If valid staging clients are falsely rejected, keep gates false and disable
staging enforcement while investigating. App Check supplements Auth,
authorization, RTDB rules, fixed adapters, and rate limits; it replaces none of
them. No production browser wiring is included here.

## Synthetic fixtures and canaries

`functions/staging/syntheticFixtures.cjs` generates an in-memory deterministic
fixture containing two ordinary users, one protected admin, one Auth-only user,
public/approved/private shares, handle and tag collision states, valid and stale
history states, and one terminal replay. Names use `Synthetic...`, emails use
`example.invalid`, and timestamps and contents are fixed synthetic constants.

Generation returns data only; it cannot connect or write. A separately approved
staging fixture action must validate the target project, verify gates false,
write only the listed synthetic roots, reread expected counts, and retain a
destructive teardown allowlist. Teardown sets gates false, removes only those
roots and synthetic Auth users, and verifies the staging database is empty of
fixture IDs. There is no production seed command.

Each canary records expected result, changed roots, unchanged roots, one
redacted log event, idempotency status, and teardown result. Required cases:

- Handle: valid, replay, collision, malformed/confusable, replay mismatch, gate off.
- Tags: create, exact replay, duplicate, rename, rename collision, soft delete, cross-viewer denial, gate off.
- History: valid, count mismatch, oversized, stale, version conflict, replay, restricted source, gate off.
- Grants: grant, replay, self/cross-owner denial, revoke, immediate access denial, gate off.

Stop at unauthorized or unexpected writes, cross-user access, replay mutation,
partial state, unredacted logs, gate bypass, or teardown mismatch.

## Abuse prevention

The undeployed rate-limit design uses atomic exact counters at
`trustedRateLimits/{callerUid}/{operation}/{windowKey}`. It stores no IP address.
Validation and App Check occur before database-heavy work. Initial limits are:

| Operation | Short window | Daily |
| --- | ---: | ---: |
| Handle reservation | 2/hour | 3/day |
| Tag mutation | 20/10 minutes | 100/day |
| History verification | 30/10 minutes | 300/day |
| Grant/revoke | 10/10 minutes | 50/day |

Verified terminal replay uses a separate cheap replay allowance and does not
consume another full mutation quota. Counter failure fails closed for mutations;
an unavailable limiter never produces an unbounded retry loop. This is design
only: no rate-limit path, rule, or function is implemented in this milestone.

## Idempotency retention

RTDB provides no automatic arbitrary-node TTL suitable for this hierarchy.
Options reviewed:

- Manual staging teardown: simplest now; no idle cost, synthetic scope only.
- Lazy cleanup: low idle cost but cannot efficiently discover expired records
  without another index and makes user traffic perform maintenance.
- Full scheduled scan: simple but unbounded and rejected.
- Daily expiry buckets plus scheduled cleanup: bounded and production-suitable,
  but requires a separately reviewed index and fifth scheduled function.

Recommendation: manual teardown for staging. Before production, add a daily
expiry-bucket cleanup that processes at most 100 exact terminal records, rereads
status and expiry, never deletes pending records, logs aggregate counts only,
and can be disabled independently. No scheduler exists yet.

## Monitoring and alerts

Create staging charts by operation for invocations, success, validation denial,
authorization denial, App Check denial, replay, replay mismatch, conflict/stale,
internal/unavailable, p50/p95 latency, instances, cold starts, transaction
retries, log bytes, and estimated cost. Add a mutation-root audit comparing
observed root codes to the fixed allowlist; identifiers never enter labels.

Tiny-traffic alerts use counts rather than percentages:

- Immediate: any unexpected root, log-content scan failure, unauthorized write,
  cross-user read, replay mutation, or partial transaction.
- Five minutes: 3 internal/unavailable errors, 5 App Check denials after
  enforcement, more than 3 instances, or p95 above 2 seconds with 5+ calls.
- Daily: more than 100 staging calls, 1 MiB custom structured logs, or estimated
  spend above the staging budget trend.

Alert destinations are configured privately. Logs remain content-free and
identity-free; correlation hashes are not used as stable user identifiers.

## Cost model

The model is a workload estimate, not a guaranteed bill. Normal activity per
MAU is 0.05 handle, 2 tag, 2 Favorite, 8 history, and 0.5 grant calls monthly. High activity
is 0.1, 10, 15, 60, and 3. Each invocation is modeled at 180-350 ms, 256 MiB, two
log events, one App Check assessment, and 8 KiB egress.

| MAU | Scenario | Calls | vCPU-s | GiB-s | RTDB reads/writes | App Check | Egress MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | normal | 1,255 | 367 | 92 | 8,780 / 4,770 | 1,255 | 10 |
| 100 | high | 8,810 | 2,637 | 660 | 63,160 / 33,440 | 8,810 | 69 |
| 1,000 | normal | 12,550 | 3,663 | 916 | 87,800 / 47,700 | 12,550 | 99 |
| 1,000 | high | 88,100 | 26,365 | 6,592 | 631,600 / 334,400 | 88,100 | 689 |
| 10,000 | normal | 125,500 | 36,625 | 9,157 | 878,000 / 477,000 | 125,500 | 981 |
| 10,000 | high | 881,000 | 263,650 | 65,913 | 6,316,000 / 3,344,000 | 881,000 | 6,883 |

Normal operations assume two deployments/month; high activity assumes eight.
Allow 0.5 GiB Artifact Registry storage and apply an artifact cleanup policy.
No passive-load/login calls, polling, or scheduled cleanup are assumed.

A billing account can be required even when actual usage remains within
allowances. Invocation allowance does not imply free compute, RTDB, App Check,
build, artifact, logging, or egress. The first meaningful cost is likely
reCAPTCHA Enterprise assessments above its allowance, followed by RTDB traffic
or high-volume logging; repeated builds and retained images can create small
costs earlier. Budget alerts are not a hard cap. Create private alerts at 50%,
80%, and 100% of a separately approved small staging budget plus a daily anomaly
alert. The kill switch is both gates false, followed by stopping Functions.

Review cost and possible monetization support, without coupling authorization to
payment, when any of these occurs: 1,000 MAU, 100,000 monthly calls, 10,000 daily
App Check assessments, 1 GiB monthly logs, 5 GiB monthly egress, three instances
sustained, or 50% budget consumption. Pricing and paid features remain separate.

## Rollback and approvals

Rollback triggers include unauthorized or incorrect paths, cross-user access,
idempotency/replay mutation, partial state, log leakage, App Check rejection
spikes, unexpected instance growth, teardown failure, or cost anomaly. Actions:

1. Set both gates false.
2. Disable future client invocation paths if any exist.
3. Disable staging App Check enforcement if it is the incident source.
4. Stop/delete staging Functions.
5. Restore the verified staging narrow-read rules baseline if required.
6. Remove only synthetic fixtures and retain redacted diagnostics.

Separate approvals are required to create the project, choose region, create
runtime/deployment identities, assign IAM, register App Check, deploy additive
rules, deploy Functions, create fixtures, enable each gate, run each canary
group, add cleanup, and create billing alerts. Every production approval is
separate and remains out of scope.

## Placeholder command templates

These are review templates, not scripts. They must not run until every
placeholder is replaced from ignored staging configuration and the target is
confirmed twice:

```sh
firebase projects:list # manually confirm <STAGING_PROJECT_ID>
firebase deploy --only database --project <STAGING_PROJECT_ID> --config <STAGING_FIREBASE_CONFIG>
TRUSTED_FUNCTIONS_REGION=<REGION> \
TRUSTED_FUNCTIONS_RUNTIME_SERVICE_ACCOUNT=<RUNTIME_SERVICE_ACCOUNT> \
firebase deploy --only functions:reserveTrainerHandle,functions:claimTrainerTagLabel,functions:mutateFavoriteTrainer,functions:verifyTrainerHistory,functions:setApprovedViewer \
  --project <STAGING_PROJECT_ID> --config <STAGING_FIREBASE_CONFIG>
```

There is no default project, real project ID, credential reference, automatic
deployment, fixture write, or production command in this package.
