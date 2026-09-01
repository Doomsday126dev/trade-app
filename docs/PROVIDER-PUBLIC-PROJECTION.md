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

Provider-only publication is derived only from accepted canonical account-sync rows plus the canonical UID-rooted `accountSync/{uid}/profile`. It does not use the legacy username-rooted local-share snapshot. The authenticated browser validates that combined snapshot, persists an owner-partitioned pending record in IndexedDB, then awaits one RTDB transaction and one exact readback at `trainerShares/{session.uid}`. Candidate Rules require `auth.uid == $ownerUid` and a strict projection schema.

The pending record is stored as `provider-publication-pending-v1` and contains only the owner UID, canonical public rows, a domain-separated SHA-256 fingerprint, schema version, and queue time. It is written before the network attempt and removed only after exact committed content is read back. A changed session, UID, or runtime generation cannot clear another lifecycle's pending publication.

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

Canonical add, edit, delete, and provider-profile mutations request publication only after the private mutation is accepted. An exact content match is reconciled without allocating another `shareVersion`; changed content advances the version transactionally. A temporary public-write failure never rolls back the private account edit. The durable pending publication retries on reconnect, authenticated startup/PWA reopen, and explicit share or retry actions.

There is no publication before account certification and no provider-only write to `authIndex`, `loginDirectory`, `users`, `publicShares`, or `shareDirectory`.

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

## Threat model and known-UID residual

The projection is intentionally public and strictly sanitized. Candidate Rules allow an anonymous party that already knows an owner's Firebase UID to read the exact `trainerShares/{uid}` child directly. Parent and root enumeration remain denied, but the UID itself is not treated as a secret once independently known.

This residual is accepted for the candidate architecture. App Check and the callable gateway provide handle resolution, bounded request validation, replay resistance, and anti-abuse controls; they are not a confidentiality boundary and are not claimed as the exclusive read path. The exact-child Rules path is safe only because the projection cannot contain email, provider subject, token, credential, canonical account metadata, local journal state, private tags, migration evidence, or any other private field.

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

Browser, authority, and gateway validators share the same top-level/profile/entry allowlists, four list types, priority values, string bounds, background-ID grammar, timestamp constraints, 2,000-entry aggregate limit, and 512 KiB service boundary. Dynamic Pokemon keys named `__proto__`, `prototype`, or `constructor` are rejected at every boundary, and sanitized dictionaries use null prototypes.

Realtime Database Rules cannot express a cross-list aggregate child count or serialized-byte limit. The candidate Rules enforce every per-node field and length constraint, while the browser refuses an oversized write and both anonymous service boundaries fail closed if a malicious owner bypasses the browser. This is an explicit Rules limitation, not a claim of exact aggregate enforcement.

Production Rules are intentionally not changed by this PR.

## Emulator limitations

Auth and RTDB Rules tests use the Firebase emulators and real Rules evaluation, including anonymous exact known-UID reads and denied parent enumeration. Firestore authority tests use the Firestore emulator and the production adapter. Provider popup behavior and Firebase App Check token minting cannot be faithfully produced by the local emulators, so those boundaries use injected adapters while asserting exact callable options, request shape, gate behavior, and absence of Auth/UID forwarding.

## Rollout boundary

1. Review and merge source with all gates false.
2. Separately review an inactive authority/gateway deployment.
3. Backfill or hold the complete legacy handle namespace and certify coverage.
4. Run synthetic emulator canaries.
5. Obtain explicit approval for an owner-controlled disposable Google-only canary.
6. Verify public share, trainer discovery, account sync, sign-out/in, PWA, and mobile.
7. Request separate approval before public Google exposure.

Discord remains disabled and outside this architecture.
