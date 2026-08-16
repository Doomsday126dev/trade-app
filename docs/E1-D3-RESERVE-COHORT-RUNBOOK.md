# E.1 Group D3 reserve cohort runbook

## Status and boundary

Group D3 is the final pre-Group-E reserve cohort validation. It covers exactly five additional eligible legacy accounts. Each account performs one `reserveTrainerHandle` call followed immediately by one exact replay of the same request. D3 does not authorize repair, migration, freeze, provider linking, client-foundation activation, SEC-02 work, or Group E.

The tracked contract is intentionally unbound and unauthorized. This document does not select subjects or authorize production execution.

## Immutable precondition

D3 requires the accepted D2 state exactly:

- total documents: 12
- `accounts`: 3
- `trainerHandles`: 3
- `rateLimits`: 3
- `operationRequests`: 3
- `identityMigrations`: 0
- `identityConflicts`: 0
- canonical digest: `2923aafa890de58cb04fb5941528f7a425c22d0a131dd9fc0fcf71013468bf0b`

An approximate, superset, or recomputed substitute baseline is not accepted.

## Operator-supplied candidate pool

D3 never enumerates, discovers, ranks, or selects production accounts. A human operator must privately supply exactly five intended subjects before D3 tooling runs. If the operator cannot identify five candidates confidently, D3 subject preparation is blocked; any future privacy-safe discovery project requires separate design and approval.

