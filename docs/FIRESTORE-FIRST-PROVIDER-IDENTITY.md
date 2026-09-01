# Firestore-First Provider Identity

Status: source and emulator candidate. Public production remains `2026-08-31.86`; Google remains owner-restricted; all new creation and public-projection gates remain inactive.

## Decision

The dedicated E.1 Firestore identity database is the sole canonical writable identity authority. RTDB identity mappings are immutable compatibility and migration evidence for existing Username/PIN accounts.

New provider-only accounts do not create or require `authIndex/{uid}`, `loginDirectory/{username}`, or `users/{username}/authUid`. There is no second handle authority and no RTDB writer credential.

## Canonical records

One Firestore transaction creates:

```text
accounts/{uid}
trainerHandles/{handleKey}
accounts/{uid}/providers/google
providerSubjects/{hmacProviderSubjectKey}
operationRequests/{uid}/requests/{requestId}
```

The account records `identityKind: provider_only`, `legacyAccessConfigured: false`, and `legacyUsername: null`. No email, display name, avatar, raw provider subject, ID token, credential, PIN, or synthetic legacy identity is stored.

The transaction also reads `authorityConfig/legacyProvisioningFreeze` and
`authorityConfig/providerAccountCreation` in the same transaction. It fails
before writes unless both exact records prove that every active legacy handle
was inventoried after a still-active provisioning freeze.

## Namespace freeze and certification

The selected pre-enable model is a bounded legacy-provisioning freeze. The
freeze record has exactly these fields:

```text
schemaVersion, state, provisioningModel, freezeId,
provisioningContractDigest, activatedAt, releasedAt
```

It is valid only while `state == active`, `releasedAt == null`, the model is
`bounded-legacy-provisioning-freeze`, and the 64-character provisioning-contract
digest is bound to a reviewed freeze ID. The certification record has exactly:

```text
schemaVersion, state, provisioningModel, freezeId,
provisioningContractDigest, normalizationVersion,
legacyNamespaceCoverageCertified, activeLegacyHandleCount,
certifiedHandleCount, coverageDigest, inventoryCapturedAt,
certifiedAt, expiresAt
```

Certification schema 2 requires normalization version 1, the same freeze ID
and provisioning-contract digest, a 64-character coverage digest, equal active
and certified counts, inventory captured no earlier than freeze activation,
and a current expiry. Missing, extra, stale, mismatched, released, or malformed
evidence returns HTTP 412 with `NAMESPACE_NOT_CERTIFIED`. The gateway maps that
single pre-write condition to Firebase `failed-precondition`; the browser clears
its pending operation, presents the existing creation-not-ready state, and does
zero reconciliation reads or creation retries. Arbitrary authority 5xx payloads
remain generic unavailability.

The Firestore authority document is the canonical freeze state. Candidate RTDB
Rules consume an exact Rules-visible enforcement projection of those same seven
fields; that projection cannot certify or enable provider creation. Activation
is ordered Rules projection first, canonical Firestore freeze second. Release is
ordered provider-certification invalidation and canonical release first, Rules
projection release second. A stale projection can therefore deny legacy
creation longer, but it cannot permit provider creation or create a split-brain
window. `scripts/build-legacy-provisioning-freeze-candidate.cjs` binds the exact
candidate Rules, guarded paths, source policy version, and release order to the
reviewed `provisioningContractDigest`.

While active, candidate Rules deny new or deleted `users/{username}` and
`loginDirectory/{username}` records, deny request transitions to `approved`,
and deny handle-changing repair even for Admin. Existing records may be updated
only while preserving their exact `authUid`, so existing login, same-handle
profile changes, and same-UID PIN/Auth repair continue without creating new UID
ownership. A malformed enforcement projection is frozen, not open. The browser
performs the same check before Auth provisioning and again before the atomic RTDB
update, but Rules are the security boundary. No freeze is activated by these
source changes.

Production currently has 58 active legacy handles, 8 protected Firestore
handles, and 50 missing protections. No freeze, certification, hold, or backfill
is created by these draft PRs, so creation remains disabled.

## Authority contract

