# Firebase read boundary

## Phase status

Phase 1 added an inert client boundary around future Firebase reads. Phase 2
moved listener/cache ownership behind verified UID and username boundaries.
The owned-data candidate then proved exact reads for the current profile, four
list types, inventory, auth index, memberships, and pending decrements.

Phase 2 moves listener ownership, but not paths or snapshot behavior, to the
subscription manager. `loginDirectory` uses the persistent `public`
scope, authenticated broad listeners use a UID/username-fingerprinted `session`
scope, and share listeners use `selectedTrainer`. The legacy `_activeSubs` and
`_activeShareSubs` maps are removed so the same logical listener cannot run in
both systems.

The same phase replaces legacy `pogo3` with a `pogoSessionCache_v2` envelope containing an anonymous-safe
`public.loginDirectory` section and one protected partition tagged by both
Firebase Auth UID and username. `pogoSyncQueue_v2` uses the same two-part owner
identity. Explicit logout removes protected persisted data and pending writes;
transient auth loss locks them until the exact same identity returns. Partial
UID/username matches fail closed. Legacy protected snapshots are discarded and
legacy unowned pending writes are discarded with a translated warning rather
than attributed to the next login.

Selected-trainer snapshots remain runtime-only and are never written into the
shared public or protected cache.

The trainer-first interim activation now runs with
`NARROW_READ_CLIENT_ENABLED=true` and `LEGACY_BROAD_READS_ENABLED=false`.
Community-wide Browse, trainer enumeration in Strings, Inventory Community
Browse, Offers, Trade Match, and personal Schedule are retired from navigation
instead of recreating their broad architecture. Selected trainers load only
`publicShares/{username}`. Retained owner maintenance collections start only
when the protected owner opens Admin, use `legacyAdmin`, and stop when Admin
closes, on logout, or on auth loss.

The authenticated root read is still unchanged. Client activation reduces the
dependency surface but is not evidence that narrow production rules are ready
to publish.

## Module boundaries

- `js/services/firebaseClient.js` wraps injected Firebase SDK `ref`, `get`, and
  `onValue` functions and returns stable `{ok, ...}` or `{ok:false,error}`
  results.
- `js/data/subscriptionManager.js` owns listener keys and the `session`,
  `screen`, `selectedTrainer`, and `legacyAdmin` lifecycles. It suppresses stale
  callbacks after replacement or cleanup.
- `js/data/firebaseReadRegistry.js` records every current read surface, method,
  breadth, owner scope, audience, consumer, and retirement status.
- `js/data/currentUserRepository.js` defines exact owner-record paths for a
  future narrow-read client.
- `js/data/publicShareRepository.js` defines exact legacy public-share reads.
- `js/domain/cacheAdapters.js` applies exact-record snapshots without mutating
  the source cache.
- `js/i18n/core.js` and `js/i18n/locales/en.js` provide stable translation keys,
  English fallback, complete-message interpolation, and a separate Pokemon-name
  catalog boundary.

Repositories do not render UI. Cache adapters do not access Firebase. The
listener manager does not know database paths. The locale layer does not define
stored paths, enums, scopes, error codes, or domain identifiers.

## Listener ownership

Each future subscription has one logical key and one owner scope:

- `session`: authenticated-session reads; cleared on logout or auth loss.
- `public`: anonymous-safe app-lifetime reads such as `loginDirectory`.
- `screen`: reads owned by a currently mounted screen, including lazy lists.
- `selectedTrainer`: one opened trainer/profile/share context.
- `legacyAdmin`: retained maintenance reads that require explicit admin cleanup.

## Cache inventory

| Data | Classification | Phase 2 storage |
|---|---|---|
| `loginDirectory` | public | `pogoSessionCache_v2.public.loginDirectory` |
| `users`, lists, `have`, offers, trades, requests, auth/community indexes | protected/session-owned | `pogoSessionCache_v2.protected.data`, gated by exact UID and username |
| Public-share and authenticated selected-trainer snapshots | selected-trainer runtime-only | memory only |
| Owner maintenance snapshots | legacy-admin/session-owned | protected partition while retained |
| Pokémon catalog and sprite metadata | static/non-Firebase | unchanged existing catalog/cache locations |
| Legacy unowned `pogo3` protected fields | obsolete/unsafe | discarded during v2 migration |
| Legacy unowned `pogoSyncQueue_v1` entries | obsolete/ambiguous | discarded; never replayed |

Subscribing the same key, scope, and fingerprint is idempotent. Reusing a key
with different ownership or identity replaces and unsubscribes the previous
listener. Cleanup is available by key, by scope, or globally. Callback tokens
prevent a detached listener from updating current state.

## Static read registry

Run `npm run check:firebase-reads`. The check validates the explicit registry
and locks the current direct `get`/`onValue` calls and broad subscription set.
Introducing a new Firebase read without registering it fails the check. This is
a transition guard, not an endorsement of the broad reads recorded there.

Each registry entry contains:

```text
id, path, method, breadth, ownerScope, audience, consumers, status
```

`status` is one of `retained`, `transitional`, or `planned_retirement`.

## Locale foundation

New refactor UI states must use stable translation keys and complete messages
with named placeholders. English is the fallback catalog. Additional catalogs
such as `ja`, `es`, and `de` can be loaded without changing domain or data
modules. Pokemon-name localization remains a separate catalog because species
names and interface language have different sources and release cadence.

Phase 1 adds no new user-facing states and does not translate existing UI.

## Owned-data exact-read activation

The next candidate adds `ownedDataCoordinator` on top of the existing
current-user repository and listener lifecycle. It can subscribe to the signed-in
owner's exact profile, four list types, inventory, auth index, membership index,
and pending-decrement bucket while preserving the existing global cache shape.
Listener and payload instrumentation records only surface names, counts, and
serialized byte totals; it does not record paths, usernames, UIDs, or payloads.

Activation is deliberately mutually exclusive:

```text
NARROW_READ_CLIENT_ENABLED=true
LEGACY_BROAD_READS_ENABLED=false
```

Exact owned reads run only in this combination. Broad collections remain in the
registry for rollback and protected owner maintenance, but they no longer start
for ordinary sessions. My List and own Strings use exact owned lists. Legacy
Inventory is read-only with CSV export. Events uses the external event feed and
does not render personal trades or quotas. Cross-trainer viewing/comparison uses
one runtime-only public projection and never falls back to another trainer's
private `users`, list, or inventory paths.

Rollback is a flag/revert return to the legacy broad path and navigation. No
Firebase records are deleted or migrated. The versioned session cache uses the
same data shape in both modes, so Firebase can rebuild discarded snapshots.
