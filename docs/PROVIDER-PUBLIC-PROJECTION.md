# Provider-Only Public Projection

Status: source and emulator candidate stacked on the Firestore-first provider-account work. Every provider capability and backend operation gate is false by default, and the source-controlled compatibility floor still records that no provider-only account exists. Production remains `2026-08-31.86`; production Rules, IAM, data, and provider visibility are unchanged.

## Decision

Provider-only accounts publish one sanitized projection at an exact UID-rooted RTDB path:

```text
trainerShares/{auth.uid}
```

The UID is an authorization boundary, not a public identifier. Public URLs remain handle-based. A fixed callable sends the exact handle to the private E.1 authority, which resolves the canonical pair in Firestore and reads only the corresponding public projection. The response never includes the owner UID.

`trainerHandles/{handleKey}` in the E.1 Firestore database remains the sole handle authority. `shareDirectory` is not read, written, activated, or exposed by this flow. Older disabled future-share source remains outside the runtime path and is not a second authority.

The same authority now supplies two additional fixed operations for signed-in product use:

- a bounded, UID-free canonical trainer directory; and
- an exact Favorite identity resolver that returns a target UID only to an authenticated app user.

Neither operation exposes a collection name, arbitrary query shape, email, provider subject, profile, or private account field.

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
- the independent browser `providerPublicWriteSupport` capability is true;
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

Provider resolution runs first only while provider public-read support is active. An exact legacy `publicShares/{username}` lookup remains the compatibility fallback for existing URLs and existing Username/PIN users.

The fallback does not infer identity from email, profile, avatar, or display name. A provider gateway failure is bounded and does not widen the RTDB query.

Before the first provider-only account, provider reads may be fully disabled. Legacy Favorites continue to use the existing exact reciprocal `users` and `authIndex` UID binding. Once provider accounts exist, the compatibility floor forces provider account support and provider public reads on even if public entry, linking, creation, and public writes are disabled.

## Canonical trainer discovery

`listE1TrainerDirectory` is a fixed Firebase callable protected by Firebase Auth, limited-use App Check, replay rejection, and a durable per-caller rate limit. The private authority accepts either an empty initial query or a normalized two-to-64-character prefix, a page size from 1 through 25, and either `null` or an authority-signed, query-bound cursor. It performs only the fixed `trainerHandles` query and validates each result against the exact reciprocal active `accounts/{uid}` record before returning canonical trainer names. UIDs and all other metadata are removed before the response crosses the authority boundary.

An empty query returns only the first bounded page and never returns a continuation cursor. Nonempty prefix queries can return signed continuation cursors. The browser loads a bounded initial sample plus the current two-character and full prefixes, at most two pages for each nonempty query. It combines those legitimately returned candidates with legacy `loginDirectory` names and local Favorites/Recents, deduplicates by normalized canonical handle, then applies the existing exact, prefix, token-prefix, substring, and conservative typo ranking locally. This is bounded candidate discovery, not a claim that an arbitrary substring search enumerates the full canonical namespace.

Anonymous users cannot call the directory operation, and browser Firestore access remains denied. No generic Firestore query or parent/database enumeration endpoint exists.

## Favorite identity

The chosen compatibility strategy is **A**: the existing Favorite schema retains `targetUid`, and `resolveE1FavoriteTrainerIdentity` returns that exact UID only to a signed-in, App-Checked app session. The authority normalizes one handle, verifies its exact `trainerHandles` and reciprocal active account pair, rate-limits the caller, and returns only:

```text
targetUid
canonicalTrainerName
```

New Favorites bind the canonical entity ID to that UID. Existing Favorites send their stored UID as `expectedTargetUid`; a handle rebound or collision returns a conflict instead of redirecting the Favorite. Migration, Favorite creation, Favorite opening, share hydration, and Find by Pokemon use the same session-aware resolver. The Favorite share cache includes the target UID in its binding and invalidates cached or in-flight work if that UID changes. The per-user resolver window permits one complete 100-Favorite hydration plus one explicit refresh while remaining bounded by Auth, App Check, replay protection, and the rolling rate limit.

When provider reads are legitimately off before the first provider-only account, the same product paths use the exact reciprocal legacy UID resolver. They do not trust a handle-only public-share lookup. Anonymous public-share responses remain UID-free, and UIDs are never displayed or serialized into a public share.

## Gates and rollback

The backend public-read path retains two independently false-by-default deployment gates:

```text
READ_PROVIDER_PUBLIC_SHARE_ENABLED=false
PROVIDER_PUBLIC_PROJECTION_ENABLED=false
```

The browser uses six explicit capabilities:

```text
providerAccountCompatibility=false
googlePublicEntry=false
googleExistingAccountLinking=false
providerAccountCreation=false
providerPublicReadSupport=false
providerPublicWriteSupport=false
```

The source-controlled `providerAccountsExist` compatibility floor is false before the first provider-only account. After that point it irreversibly forces `providerAccountCompatibility` and `providerPublicReadSupport` true while leaving public Google entry, linking, creation, and public writes independently controllable. The standalone anonymous share client observes the same floor, so hiding Google or disabling enrollment cannot strand an existing provider public URL.

Historical Group C and Group E flows require the candidate backend gates to remain false. Deployment helpers explicitly restore those gates to false, and no production floor or capability is changed in this PR.

Pre-first-account rollback may disable the provider stack completely. Post-first-account rollback may disable new entry, linking, creation, and public writes, but must preserve compatible authority source, provider account reads, the HMAC key ring, and provider public reads. Existing `trainerShares` records may remain available; no legacy mapping or canonical identity is deleted.

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

Browser, authority, and gateway validators share the same top-level/profile/entry allowlists, four list types, priority values, canonical profile limits (`friendCode` 14, `bio` 120, `discord` 40, `avatarPokemon` 120), background-ID grammar, timestamp constraints, 2,000-entry aggregate limit, and 512 KiB service boundary. Invalid canonical profile values fail closed; no boundary silently truncates them. Dynamic Pokemon keys named `__proto__`, `prototype`, or `constructor` are rejected at every boundary, and sanitized dictionaries use null prototypes.

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