`createProviderAccountFoundation` is distinct from `reserveTrainerHandle`. The existing legacy route still requires `verifiedLegacyFoundation()` and is not weakened.

The provider route requires:

- a verified Firebase ID token whose UID becomes the only owner;
- exactly one recent `google.com` subject in verified token claims;
- a current Firebase Auth account lookup confirming that the same Google subject remains linked immediately before creation;
- a current Auth lifecycle identifier;
- supported `providerAccountProtocolVersion: 1`; the Pages release is retained
  only as bounded diagnostic metadata;
- App Check at the callable gateway;
- a bounded request ID and idempotency fingerprint;
- an available canonical UID, handle, and provider subject;
- current full-namespace certification.

The raw Google subject is HMAC-derived before durable input or logging. The
authority uses only the dedicated `PROVIDER_SUBJECT_HMAC_KEY` and explicit
`PROVIDER_SUBJECT_HMAC_KEY_VERSION`; it never reuses an operator identity hash.
The derivation is domain-separated by purpose, key version, and provider domain,
and durable provider records include the numeric key version. Deployment guards
permit both values to be absent only before the first provider-only account,
while creation and compatibility are both false. After the first account,
returning-account compatibility requires the key even when creation is false.
If configured, the key
must be an exact Secret Manager reference named
`e1-provider-subject-hmac-key`, its secret version must equal the bounded numeric
version environment value, and plaintext or partial configuration is rejected.
Creation cannot be enabled without both values. A reviewed key ring may retain
declared prior versions during rotation; returning reads try the active version
and then those prior versions, while creation always writes the active version.
This task creates no secret.

Before rotation, disable creation and retain the old key in the declared prior
version set. Add the new active version, migrate every provider-subject reverse
claim and reciprocal provider record with exact readback, then remove the old
version only after every existing account verifies under the new key. The
source-controlled post-first-account floor rejects a deployment or rollback
that omits a required version, disables returning reads, or selects authority
source predating provider compatibility. Because no real provider-only account
exists yet, version 1 can be established before first enablement without
migration.

Identical operation evidence returns the stored result. Reusing a request ID
with changed evidence fails. A lost response triggers one exact canonical
readback; the client and authority never blindly resend an ambiguous creation.

The current-provider lookup uses Firebase Auth's ID-token-bound `accounts:lookup` endpoint and the existing Web API key. It requires no Auth administrator role and discards returned email, name, avatar, and all unrelated profile fields.

## Firestore-first resolution

After Firebase Auth settles:

1. Read the exact Firestore account foundation by verified UID.
2. If it is a valid provider-only account, open it without RTDB reciprocal checks.
3. If it is a valid legacy-migrated account, verify the existing reciprocal RTDB evidence and open the same UID.
4. If no account exists and exact reciprocal legacy evidence exists, stop with `legacy-migration-required`; do not create or merge.
5. If no account exists and the current verified provider is Google, enter onboarding.
6. If any canonical record is malformed or conflicting, fail closed without email, profile, avatar, or handle inference.

Existing linked-provider accounts therefore do not create again or rerun migration when `providerData` refreshes.

## Onboarding and abandoned flows

The durable model includes checking, handle choice, advisory availability,
ready, creating, verifying, account ready, retryable failure, ambiguous
reconciliation, blocked conflict, and canceled states. The
`pogoProviderOnboarding:v2` continuation stores schema version, versioned SHA-256
UID digest, Auth lifecycle, provider key, state, handle, and public error code.
The digest is recomputed from the current authenticated UID before resume. Raw
UID, email, provider subject, token, credentials, friend code, avatar, and other
profile data are absent; stale or cross-owner evidence is cleared.

Before exact certification there is no owned session, account-sync runtime,
legacy migration, protected-list subscription, favorites/tag hydration, Special
Board hydration, or public publication. Optional profile values are normalized
and validated before identity dispatch; invalid values cannot create a
foundation. The normalized profile is carried only in the successful in-memory
handoff and is never placed in the onboarding continuation. Closing the browser
resumes the bounded onboarding state without profile fields. Cancel signs out
but does not delete the Firebase Auth user.

## UID-rooted provider profile

