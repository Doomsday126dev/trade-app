# Who wants this? (.95)

Built from accepted production .94. The existing Find by Pokemon screen becomes
Who wants this? under Trainers; Groups also offer a shortcut preserving the group
scope. No new top-level navigation or parallel reverse-lookup screen.

Choose All Favorites or one existing private group, search/select a Pokemon using
the existing localized catalog autocomplete, then optionally choose a published
wanted variant. Results show trainer, structured variant, priority, notes,
publication age and the viewer's private group labels. Matching trainers appear
before the existing localized Pokemon GO search-copy utility.

## Honesty and scope

Default results explicitly include all published variants of the selected species.
They do not claim an exact costume/form match. Exact selection is deliberately
restricted to identities actually present in currently permitted published wants.
Matching uses the existing wantedIntentKey: name/form, category (including Max/GMax),
gender, modifier and supported flags. Priorities and notes remain visible but do
not collapse identity. Equality is of published structured fields, not proof of
unpublished details, ownership, inventory, availability or trade eligibility.
Legacy projections cannot prove omitted exact qualifiers. Notes require review.

An exact selection that disappears or becomes unavailable returns no matches; it
never broadens automatically. A deleted group similarly remains unavailable rather
than expanding to All Favorites. Results render in bounded pages of 60 trainer-want
rows; game search covers the full matching scope using the existing split serializer.

## Boundaries

Reuses .93/.94 groupWants, publicShareProjectionStatus, listSnapshot adapters and
Favorite session cache; the old species-collapsed result renderer is removed.
Existing catalog autocomplete and bounded public hydration are retained. Selection
and filtering consume the session aggregate locally. No new persisted state,
backend, index, authorization rule or cross-user read path. No history acknowledgement
occurs during lookup. Group membership/history persistence is unchanged.

Old still-public wants remain visible with publication-age information. Private,
revoked, failed and five-minute-expired reads cannot contribute. Target UID binding,
account/session generation and click-time copy fences remain. Unavailable trainers
are listed separately, never as positive matches. Existing anonymous share behavior
is unchanged; this signed-in Favorite utility does not enrich anonymous projections.

No inventory, For Trade, quantities, ownership inference, identity/PIN/provider,
recovery66, Events or PR63 operations. The 21 unsupported costume selectors are not
reintroduced. Broader discovery would require a separately designed opt-in discoverability
and permitted index contract; shared groups/invitations are not required here.

## Focused qualification

Domain coverage includes species vs exact matching, missing/unknown identity,
gender/shiny/category distinctions, revoked/expired exclusion, older-public inclusion
and no FT. Browser journeys exercise keyboard selection, group filtering without
new reads, priority/notes, copy, exact selection disappearance, revocation, expired
copy and deleted group fail-closed behavior on desktop/mobile. Existing Groups,
history and contextual-search journeys remain in the focused suite.
