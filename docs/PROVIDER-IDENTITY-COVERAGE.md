# Provider Identity Coverage

Status: privacy-safe read-only production inventory captured on 2026-08-31. No production write, Rules change, IAM change, Auth mutation, or provider change occurred.

## Scope and method

The inventory read the exact production RTDB roots `authIndex`, `users`, and `loginDirectory`, plus paginated `accounts` and `trainerHandles` collections in the named `phase-e-identity` Firestore database. It emitted aggregate counts and run-scoped HMAC digests only. The random HMAC key was process-local and discarded, so the digests cannot be used to recover or correlate identities across runs.

No username, UID, email, PIN, profile, token, or raw document was printed or stored in the repository.

## Aggregate result

| Measure | Count |
| --- | ---: |
| RTDB `authIndex` rows | 38 |
| RTDB `users` rows | 58 |
| RTDB `loginDirectory` rows | 58 |
| Reciprocal legacy UID/username identities | 28 |
| Unpaired `authIndex` rows | 10 |
| Legacy users without a UID | 0 |
| Legacy users with a conflicting reverse mapping | 30 |
| Active legacy handle namespace | 58 |
| Firestore accounts, valid and active | 8 |
| Firestore trainer handles, valid and active | 8 |
| Complete canonical account/handle pairs | 8 |
| Reciprocal legacy identities missing Firestore accounts | 20 |
| Active legacy handles missing Firestore handle claims | 50 |
| Firestore accounts without reciprocal legacy mappings | 0 |
| Conflicting canonical UID/handle pairs | 0 |
| Split canonical account/handle pairs | 0 |
| Malformed rows across all five sources | 0 |

All 8 Firestore accounts have an exact active reverse handle claim and a reciprocal legacy mapping. There are no Firestore-only accounts in the current production data. The active legacy namespace is not yet fully represented in Firestore.

## Run-scoped keyed proofs

```text
reciprocal legacy UID set      cd2d28292486c6a70c4b7eab2d2662d646b9cc5653c0e0894ae9f53ff7d1ae0e
Firestore account UID set     a057c72a808043183affa822ad7c963d17a7be133fd9f0dc5b84ef78384d7951
active legacy handle set      f14c03fd2dbcad9f8ec3a2cf14674ed18cf3d7f24aa1b6ae63b044667958cb60
Firestore handle set          262f6fd2500c43bb946caee6ab517f7ab1fb43c96b9c06f26622d2bc22763b98
missing account set           ed8a66b44a196dbd58c1f070e2880410514674108148f38a4399054909ae442e
missing handle set            9e97955930fee381aff9837368421c8ff476caef9d11eb79c2e80832a747e5fb
conflict set                  da47e13c8ec8d66de2d5447abb4f866f96b897467452adec5e16dd61ee27572b
```

The zero conflict and split-pair counts are equality proofs computed inside the same in-memory run before raw identifiers were discarded. The differing whole-set digests are expected because coverage is incomplete.

## Collision-safety decision

New provider account creation must remain disabled. A Firestore-only availability check cannot yet prove that a requested handle is absent from all 58 active legacy handles because 50 have no Firestore handle claim.

The selected protection is option A: freeze new legacy account/handle
provisioning, record that reviewed epoch at
`authorityConfig/legacyProvisioningFreeze`, then create exact backfill or
immutable collision-hold claims for every active legacy handle. Only an
inventory captured after freeze activation may support the expiring
`authorityConfig/providerAccountCreation` certification. The authority
transaction requires:

- an exact active freeze record with schema 1, model
  `bounded-legacy-provisioning-freeze`, reviewed `freezeId`, 64-character
  `provisioningContractDigest`, activation time, and null release time;
- an exact certification record with schema 2 and the same model, freeze ID,
  and provisioning-contract digest;
- normalization version 1 and `legacyNamespaceCoverageCertified == true`;
- `certifiedHandleCount == activeLegacyHandleCount`;
- a 64-character coverage digest;
- inventory captured at or after freeze activation;
- certification after inventory and a current expiry.

Missing, extra, stale, malformed, released, or mismatched freeze/certification
evidence blocks the transaction before any account, handle, provider, subject,
or operation record is created. Matching aggregate counts without matching epoch
evidence are insufficient. No production freeze, backfill, certification,
runtime list permission, or RTDB writer role is added by this work.