Provider-only mutable profile data lives only at
`accountSync/{uid}/profile`. Its exact schema is:

```text
schemaVersion, ownerUid, friendCode, bio, discord, avatarPokemon,
revision, createdAt, lastUpdated
```

Candidate RTDB Rules authorize only `auth.uid == uid`, deny deletion and unknown
fields, bound every value, preserve `ownerUid` and `createdAt`, and require a
one-step revision increase plus monotonic server timestamp. Production Rules are
unchanged by this task.

After foundation certification, provider-only startup initializes or reads this
profile before public projection is ready. The submitted onboarding friend code
is normalized and persisted there. Profile edits use the same transaction. A
transient failure leaves owner-partitioned `provider-profile-pending-v1`
evidence in the existing account-sync IndexedDB journal. That evidence is
strictly device-local: it retries after reopening that same browser/PWA profile,
but a clean second device cannot see or retry it. If identity committed before
the first profile journal write, any clean device initializes an empty canonical
profile and the owner may complete optional details later. If another device
advances canonical profile revision while a local edit is pending, canonical
state wins, the stale local record is cleared once, and no permanent retry loop
is created. A committed write with a lost response is accepted only after exact
canonical readback. The committed identity foundation is never resent or rolled
back. Provider-only profile and activity
paths are barred from `users/{username}`, `loginDirectory/{username}`, and
`authIndex/{uid}`; nonessential last-seen activity remains device-local.

Username/PIN accounts retain the existing legacy profile compatibility path.

## Account sync and access methods

After certification, one runtime starts under `accountSync/{uid}` with
`initializationKind: provider-only`. It creates an empty canonical state when
appropriate, hydrates the UID-rooted profile, does not read legacy username
lists, does not create migration evidence, and removes rather than flushes any
provider-only legacy identity queue entry. Account activation fails closed if
the canonical profile/runtime cannot become ready.

Settings presents:

```text
Google: Connected
Username and PIN: Not configured
```

No PIN is invented. Google unlink remains blocked while it is the sole usable method. Adding Username/PIN and provider-only recovery are separate future designs.

## Public product boundary

PR A deliberately defers provider-only public publication. The stacked PR B implements the source and emulator candidate, still disabled by default, with these constraints:

- owner publication is `trainerShares/{auth.uid}`;
- Firestore `trainerHandles` remains the only handle authority;
- a fixed read-only gateway resolves an exact handle and returns only a sanitized share;
- anonymous clients never receive the owner UID or private account metadata;
- exact legacy `publicShares/{username}` URLs remain a fallback;
- no browser or server writes a second handle directory.

The authority and gateway gates are independently false by default. The full read, write, Rules, privacy, compatibility, and rollback contract is in `docs/PROVIDER-PUBLIC-PROJECTION.md`.

## Rollout and rollback

| Stage | Action | Entry gate | Rollback |
| --- | --- | --- | --- |
| 1 | Merge Firestore-first reads and provider-only model | Draft PR review and green source tests | Revert source; current legacy flow remains authoritative for active users |
| 2 | Deploy authority and public gateway inactive | Separate deployment review; creation flag false | Remove inactive revisions; no data cleanup |
| 3 | Backfill or hold all legacy handles and certify coverage | Fresh aggregate inventory; exact 58-of-58 proof; reviewed digest | Expire/remove certification; creation immediately fails closed |
| 4 | Synthetic and owner-controlled disposable Google-only canaries | Emulator matrix, Rules review, explicit canary approval | Disable creation/public gates; preserve canonical evidence for review |
| 5 | Request public Google rollout approval | Account sync, public share, discovery, sign-out/in, PWA/mobile all pass | Disable public provider entry; existing accounts remain intact |

No stage deletes or rewrites legacy mappings. Production Rules, IAM, Group E, Google visibility, and Discord are outside these draft PRs.

## Least-privilege assertions

- RTDB writer roles added: 0.
- Direct browser canonical identity writes: 0.
- Broad custom-token or custom-claims bridges: 0.
- Email/profile automatic merges: 0.
- Provider-only synthetic PINs: 0.
- Production mutations in this task: 0.
