# Durable Authentication Readiness

Status: local design candidate only. No provider, rule, Function, client action, or migration is enabled.

## Identity invariants

- The Firebase UID is the immutable account authority. A provider link may add a way to authenticate as that UID; it may not replace it.
- The trainer handle is public presentation data. It never grants ownership.
- Google subject IDs, verified email addresses, and Discord subject IDs are private authentication metadata.
- `admins/{uid}` remains the authorization source for Admin behavior.
- Every authenticated trainer operation continues to require both `users/{trainer}/authUid == auth.uid` and `authIndex/{auth.uid}/username == trainer`.
- Provider email, provider display name, Discord username, trainer handle, legacy profile flags, and public-share content grant no authority.

## Private server-owned schema

The proposed records are deliberately absent from the current Rules file, so root denial continues to reject all client access.

```text
authProviders/{uid}/{provider}
  provider, subjectHash, state, linkedAt, updatedAt, revision

authProviderSubjects/{provider}/{keyedSubjectHash}
  uid, linkedAt, revision

authLinkAttempts/{attemptId}
  callerUid, stateHash, codeChallenge, createdAt, expiresAt, consumedAt
```

Only a fixed trusted adapter may mutate these roots. Provider subjects are obtained from Firebase Auth or the provider token exchange, never from client input. The reverse subject claim and UID-owned link must be reserved atomically in a future Firebase adapter. There is no ordinary-user read, public read, Admin browsing exception, arbitrary path method, bulk method, or generic issuer. Access and refresh tokens are not persisted. Link attempts contain hashes, expire after ten minutes, and are consumed once.

The local candidate includes an in-memory adapter for deterministic contract tests. No Firebase provider-link adapter exists yet, and none of the readiness operations are exported from `functions/src/index.js`.

## Existing-user Google link

1. Sign in with the existing trainer handle and PIN.
2. Reauthenticate recently with the current PIN credential.
3. Start `linkWithPopup` on desktop or a reviewed `linkWithRedirect` fallback where browser behavior requires it.
4. Firebase Auth links `google.com` to the current user. The Firebase UID must remain byte-for-byte identical.
5. A trusted confirmation operation reads the current Firebase Auth user's provider data through Admin Auth. It accepts no subject, email, target UID, trainer handle, or profile name from the client.
6. Reserve the keyed Google subject hash, write the UID-owned provider row, and verify the trainer/auth-index binding again.

Credential-already-in-use, interrupted redirect, cancellation, stale attempts, account switching, and provider collision fail closed. A collision starts recovery review; it never merges trainer profiles or moves lists. Admin accounts follow the same UID rule and require stronger reauthentication before later unlink operations.

## New-user Google onboarding

Google authentication alone creates no trainer profile, list, public share, preference record, or Admin record. A new authenticated UID must complete explicit onboarding, reserve a trainer handle through `reserveTrainerHandle`, and then initialize the account through a future reviewed atomic operation. Duplicate initialization must be idempotent and must reject an established handle or subject collision.

## Email transition

The current PIN is represented by Firebase Auth's password provider attached to a synthetic, versioned email address. Firebase Auth does not provide a clean way to treat an unrelated verified real email as a second independent email/password identity on that same account. The preferred future user experience remains email magic link, but migration must be a reviewed per-account cutover:

1. Keep the legacy password provider active.
2. Verify the real email through an email-link flow bound to the signed-in UID and a short-lived attempt.
3. Confirm there is no existing Firebase account or provider-subject claim for that email.
4. Update or link the Firebase email credential using a supported UID-preserving Firebase Auth operation.
5. Confirm the same UID and trainer/auth-index binding before marking the email method usable.

No real-email migration is implemented in this candidate because the exact Firebase Auth cutover and rollback behavior must first be proven in staging. Duplicate accounts must be recovered explicitly; they must never be merged by email alone.

## Discord linking architecture

`beginDiscordLink` and `completeDiscordLink` exist only as unexported domain operations.

- The browser generates cryptographically random OAuth state and a PKCE verifier with Web Crypto, sends only their SHA-256 values to `beginDiscordLink`, and retains raw values in ephemeral memory.
- The server creates a random attempt ID, binds it to the authenticated UID, stores only state and PKCE hashes, and expires it after ten minutes.
- `completeDiscordLink` requires the same authenticated UID, App Check, recent authentication, exact request schema, matching state, matching PKCE verifier, an unconsumed attempt, and a fixed rate limit.
- The future server adapter exchanges the authorization code with the Discord client secret held only in server secret storage. It obtains the stable Discord user ID from Discord and returns no provider token to application storage.
- The keyed Discord subject hash is globally reserved to one Firebase UID. The operation cannot accept a target UID or arbitrary issuer and cannot issue a generic custom token.

