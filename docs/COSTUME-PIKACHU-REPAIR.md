# Costume Pikachu repair — local, not released

Branch `fix/costume-pikachu-search`, based exactly on production .137 (`0bfa8e08`). No redesign files, production account writes, push, merge or deployment. The proposed redesign is abandoned.

## Confirmed causes and changes

- Live application source was read without account access. SHA256 `4422637269d3383e01bc8f7e211c4c9c07ac4901b1f6673f654952675216448d`; it contains the exact-art-only eligibility gate and no released-identity exception. The gate dates to commit `3f47948f` (September 5, .91). This is pre-existing behavior, not caused by the unshipped redesign.
- Autocomplete reused artwork availability as identity eligibility. Nine audited released Pikachu identities were therefore excluded from add choices. Eligibility now accepts only explicitly audited released identities, while sprite resolution still returns no image for unavailable art. Ambiguous/unverified names are not admitted.
- Costume search facets and reviewed aliases are added to search metadata and active datalist labels. Names and canonical IDs are unchanged. Native suggestion matching differs by browser/OS; tests check the actual prepared suggestions and existing ranking logic, not physical mobile keyboard popups.
- Astronaut Pikachu was still announcement-only despite its October 4 debut. Added a released catalog entry using the ordinary stable legacy catalog ID, not an invented game form identifier. No migration or rewriting existing entries.
- A verified female image no longer falls back to default-gender art after failure. Every Pikachu alias chain is checked against its exact reviewed catalog record; a failed costume image must end in a labeled no-image state, never base Pikachu or a different costume.

## Primary evidence and current coverage

Official sources read October 25:
- https://pokemongolive.com/en/news/world-championships-event-2026 — Cosmog Spacesuit and Worlds2026 debut, both Shiny possible.
- https://pokemongolive.com/en/news/world-space-week-2026 — Astronaut debut October4–10, Shiny possible.
- https://pokemongolive.com/en/news/ultraunlock-10th-anniversary-edition — Professor Willow assistant, Shiny possible.
- https://pokemongolive.com/en/news/patterns-of-the-wild-2026 — Batik reuse; existing exact costume art, not a new invented costume.
- https://pokemongolive.com/en/news/halloween-part-1-2026 — Hat-and-capelet debut October27 remains upcoming as of review, not silently treated as released or mapped to another Halloween outfit.

The approved gallery https://pokemondb.net/sprites/pikachu was read through web research; its existing captions and repository provenance were compared to labeled local contact sheets. A direct byte-audit request returned HTTP403. It was stopped, with no alternate user-agent/proxy/source workaround and no new artwork downloads. Current global costume completeness and separate Shiny-art availability therefore cannot be certified.

Included Pikachu artwork catalog:105records,90exact mapped records,15unavailable;166distinct existing local default/female images decoded in each engine. Four labeled contact sheets under `/tmp/costume-pikachu-investigation/Pikachu-map-1.png` through `-4.png` were visually inspected. No obvious cross-costume mismatch was confirmed from the stored source captions, but this is not an independent exhaustive current-source identity certification. Intentional aliases such as Scuba/Worlds2024 share one reviewed identity; unchanged historical year aliases are not automatically assumed correct merely because HTTP succeeds.

## Explicit unresolved art / identity gaps

Released and selectable, but NO exact reviewed art: Cosmog Spacesuit; Fossil/Excavator; Instinct; Marathon; Mystic; PokeXciting Turquoise; Professor Willow's Assistant; Valor; Worlds2026; Astronaut. These remain no-image states. Adding them is not presented as a completed sprite fix.

Unverified or ambiguous and excluded from new selections: Gloria; GOFest2023 (unspecified crown color); GOFest2024 (unspecified Sun/Moon crown); Jeju; Victor. Existing saved records are retained.

Separate Shiny costume images are not represented by the existing reviewed artwork schema. Shiny wanted flags survive save/reopen/public projection, but normal artwork is not certification of Shiny art. This patch does not claim to have delivered complete exact Shiny imagery. Where a record has no separate female asset, default-art gender certification also remains a data-review limitation; no new inferred gender mapping is introduced.

## Tests and limits

- Targeted Chromium/WebKit tests exercise actual current editor add, Shiny flag persistence, canonical runtime acknowledgement, IndexedDB reopen, public projection and public missing-art rendering. All166existing Pikachu images decode. Alias-chain and forced-load-failure checks prohibit cross-costume/base substitution.
- Existing catalog/freshness/search contracts retain integrity hashes and exact counts, updated for one newly verified released identity. Released eligibility is checked against the independent pending audit inventory. Female chain has an explicit regression assertion.
- Related costume-art browser test retains its image/missing-art assertions; stale hardcoded pending count and retired list-row selector were updated to current inventory/UI.
- Backend transport is synthetic. No claim of a real production server write, physical-device verification or complete release qualification. No production test data were created.

Evidence logs: `/tmp/costume-pikachu-investigation/`. Before release: resolve the required exact-art coverage gaps with approved, verifiable assets or explicitly agree the narrower search/add-only release; inspect any concrete mixed-sprite examples from the user; run normal release gates and obtain explicit publication/deployment approval. Do not release this as 'all costume sprites fixed'.
