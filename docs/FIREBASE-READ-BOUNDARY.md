# Firebase read boundary

## Phase 1 status

Phase 1 adds an inert client boundary around future Firebase reads without
changing any production subscription or screen data source. The compatibility
flag `NARROW_READ_CLIENT_ENABLED` remains `false`. The existing `_activeSubs`
and `subscribePath` implementation remains the active production path until a
later, separately reviewed migration.

The authenticated root read is also unchanged. This foundation is not evidence
that narrow production rules are ready to publish.

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
- `screen`: reads owned by a currently mounted screen, including lazy lists.
- `selectedTrainer`: one opened trainer/profile/share context.
- `legacyAdmin`: retained maintenance reads that require explicit admin cleanup.

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