Later Discord-first sign-in may mint a Firebase custom token only after a fixed lookup resolves an already-linked Discord subject to one UID, or after separately approved new-user onboarding. That operation is intentionally absent.

## Account & Security UI

Settings contains an account-only informational panel for Google, email, Discord, and Legacy PIN. The future state vocabulary is `linked`, `not linked`, `reauthentication required`, `conflict`, and `recovery required`. In this release, Google, email, and Discord always render as unavailable/not linked, Legacy PIN remains active, and no link, unlink, migration, or recovery button exists. URL changes, console variables, stored values, and Firebase payloads cannot activate it.

## Unlink and recovery

A future trusted unlink must:

- reject removal of the final usable authentication method;
- require recent authentication and stronger Admin reauthentication;
- coordinate Firebase Auth unlinking with the provider-subject reservation and UID-owned metadata;
- leave an explicit recoverable reconciliation record if either side is interrupted;
- remove the reverse subject reservation only after the Firebase provider is confirmed absent;
- preserve rollback access until reconciliation is complete.

Unlink execution is not implemented. Current legacy reset UI already blocks replacement-UID reset for established accounts. This candidate also makes `repairMemberAccount` reject any direct attempt to provision a replacement UID when an established UID exists. The reviewed `reset:existing-pin` workflow remains the UID-preserving PIN reset path.

## Threat model and stopping rules

| Threat | Required control |
| --- | --- |
| Account-linking attack | Current Auth UID, recent reauth, App Check, verified provider data, binding recheck |
| Provider linked elsewhere | Atomic global subject reservation and explicit recovery |
| Forged subject/email | Subject comes only from Admin Auth or provider exchange |
| OAuth CSRF/replay | Random state, hashed storage, UID binding, short expiry, one-time consumption |
| PKCE mismatch | Fixed S256 challenge verification before exchange |
| Account switch | Attempt caller UID must equal current Auth UID |
| Login enumeration | Stable redacted errors and no public provider lookup |
| Unlink final method | Count verified usable methods; fail closed |
| Admin unlink | Strong reauthentication and separate review |
| Discord token replay | One-time attempt and one-time authorization code exchange |
| Replacement-UID repair | Established UID makes fresh provisioning invalid |
| Duplicate onboarding | Explicit handle reservation and idempotent atomic initialization |

Structured logs may contain operation, stable error class, mode, duration, App Check presence, and correlation hashes. They must exclude UID, trainer handle, email, provider subject, OAuth state, PKCE verifier, authorization code, access token, and refresh token.

## Rules and deployment boundary

The current Rules artifacts are unchanged. Root `.read: false` and `.write: false`, narrow reads, public shares, and owner checks remain unchanged. A future additive candidate must deny all client reads and writes to provider metadata and permit only Admin SDK access. No Rules or Functions deployment, provider registration, OAuth secret, redirect URI, credential, staging fixture, production read, or production write is part of this candidate.

## Rollout stages

1. **Stage A: schema and threat model.** Review this candidate, choose keyed-subject hashing/secret retention, and approve exact staging fixtures.
2. **Stage B: staging provider-link backend.** Add a fixed Firebase adapter, secrets, rate limits, cleanup, logging, reconciliation, App Check, and emulator/staging tests. Keep client actions disabled.
3. **Stage C: existing-user Google linking.** Enable only for recently PIN-authenticated synthetic accounts in staging; prove the UID and trainer binding never change.
4. **Stage D: Google new-user onboarding.** Require explicit handle reservation and atomic initialization after OAuth.
5. **Stage E: Discord linking, then login.** First prove existing-user linking; add linked-subject custom-token login only in a later approval.
6. **Stage F: email-link migration.** Prove the synthetic-email cutover and rollback per account before offering it.
7. **Stage G: Account & Security self-service.** Enable status reads, recovery, and carefully reconciled unlink controls.
8. **Stage H: stop issuing PINs to new accounts.** Only after at least one durable method is mandatory and recovery is proven.
9. **Stage I: make legacy PIN recovery-only.** Preserve UID-safe recovery for remaining accounts; do not delete the provider prematurely.
10. **Stage J: activate private cross-device sync.** Authentication hardening precedes preference migration and sync activation.

The order remains intentionally conservative. Discord-first login and email migration follow Google linking because they require more custom backend and reconciliation work. Preference sync remains last so private data is never attached to an identity model still being migrated.
