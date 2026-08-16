# E.1 Group D3 synthetic reserve cohort runbook

## Status and evidence boundary

Group D3 is the final pre-Group-E reserve-cohort validation. D3 mutation execution uses exactly five controlled synthetic legacy canaries. Each canary performs one `reserveTrainerHandle` call followed immediately by one exact replay. D3 does not authorize repair, migration, freeze, provider linking, client-foundation activation, SEC-02 work, or Group E.

The previously reviewed five real production users remain valuable **real-world read-only compatibility evidence**. Their exact Auth presence, reciprocal legacy ownership, login-directory readiness, exclusions, and durable-target absence show that organic ownership shapes are compatible with D3 admission checks. They are not D3 mutation subjects, receive no reserve or replay, and require no credentials or participation.

Synthetic D3 proves that the authentic browser, Firebase Auth, App Check, gateway, authority, and durable identity path works sequentially at five-subject scale. It does not prove that five arbitrary organic users were migrated.

The tracked contract is intentionally unbound and unauthorized. This document neither creates canaries nor authorizes production execution.

## Immutable E.1 precondition

D3 requires the accepted D2 Firestore state exactly:

- total documents: 12
- `accounts`: 3
- `trainerHandles`: 3
- `rateLimits`: 3
- `operationRequests`: 3
- `identityMigrations`: 0
- `identityConflicts`: 0
- canonical digest: `2923aafa890de58cb04fb5941528f7a425c22d0a131dd9fc0fcf71013468bf0b`

Synthetic legacy setup must not change this state or digest.

## Retired real-world execution artifacts

Old private candidate-pool, binding, activation, and guard-input files may be retained as historical evidence. They use the retired `real-world-read-only-compatibility` evidence type and cannot satisfy the current synthetic contract. `enable-group-d3` requires all of the following domain-bound values:

- `cohortType=controlled-synthetic-legacy-canary`
- `evidencePurpose=synthetic-mutation-execution`
- `acquisitionMode=guarded-synthetic-setup-exact-five`
- exact synthetic setup digest
- exact synthetic candidate-pool and binding digests
- exact private browser-harness digest bound to that binding

Missing, mixed, or real-world types fail closed. Source changes also invalidate activation/readiness by immutable SHA.

## Separate canary setup stage

`PREPARE D3 SYNTHETIC CANARIES` is a separate, later, human-approved production stage. Its private mode-`0600` plan must use a deterministic operation ID and exactly five clearly test-only identities following the guarded `E1D3Canary` naming policy. Passwords, six-digit PINs, synthetic login emails, and tokens are private operator material and never enter tracked source, logs, reports, localStorage, or sessionStorage.

Before any setup write, exact absence must be proven for every proposed Auth UID/email, `users/{trainer}`, `loginDirectory/{trainer}`, `authIndex/{uid}`, and every planned E.1 account/handle/rate-limit/request/migration/conflict target. No enumeration or fallback substitution is authorized.

The setup mutation ceiling is exactly 20 logical creates:

- 5 Firebase Auth user creates
- 5 minimal `users/{trainer}` creates
- 5 `loginDirectory/{trainer}` creates
- 5 reciprocal `authIndex/{uid}` creates
- 0 `phase-e-identity` writes

The user shell contains only fields needed for supported username/PIN login and reciprocal ownership. Setup creates no lists, Favorites, shares, requests, admin/community state, or E.1 documents.

Validate a future private setup plan locally with:

```sh
E1_PRODUCTION_THIRD_MUTATION_CANARY_SETUP=functions/.local/e1-production-third-mutation-canary-setup.json \
node functions/scripts/check-e1-production-third-mutation-canary-setup.cjs
```

Validation performs no cloud operation and does not authorize setup or D3.

### Setup idempotency and rollback

The setup operation ID, exact five identities, credential fingerprints, D2 digest, and mutation budget form a deterministic setup digest. Exact replay performs zero mutations. Any partial or conflicting existing state fails closed and is never overwritten.

A failed setup may roll back only exact entries in its creation ledger, only while those entries still belong to that setup operation, and only before any canary has successfully entered D3 durable identity state. The rollback ceiling is 20 exact deletes. It must never delete pre-existing production data. Once any canary reserve succeeds, normal D3 evidence-preservation rules apply and destructive rollback is forbidden.

## Synthetic candidate pool and binding

