# Private Trainer Groups (.93)

## Scope and storage

Groups reuse existing Favorite `tagIds` and `tag` entities. No Groups schema,
cross-user membership, invitations, list copies, inventory, or backend activation.
The already-active canonical account-sync mutation authority queues tag CRUD and
Favorite membership patches. Legacy/local sessions retain UID-partitioned device
storage. Blocked canonical mutations do not fall back to local writes. The separate
dormant trainer-preferences repository remains disabled.

## Workflow

Trainers > Favorites > Private groups: create/select a group, rename/delete it,
choose members from saved Favorites, and refresh wants. All wants and Top wants
filter the permitted aggregate. Each variant identifies its wanting trainers and
their priorities. Member names open the existing Favorite trainer workflow.
Deleting a group does not delete Favorites or anyone's wants.

The former Favorite tag organizer now uses Group terminology and the same IDs.
Its per-trainer assignment shortcut remains, not a second grouping model.

## Privacy and freshness

Only validated public-share projections from the existing bounded Favorite cache
feed aggregation. v2 declarations retain exact qualifiers; v1 uses the production
declaration adapter. The species-collapsed browse index is not the aggregate source.
There is no private list fallback. UID binding and session/generation fencing are
retained. A changed account or group cannot receive a previous group's late result.

Opening/refreshing a group rechecks selected members, with the existing cache's
four-request concurrency and five-second deadline. Results are an as-of snapshot,
not a live subscription. Reads older than five minutes, publications older than
30 days, unknown/future timestamps, private and inaccessible publications do not
contribute. Members remain visible as unavailable. Copy rechecks snapshot freshness
and current membership before using the rendered query.

Public wants are held only in session memory, never copied into group storage.
The existing honest, localized Pokemon GO serializer handles query splitting and
manual verification. Search does not prove ownership or ability to meet a want.
Unsupported costume art remains excluded from selectors; no fallback art added.

## Qualification

- Focused domain, cache, Favorite/tag projection, localization and search tests.
- Desktop/mobile group CRUD, membership, Top scope, attribution and copy.
- Canonical entity routing and blocked-write no-fallback proof.
- Expired copy rejection and late-response account isolation.
- Existing contextual-search desktop/mobile regression journeys.
- Reviewed mobile/desktop screenshots; no horizontal overflow.
- Normal Pages release coherence and required PR checks.

No identity, recovery66, PIN-reset, provider, Events, public-share publication or
PR #63 operator changes. No real trainer test data is written.

## Future boundary

Truly shared groups would need an independently designed authorization model,
invitations, membership revocation and explicit per-trainer sharing consent. They
must not own or edit member lists. This release deliberately remains a private
organizational lens over saved trainers.
