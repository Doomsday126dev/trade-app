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

The transaction also reads the exact expiring namespace certification document. It fails before writes unless every active legacy handle is collision-protected.

## Authority contract

`createProviderAccountFoundation` is distinct from `reserveTrainerHandle`. The existing legacy route still requires `verifiedLegacyFoundation()` and is not weakened.

The provider route requires:

- a verified Firebase ID token whose UID becomes the only owner;
- exactly one recent `google.com` subject in verified token claims;
- a current Firebase Auth account lookup confirming that the same Google subject remains linked immediately before creation;
- a current Auth lifecycle identifier;
- release `2026-08-31.86` compatibility evidence;
- App Check at the callable gateway;
- a bounded request ID and idempotency fingerprint;
- an available canonical UID, handle, and provider subject;
- current full-namespace certification.

The raw Google subject is HMAC-derived before durable input or logging. Identical operation evidence returns the stored result. Reusing a request ID with changed evidence fails. A lost response triggers one exact canonical readback; the client and authority never blindly resend an ambiguous creation.

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

The durable model includes checking, handle choice, advisory availability, ready, creating, verifying, account ready, retryable failure, ambiguous reconciliation, blocked conflict, and canceled states. Stored continuation data contains only bounded request metadata and hashes. It excludes UID, email, provider subject, token, credentials, friend code, and profile data.

Before exact certification there is no owned session, account-sync runtime, legacy migration, protected-list subscription, favorites/tag hydration, Special Board hydration, or public publication. Closing the browser resumes the bounded onboarding state. Cancel signs out but does not delete the Firebase Auth user. Orphan Auth-user cleanup is a future operator policy, never an automatic client action.

## Account sync and access methods

After certification, one runtime starts under `accountSync/{uid}` with `initializationKind: provider-only`. It creates an empty canonical state when appropriate, does not read legacy username lists, does not create migration evidence, and does not retire legacy queues.

Settings presents:

```text
Google: Connected
Username and PIN: Not configured
```

No PIN is invented. Google unlink remains blocked while it is the sole usable method. Adding Username/PIN and provider-only recovery are separate future designs.

## Public product boundary

PR A deliberately defers provider-only public publication. The stacked PR B activates the existing UID-share architecture with these constraints:

- owner publication is `trainerShares/{auth.uid}`;
- Firestore `trainerHandles` remains the only handle authority;
- a fixed read-only gateway resolves an exact handle and returns only a sanitized share;
- anonymous clients never receive the owner UID or private account metadata;
- exact legacy `publicShares/{username}` URLs remain a fallback;
- no browser or server writes a second handle directory.

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