After separately approved setup, create a private mode-`0600` candidate pool containing exactly five `syntheticCanary=true` identities and the setup digest. The exact schema forbids credentials and tokens. Validation canonicalizes trainer names, rejects UID/trainer/handle collisions, and orders candidates by the privacy-safe subject fingerprint.

The private binding must contain exactly slots A-E, unique UID/trainer/handle/request identities, the D2 prior-cohort evidence, the setup and pool digests, and a domain-separated synthetic binding digest. It remains `executionAuthorized=false` and `groupEAuthorized=false`.

D3 still never enumerates, discovers, ranks, or selects production accounts. Do not choose a sixth subject. A pool or binding does not authorize execution.

## Authentic browser harness

The private D3 browser harness runs in five isolated supported browser contexts using the production Firebase web configuration. For each canary and each operation it must:

1. start with no previous, operator, or admin Firebase session;
2. sign in through the supported username/PIN to Firebase email/password path;
3. require `currentUser.uid` to equal the exact bound canary UID;
4. obtain a fresh Firebase ID token from that signed-in user;
5. obtain a fresh limited-use token from the production App Check provider;
6. call only the reviewed `reserveE1TrainerHandle` gateway operation;
7. discard both tokens and sign out.

Debug App Check, hardcoded tokens, custom-token minting, Admin SDK ID tokens, service-account impersonation, operator substitution, token reuse, and browser-storage persistence are forbidden. Every reserve and replay obtains fresh user and App Check tokens independently.

The private browser-harness evidence is bound to the synthetic subject-binding digest. It proves five distinct contexts, exact UID matching, production App Check availability, no debug token, no token persistence, and no operator/admin session. It is not execution authorization.

## Readiness and timing

Private candidate-pool, binding, browser-harness, activation, and guard-input artifacts must be Git-ignored and mode `0600`. The guard requires the exact D2 baseline, all gates disabled, reviewed runtime provenance, private IAM boundary, App Check token-verifier boundary, exact operation budget, no preflight writes, and `groupEAuthorized=false`.

D3 preserves `pre-enable-jit-v1`: Auth metadata and targeted-state admission evidence must be at most 15 minutes old at enable, the mutation window is at most two hours, and containment restoration remains available after expiry. Fresh browser ID/App Check tokens are required for every operation regardless of metadata age.

Only the canonical gateway helper may prepare enable or restore plans:

```sh
node functions/scripts/deploy-e1-production-gateway.cjs \
  --mode=plan \
  --action=enable-group-d3 \
  --source=functions/e1-gateway \
  --expected-sha=<reviewed-sha> \
  --confirmation='ENABLE E1 GROUP D3 RESERVE COHORT'
```

Restoration uses `--action=restore-group-d3` and confirmation `RESTORE E1 GROUP D3 GATES`. Deployment and execution always require separate human approval.

## Sequential mutation and budget

The only sequence is synthetic A reserve, verify, exact replay, verify, then B through E, never concurrently. Expected document counts remain `12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32`. Each reserve creates exactly one account, trainer handle, rate-limit, and operation-request document. Exact replay commits zero writes.

The ten requests permit ten gateway calls, ten authority calls, ten limited-use App Check tokens, twenty logical Firestore transactions, twenty committed Firestore writes, thirty exact RTDB reads, and zero RTDB writes. Existing transaction/read ceilings remain unchanged.

Stop before the next subject on any mismatch, collision, auth/App Check anomaly, count/digest drift, unexpected document, ownership failure, or budget breach. Restore temporary gates and preserve durable evidence.

## Observation, Group E, and canary lifecycle

After all five replay verifications, restore all gates and begin the existing 24-hour observation. Final state is exactly 32 documents: 8 accounts, 8 trainer handles, 8 rate limits, 8 operation requests, and zero migrations/conflicts.

Group E remains unauthorized after D3 until separate human approval. Successful synthetic canaries and their durable identity evidence are retained through the Group E/Google rollout as clearly test-only production canaries. No automatic deletion occurs; eventual retirement is a separate reviewed migration task.

## Next boundary

After this source amendment is accepted, the next separately approved task is guarded creation of exactly five synthetic D3 legacy canaries. That task creates the minimal Auth/RTDB state, stores credentials privately, verifies the unchanged 12-document D2 baseline, proves authentic browser sign-in and production App Check capability read-only, binds the cohort, and stops before reserve/replay.
