# Provider-Only Public Projection

Status: source and emulator candidate stacked on the Firestore-first provider-account work. Both runtime gates are false by default. Production remains `2026-08-31.86`; production Rules, IAM, data, and provider visibility are unchanged.

## Decision

Provider-only accounts publish one sanitized projection at an exact UID-rooted RTDB path:

```text
trainerShares/{auth.uid}
```

The UID is an authorization boundary, not a public identifier. Public URLs remain handle-based. A fixed callable sends the exact handle to the private E.1 authority, which resolves the canonical pair in Firestore and reads only the corresponding public projection. The response never includes the owner UID.

`trainerHandles/{handleKey}` in the E.1 Firestore database remains the sole handle authority. `shareDirectory` is not read, written, activated, or exposed by this flow. Older disabled future-share source remains outside the runtime path and is not a second authority.

## Owner publication

The authenticated browser builds the existing public-share snapshot, validates it locally, then performs one RTDB transaction at `trainerShares/{session.uid}`. Candidate Rules require `auth.uid == $ownerUid` and a strict projection schema.

The stored record contains only:

```text
schemaVersion
shareVersion
trainerName
profile { friendCode, bio, discord, avatarPokemon, lastUpdated }
lists { wishlist, dynamax, gmax, costumes }
publishedListTypes
publishedAt
updatedAt
```

The schema rejects private identity fields, unknown fields, invalid list entries, changed trainer names, changed initial publication times, non-monotonic versions, and non-monotonic updates. RTDB's removal of empty objects is handled by the complete `publishedListTypes` marker.

Publication remains blocked until all of these are true:

- the canonical Firestore account is certified;
- the session UID still matches Firebase Auth;
- the provider-only identity is active;
- the independent browser development gate is true;
- the snapshot passes the existing public projection validator.

There is no publication before account certification and no write to `authIndex`, `loginDirectory`, `users`, `publicShares`, or `shareDirectory`.

## Anonymous resolution

The read sequence is fixed and bounded:

1. Anonymous browser invokes `readE1ProviderPublicShare` with App Check and one trainer handle.
2. Gateway accepts no Firebase Auth requirement for this operation, consumes a limited-use App Check token, and forwards no browser bearer token.
3. Private authority normalizes the handle and reads exact `trainerHandles/{handleKey}`.
4. Authority requires one exact reciprocal active `accounts/{ownerUid}` pair.
5. Authority performs one anonymous exact RTDB GET for `trainerShares/{ownerUid}.json`.
6. Authority validates every top-level, profile, list, and entry field and returns the existing fixed public snapshot shape.
7. Gateway validates the entire returned projection again and returns it without UID, token, provider subject, email, or canonical account metadata.

Missing handle claims and missing projections both return `SHARE_NOT_FOUND`. Split, stale, malformed, oversized, or conflicting state fails closed.

The authority receives no RTDB writer credential. Its public projection read is intentionally anonymous and therefore depends on the candidate Rules granting exact child reads while denying parent enumeration.

## Legacy compatibility

Provider resolution runs first only while the source-only browser gate is enabled. An exact legacy `publicShares/{username}` lookup remains the compatibility fallback for existing URLs and existing Username/PIN users.

The fallback does not infer identity from email, profile, avatar, or display name. A provider gateway failure is bounded and does not widen the RTDB query.

## Gates and rollback

Two independent gates are required:

```text
READ_PROVIDER_PUBLIC_SHARE_ENABLED=false
PROVIDER_PUBLIC_PROJECTION_ENABLED=false
```

The browser source additionally defaults `__POGO_PROVIDER_PUBLIC_PROJECTION_DEV__` to false. Historical Group C and Group E flows require the new gates to remain false. Deployment helpers explicitly restore both backend gates to false, and the common rollback plan includes the authority gate.

Rollback is gate-only: disable the browser, gateway, and authority read paths. Existing `trainerShares` records may remain as inert public projections for review; no legacy mapping or canonical identity must be deleted.

## Candidate Rules contract

The emulator-only candidate Rules prove:

- anonymous exact child read succeeds;
- root and `trainerShares` parent enumeration fail;
- only the exact authenticated UID can write its projection;
- another UID cannot overwrite it;
- legacy identity paths cannot be fabricated;
- unknown or private fields fail;
- version and timestamp evolution is monotonic;
- trainer name and initial publication time are immutable;
- exact legacy `publicShares/{username}` remains readable;
- browser Firestore access to canonical identity remains denied.

Production Rules are intentionally not changed by this PR.

## Emulator limitations

Auth and RTDB Rules tests use the Firebase emulators and real Rules evaluation. Firestore authority tests use the Firestore emulator and the production adapter. Provider popup behavior and Firebase App Check token minting cannot be faithfully produced by the local emulators, so those boundaries use injected adapters while asserting exact callable options, request shape, gate behavior, and absence of Auth/UID forwarding.

## Rollout boundary

1. Review and merge source with all gates false.
2. Separately review an inactive authority/gateway deployment.
3. Backfill or hold the complete legacy handle namespace and certify coverage.
4. Run synthetic emulator canaries.
5. Obtain explicit approval for an owner-controlled disposable Google-only canary.
6. Verify public share, trainer discovery, account sync, sign-out/in, PWA, and mobile.
7. Request separate approval before public Google exposure.

Discord remains disabled and outside this architecture.