The private path is `functions/.local/e1-production-third-mutation-candidate-pool.json`. It must be Git-ignored, mode `0600`, and contain exactly:

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "projectId": "trade-list-a4297",
  "cohortStage": "D3",
  "acquisitionMode": "operator-supplied-exact-five",
  "candidateCount": 5,
  "humanSupplied": true,
  "suppliedAt": "<ISO-8601 timestamp>",
  "candidates": [
    { "firebaseUid": "<private UID>", "trainerUsername": "<private trainer>" }
  ],
  "candidatePoolDigest": "<domain-separated SHA-256>",
  "executionAuthorized": false,
  "laterGroupsAuthorized": false,
  "groupEAuthorized": false
}
```

The `candidates` array must contain exactly five entries. Passwords, PINs, tokens, email/profile data, request records, and unrelated application data are forbidden by the exact schema. No real candidate-pool file is tracked.

Validate only the local schema and canonical digest with:

```sh
E1_PRODUCTION_THIRD_MUTATION_CANDIDATE_POOL=functions/.local/e1-production-third-mutation-candidate-pool.json \
node functions/scripts/check-e1-production-third-mutation-target.cjs --mode=candidate-pool
```

Pool validation canonicalizes harmless trainer-name normalization, rejects duplicate raw or normalized identities, and orders all five by the existing privacy-safe subject fingerprint. Presence or validation of the pool does not bind subjects, authorize D3, or authorize Group E.

## Exact-five eligibility and binding

1. Evaluate only the five operator-supplied subjects using exact RTDB leaves and exact Firestore document paths. Production-wide enumeration and fallback substitution are prohibited.
2. Require reciprocal `authIndex/{uid}/username` and `users/{trainer}/authUid` ownership, a usable `loginDirectory/{trainer}` entry, no identity ambiguity, no migration/conflict evidence, and absence of the planned account, handle, operation request, and rate-limit documents.
3. Exclude every D1/D2 member, already reserved identity, conflicting owner, ambiguous handle, and admin/system-only identity.
4. If any one candidate fails, mark the entire pool not ready and stop. Do not choose a sixth subject.
5. Store raw UID/trainer evidence only in ignored `functions/.local/**` files with mode `0600`.
6. Create `e1-production-third-mutation-subjects.json` from the same canonical five, with slots (`A` through `E`), the candidate-pool digest, and its distinct domain-separated binding digest.
7. Human-review the five-member binding. Candidate pool, subject binding, readiness, and execution authorization remain separate lifecycle stages.

The tracked manifest remains `subjectsBound=false` and `executionAuthorized=false`; private reviewed evidence supplies those later states to the guard without committing identities.

## Read-only readiness

Create private mode-`0600` files:

- `functions/.local/e1-production-third-mutation-candidate-pool.json`
- `functions/.local/e1-production-third-mutation-subjects.json`
- `functions/.local/e1-production-third-mutation-activation.json`
- `functions/.local/e1-production-third-mutation-guard-input.json`

The input must prove the exact D2 baseline, all gates disabled, the reviewed authority revision/image and identities, private authority/IAM boundaries, App Check token-verifier boundary, the exact budget, no preflight writes, and `groupEAuthorized=false`.

Run only the read-only local checker:

```sh
E1_PRODUCTION_THIRD_MUTATION_CANDIDATE_POOL=functions/.local/e1-production-third-mutation-candidate-pool.json \
E1_PRODUCTION_THIRD_MUTATION_SUBJECTS=functions/.local/e1-production-third-mutation-subjects.json \
E1_PRODUCTION_THIRD_MUTATION_READINESS=functions/.local/e1-production-third-mutation-activation.json \
E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT=functions/.local/e1-production-third-mutation-guard-input.json \
node functions/scripts/check-e1-production-third-mutation-target.cjs
```

The guard must report `ok=true`, `cohortStage=D3`, `candidateCount=5`, `subjectsBound=true`, `executionAuthorized=true`, and `groupEAuthorized=false`. A passing readiness check is not itself execution approval.

### Readiness timing model

D3 uses `pre-enable-jit-v1`. Candidate eligibility and the reviewed five-subject binding establish who may enter the cohort, but they do not authorize execution. The private activation and guard-input artifacts bind the authorization to the exact reviewed source SHA. Any source change makes those two artifacts stale and requires regeneration; the candidate-pool and subject-binding digests remain reusable because they do not include source or timing authorization.

The 15-minute Auth and targeted-state evidence age is an entry precondition checked when the canonical helper prepares `enable-group-d3`. It is not a lease that must remain unexpired for every later reserve, replay, or verification step. A successful enable records that all entry evidence was fresh at admission. After enablement, the approved mutation window, capped at two hours, governs the strictly sequential operation. Each live request must still pass Firebase token verification, App Check, reciprocal legacy ownership, transaction, idempotency, count, digest, and stop checks.

Therefore the full five-subject run does not need to finish inside the 15-minute evidence age. It must start with fresh evidence and finish before the mutation-window end. Evidence that expires before enablement fails closed. The exact expiry boundary is accepted at enablement; one millisecond after it is not. Mutation-window expiry stops the next operation. Containment restoration remains available independently after either readiness or mutation-window expiry.

## Separate production authorization

A human approval must name the immutable binding digest, bounded window, operator, teardown owner, exact allowed operations, source SHA, authority revision/image, and the exact confirmations:

- enable: `ENABLE E1 GROUP D3 RESERVE COHORT`
- restore: `RESTORE E1 GROUP D3 GATES`

Only the canonical helper may prepare gateway deployment plans:

```sh
node functions/scripts/deploy-e1-production-gateway.cjs \
  --mode=plan \
  --action=enable-group-d3 \
  --source=functions/e1-gateway \
  --expected-sha=<reviewed-sha> \
  --confirmation='ENABLE E1 GROUP D3 RESERVE COHORT'
```

Deployment is a later, separately approved operation. Never reconstruct raw `gcloud functions deploy` commands.

## Sequential execution

The only valid sequence is:

1. Subject 1 reserve, verify count/digest and reciprocal ownership, exact replay, verify no change.
2. Repeat for subjects 2 through 5, never concurrently.

Expected total counts are `12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32`. Each first reserve creates one rate-limit, account, handle, and operation-request document. The immediate exact replay must stay in the same fixed rate-limit window and commit zero writes.

Stop before the next subject on any collision, mismatch, malformed rate-limit state, unexpected document, migration/conflict evidence, 5xx/auth anomaly, count mismatch, digest mismatch, or ownership failure. Preserve durable evidence and restore gates; do not repair or delete records within D3.

The operational lifecycle is: candidate eligibility, private activation, just-in-time entry verification, successful enablement, bounded sequential mutation, immediate per-step invariant checks, containment restoration, then observation. Do not reinterpret a successful entry check as permission to exceed the mutation window or skip any per-step invariant.

## Bounded budget

The ten reviewed requests permit exactly ten gateway calls, ten authority calls, ten limited-use App Check tokens, twenty logical Firestore transactions, twenty committed Firestore writes, thirty exact RTDB reads, and zero RTDB writes. With the pinned Firestore SDK's five-attempt transaction ceiling, at most 100 transaction attempts and 200 operation reads are modeled.

Immediate exact-path verification is capped at 468 document reads; the final observation check is capped at 42. Total verification is capped at 510 reads. Including operation reads, the expected ceiling is 550 and the retry ceiling is 710. No query, collection enumeration, extra mutation retry, or budget increase is authorized by D3.

## Containment restoration

Restoration remains available after readiness expires and requires:

```sh
node functions/scripts/deploy-e1-production-gateway.cjs \
  --mode=plan \
  --action=restore-group-d3 \
  --source=functions/e1-gateway \
  --expected-sha=<reviewed-sha> \
  --confirmation='RESTORE E1 GROUP D3 GATES'
```

Containment disables gateway/reserve/proof capability and preserves successful accounts, handles, operation requests, and rate-limit evidence. It never deletes or rewrites identity state and never activates Group E.

## Observation and acceptance

The 24-hour observation begins only after subject 5's exact replay verification. Use low-frequency read-only checks for the canonical digest, exact 8+8+8+8 family counts, zero migration/conflict records, replay/collision anomalies, authority/gateway 5xx, OIDC/App Check anomalies, public exposure, IAM drift, reciprocal RTDB ownership, cost/log anomalies, and restored gates.

D3 is accepted only after all five reserves and replays pass, the exact `32`-document state and final canonical digest are captured and human-accepted, gates remain restored, the 24-hour observation completes healthy, and Group E remains disabled. An observation anomaly leaves D3 unaccepted and requires manual review.

## Next boundary

After this source contract is accepted, the next task is for the operator to prepare the private exact-five candidate pool. A separately approved read-only task may then validate eligibility for those exact five and prepare the immutable binding candidate. It must stop before readiness authorization, enablement, or mutation.
