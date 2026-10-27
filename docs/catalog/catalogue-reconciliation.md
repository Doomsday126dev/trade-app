# Catalogue reconciliation and remaining release treatment

The candidate restores 342 base/default identities, 13 regional entries, ten released Dynamax identities and Caterpie wearing a Poké Ball hat. Three further regional art mappings are preserved for review. It fixes the Origin Giratina Shiny numeric-form resolver and duplicate base/Max names in the global picker. This is a repair batch and discovery safeguard, not a claim that the full backlog has been resolved.

## Independent coverage

| Source | Denominator | Role and limit |
| --- | ---: | --- |
| Official GO English/Korean news and current season | Current index links and Max cards | Announcements and dates; an announcement is not release eligibility. Indexes can omit old or locale-only articles. |
| Serebii GO generation/Hisui inventories | 1,333 rows | Normal species/forms and explicit unavailable markers. A missing marker is only a secondary release claim. |
| Serebii GO Shiny inventory | 1,363 rows | Shiny identity and availability claims. Duplicate labels can describe different sprite files and must remain ambiguous. |
| Serebii GO Max inventory | 138 species rows | Includes future announcements. 135 rows map to the app, including generic rows mapped explicitly to both Toxtricity/Urshifu forms; three remain announced for November. |
| Pokemod Pokémon subtree | 5,920 PNGs: 3,611 icons, 96 portraits, 2,213 legacy images | Art discovery, including pre-release files. These form 1,597 addressable groups and 1,112 legacy groups; groups can overlap in game identity. No release inference. The observed master commit is dated June 8, 2026; a successful current HEAD check does not make the miner's content newer. |
| Leek Duck events / GO Hub feed | Current returned links | Broader event discovery and archived release evidence; new links require review. |

PoGoAPI released/Shiny endpoints returned HTTP 403 during the earlier audit and remain excluded. They are not retried or accessed through an alternate route. The official Caterpie tweet also returned 403; its direct source is not retried. Its announcement is preserved in an embedded official post, and the archived Leek Duck event corroborates the released costume. The old official Tokyo URL now redirects to Mega Finale.

## One queue, existing workflow

`scripts/check-release-discovery.cjs` retains the existing official announcement check and adds the source observations/reconciliation helpers. The existing `sprite-catalog-freshness.yml` schedule produces **one** `catalogue-reconciliation.json` artifact plus its summary. No service, credentials, permissions, paid component or separate scheduler is introduced.

Each open item retains its source URL, discovery/observation time, canonical matches, art state, release state, priority and disposition. New or changed mined PNGs are flagged even when their file group already maps to an app identity. Source removals and alias changes remain review items. Different files with the same label cannot silently satisfy one another. An older `unavailable` art record becomes an urgent open item; that label cannot close it.

The default live check fails while review is needed; fetch, parse, hash or staleness failures are explicit. A PR's `--offline --report-only` mode checks cached integrity and publishes the open backlog without claiming live freshness. Source failures still fail that mode. The existing cadence is daily, not instantaneous discovery. An hourly lightweight source-only cadence is a follow-up option for the parent to review alongside alert volume; do not promise detection at the moment a sprite appears.

## Proposed treatment requiring product review

Keep a separate read-only **Upcoming / artwork catalogue**, with separate labels for **Artwork available**, **Announced**, **Released**, and **Release uncertain**. Show exact mapped normal/Shiny/gender artwork there as soon as it is verified. A mined file must not enable trade actions or assert obtainability. Uncertain mappings remain in the owner queue until their identity is established.

The current trade editor cannot express “normal released, Shiny artwork available, Shiny release unverified.” Normal Hisuian Zoroark debuted on July 8, 2025, but its Shiny release remains unverified. Hisuian Goodra and Hisuian Sliggoo are announced for the November 6–8, 2026 Sendai event, along with Dynamax Dialga/Palkia and Gigantamax Duraludon. Exact art/mappings are preserved without adding these as new released trade entries. Known eligibility holds remain explicit, including any entries already selectable in the older baseline. The parent should choose the read-only catalogue and per-variant eligibility treatment before enabling these entries. Existing future/battle-only entries also require that audit; this candidate does not retroactively claim they are tradeable.

## Remaining backlog

The generated queue contains alias ambiguities, source-only identities, exact-art verification, legacy file-number mappings, and seven older unresolved art labels. Its row count is not a count of missing Pokémon. In particular, Mega/Primal/battle-only forms, normal-only releases, costume-size combinations, true gender-only releases and newly mined identities still need release/identity review. Do not clear these by guessing a generic form or substituting normal art for Shiny art.

The source/art checks and focused regression tests are deliberately separate from release eligibility. Exact artwork is verified by provenance, hashes, decoding and renderer paths; main-series existence alone never authorizes a GO release claim.

The Alolan Raticate selectable addition is held separately: its default normal/Shiny form art is verified, but the direct female-art source returned HTTP 403. That check stopped without a retry or proxy. Its exact female art or explicit same-form gender equivalence needs independent verification; the gap is visible in the owner queue.
