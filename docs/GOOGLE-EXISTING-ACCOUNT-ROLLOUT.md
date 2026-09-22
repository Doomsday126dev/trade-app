# Google existing-account delivery

Candidate release `2026-09-22.117` follows the accepted rollback to production
`2026-09-15.115` (`df20ddbc5a273b8fef0832c4e38b3de86b69a2dd`). Release
`2026-09-15.116` was served, failed its final product-boundary canary, and was
rolled back. Its release identity will not be reused.

## `.116` failure diagnosis

The fresh PIN baseline and same-UID Google return observed different composite
`accountDataFingerprint` values. Read-only authoritative inspection found one
owner throughout and a stable canonical product inventory: 81 trade entries,
8 Favorites, 4 Favorite tags, no persisted intent declarations, and Special
Trade Board counts of 10 looking-for and 1 for-trade. The Google return path
contains no product-state writer, and no data-write audit event was found in the
canary interval.

The mismatch came from taking snapshots at different hydration boundaries. The
old helper considered healthy listeners sufficient. Account-sync can report a
healthy listener before migration/readiness finishes, before
`projectionReady`, and before canonical entities are applied to the in-memory
projection. Google activation independently awaited full account-sync startup,
so the return snapshot was fully hydrated while the PIN baseline could be empty
or partial. Raw canonical-entity listener order also had no stable ordering.
The addition of `intentDeclarations` in `.116` exposed the timing gap but did
not cause a persisted declaration change.

## `.117` correction

Every provider boundary snapshot now requires the same current Auth/session
binding, exact runtime owner, `projectionReady`, `profileReady`, healthy active
listener and controller, and zero pending, blocked, or conflicting operations.
It fails closed before hashing if any requirement is absent or the session
changes during the read.

Product evidence is decomposed into independently hashed components:

- lists by the owned My List types;
- Favorites;
- Favorite tags;
- Special Trade Board;
- intent declarations;
- canonical account-sync entities.

Object keys and semantically unordered delivery collections use stable canonical
ordering. Special Trade Board order and declaration `sortOrder` remain protected
product state. A changed component produces a component-specific failure. Raw
Pokémon, list, note, and identity values remain private; evidence records only
hashes and redacted structural summaries such as lengths, identity sets, order,
and duplicate identities.

Regression coverage models a fully hydrated PIN snapshot, sign-out, and a
fully hydrated same-UID Google return. It covers populated and empty intent
declarations, declaration insertion order, canonical listener delivery order,
Favorites and tag order, duplicates, partial hydration rejection, and actual
single-field mutations. A real tag field or Special Trade Board order change
still fails on its exact component.

## Guarded release boundary

Before release, require production to remain exact `.115`; the authority and
gateway to remain qualified and read-enabled; the canary Google credential to
remain linked to its original UID/account; account creation and provider-public
read/write capabilities to remain false; IAM, Rules, App Check, and account
state to show no unexplained drift; and Chrome Local Overrides to be disabled.
Any difference stops the release rather than repairing state implicitly.

The human canary uses a normal owner-controlled browser: PIN login, a fully
hydrated component baseline, sign-out, **Continue with Google**, the exact same
Firebase UID/trainer account, and a fully hydrated component comparison. It
must also show normal App Check, healthy authority/gateway responses, and
unchanged wants, Favorites, groups, pending operations, public identity, and
account-sync ownership. Google must not be unlinked again merely to repeat the
already-passed Connect Google canary.

After release, read back exact HTML, client, service-worker, source, tag, and run
identity; confirm Google and PIN entry remain available; repeat the fresh
same-UID Google return; and recheck all component boundaries, authority/gateway
health, App Check, and false creation/public gates. Roll back to exact `.115` on
UID/account mismatch, lost PIN fallback, account switch/merge, attributable
product mutation, an enabled creation/public gate, authority/gateway security
drift, or App Check regression. Rollback never deletes Firebase users, unlinks
credentials, or rewrites identity mappings.

## Accepted residual limitations

The accepted `HUMAN-NEGATIVE-CANARY-AMENDMENT-v1.md` SHA-256 is
`203fd63d62a63d7751d6fa3bc5f262e7a1ba6c5a3f9e4bcc0b7b1ac874e0232c`.
Focused automated and failure-isolation coverage substitutes for these unavailable
physical cases and does not claim they were physically tested:

- human popup-block negative: automated only;
- human cross-account Google credential collision: automated only;
- brand-new Google identity human negative: unavailable.

PR #97, Discord, PIN retirement, provider-account creation, provider-public
capabilities, authority semantics, IAM, Rules, and App Check policy remain outside
this release.
