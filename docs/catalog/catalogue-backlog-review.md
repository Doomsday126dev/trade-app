# Backlog review after the frozen .154 repair candidate

The .154 candidate `b44e842d2a1f514f6cd1bc4a4e8983738b0ce637` remains unchanged. This follow-up branch changes discovery/review artifacts only. It does not enable any new trade entry, change a saved identity or deploy staged artwork.

## Qualified local follow-up

Based on live .154 runtime `cdf0171c08508940a34f53df2eb6653e878b2574`, the follow-up adds fifteen standard identities with official normal-release evidence and two exact costumes. All 1,346 existing seed rows are byte-for-byte preserved as objects; no existing user choices or labels change. The candidate is not published by this task.

Normal and Shiny wants remain selectable for all fifteen standard identities. Their exact normal/Shiny HOME originals are independently decoded and hash-pinned. The small `reviewed-variant-status.json` register records evidence, not permission to request an entry. “Release unverified” appears in the existing personal, shared and exported views for their Shiny variants. It does not claim confirmed unreleased or unavailable. No artwork preview interface or new request restriction ships.

| Identity | Normal GO evidence | Shiny GO evidence | Exact artwork |
| --- | --- | --- | --- |
| Sinistcha | [Released](https://pokemongo.com/news/halloween-part-1-2025) | Unverified | Normal + Shiny verified |
| Dottler | [Released](https://pokemongo.com/news/bug-out-2026) | Unverified | Normal + Shiny verified |
| Orbeetle | [Released](https://pokemongo.com/news/bug-out-2026) | Unverified | Normal + Shiny verified |
| Drakloak | [Released](https://pokemongo.com/news/go-out-galar-region) | Unverified | Normal + Shiny verified |
| Dragapult | [Released](https://pokemongo.com/news/go-out-galar-region) | Unverified | Normal + Shiny verified |
| Naclstack | [Released](https://pokemongo.com/news/journey-to-paldea-2025) | Unverified | Normal + Shiny verified |
| Garganacl | [Released](https://pokemongo.com/news/journey-to-paldea-2025) | Unverified | Normal + Shiny verified |
| Eldegoss | [Released](https://pokemongo.com/news/spring-into-spring-2025) | Unverified | Normal + Shiny verified |
| Boltund | [Released](https://pokemongo.com/news/yampers-paw-prints-2025) | Unverified | Normal + Shiny verified |
| Carkol | [Released](https://pokemongo.com/news/winter-holiday-part2-2025) | Unverified | Normal + Shiny verified |
| Coalossal | [Released](https://pokemongo.com/news/winter-holiday-part2-2025) | Unverified | Normal + Shiny verified |
| Barraskewda | [Released](https://pokemongo.com/news/water-festival-2026) | Unverified | Normal + Shiny verified |
| Spidops | [Released](https://pokemongo.com/news/enchanted-hollow-2025) | Unverified | Normal + Shiny verified |
| Espathra | [Released](https://pokemongo.com/news/spring-marathon-2026) | Unverified | Normal + Shiny verified |
| Houndstone | [Released](https://pokemongo.com/news/halloween-part-1-2023) | Unverified | Normal + Shiny verified |

The [2026 Halloween announcement](https://pokemongo.com/news/halloween-part-2-2026) announces Shiny Greavard for November 1. This is related evolutionary-family evidence, not an explicit Houndstone Shiny announcement; Houndstone's own Shiny state remains unverified pending confirmation. The monitor flags new source Shiny-release claims for these identities for review even when artwork already matches.

**Gimmighoul (10th Anniversary Coin)** is resolved with independently labelled [Dittobase original normal/Shiny art](https://www.dittobase.com/pokemon-go/pokedex/gimmighoul-10th-anniversary-coin) and the [official July release](https://pokemongo.com/news/10th-anniversary-party). The original normal image differs from the independently labelled ninth coin by 1,206 decoded pixels on the same canvas. It does not reuse the ordinary or ninth coin icon. Gimmighoul is genderless.

**Pikachu (Blue Shirt (Citrus))** has four exact male/female normal/Shiny originals, [historical GO Hub release evidence](https://pokemongohub.net/post/event/pokemon-air-adventures-jeju-island-south-korea/) and independent Serebii/PokémonDB art evidence. The original official event URL's 404 remains recorded. It is a new explicit costume and does not reinterpret saved generic Jeju labels.

## Remaining urgent additions

Further independent Dittobase form inventory review found two distinct regional costumes with four original decoded assets each (normal, Shiny, female, female Shiny). They are retained as urgent actionable entries with source hashes and discovery times in `identity-reviews.json`; all eight unmodified PNGs are staged. They are not aliases of the existing Malaysia or Singapore costumes.

- **Taiwan pink-hair Pikachu:** dedicated event October 10–11, 2026, already past. [Official regional announcement](https://pokemongo.com/news/event-apac-30th-anniversary-2026), [exact form page](https://www.dittobase.com/pokemon-go/pokedex/pikachu-anniversary-2026-taiwan-01).
- **Philippines orange-hair Pikachu:** dedicated event January 23–24, 2027, announced. [Exact form page](https://www.dittobase.com/pokemon-go/pokedex/pikachu-anniversary-2026-philippine-01). Earlier cross-region stamp obtainability is unverified; a future dedicated event date alone does not establish that the variant cannot already be obtained. Available art must remain available for wants with passive evidence labels when integrated.

Final canonical display labels and integration of these two additions remain the next review unit. Bangkok is announced for February 2027 but no exact Thai mapping is established here. Do not merge these distinct regional labels based only on “PokéXciting.” Hisuian Zoroark Shiny evidence and upcoming Hisuian Goodra retain the earlier explicit review states.

## The 2,799 source rows

Every original row remains in the raw artifact, with its original variant/source disposition. Grouping reduces those rows to 2,195 review groups; these are not necessarily distinct game identities.

| Review category | Raw rows |
| --- | ---: |
| Original confirmed missing identities (now qualified locally) | 18 rows for 17 identities |
| Known identity aliases | 134 rows for 113 source names |
| Existing identity, exact-art qualification pending | 1,119 |
| Source or canonical identity ambiguity | 88 |
| Other identity/release evidence review | 124 |
| Mined asset identity review | 1,121 |
| Battle-form eligibility review | 95 |
| Upcoming release review | 8 |
| Older identity/art blockers | 7 |
| News/event discovery leads | 85 |

Alias evidence uses previously reviewed exact-source references or the existing costume/form metadata plus explicitly reviewed wording. It does not approve a normal/Shiny/gender artwork substitution or assert current release. Ambiguous names such as generic Jeju, location-only PokéXciting labels, unspecified Polteageist form and costume sizes remain open. No missing-asset issue is closed using an `unavailable` disposition.

The compact owner view is added to the existing `catalogue-reconciliation.json` and Markdown summary. It references every retained raw row ID, checks alias species/name consistency, and leaves the original non-green status unchanged. Offline output omits the 85 live news/event leads by design and is labelled offline; the 2,799-row analysis uses the preserved live report from 2026-10-27 08:28 UTC.

## Exact artwork staged

The original research batch in `proposals/catalogue-art-review/` contained 38 unmodified PNGs: normal/Shiny pairs for the fifteen standard identities, Citrus Shirt Pikachu, Golbat with a top hat, Crobat with a top hat, and Polteageist with a bow. `data/catalogue-sources/staged-art.json` records source URLs, timestamps, SHA-256, positive upstream Git blob matches where available, dimensions, alpha-pixel counts and decoded pixel checks. All 38 decode, all 19 normal/Shiny pairs differ, and none is empty. The original-image contact sheet was visually reviewed.

The three costume evolutions remain release/identity reviews. Today's official Halloween announcement names the base Zubat/Sinistea costumes, but does not establish those evolutions. Antique and Phony bow Polteageist share one source image; do not assign it to a specific form from the picture alone. These files are outside the frontend manifest and are not shipped or made tradeable by this branch.

## Max coverage and source limits

The existing Max-page parser now checks its Gigantamax section separately. Both sections share one page request. Sixteen Gigantamax species in that secondary table are present in the app. The app has fifteen other Gigantamax entries requiring official release review; absence from this table is not evidence of absence from GO. For example, an official 2025 Garbodor Max Battle Day announcement exists even though this table omits Garbodor. No existing saved entry is removed by this review.

The three unmatched Dynamax species remain the already documented November announcements: Meltan, Melmetal and Regidrago. Their exact-art/upcoming treatment remains open.

An additional read-only evidence check found the public PokeMiners HEAD at `c2a686eb08ace6e890d8fe3d2134c76988db87b5` (October 8, 2026), newer than Pokemod's June 8 HEAD. Its complete Pokémon subtree contains 5,733 PNGs; all paths also exist in the 5,920-PNG Pokemod inventory, with different content hashes. Therefore path overlap is not proof of identical artwork. The observation is retained for source review; no second scheduler or monitoring framework is introduced.

The denied female Alolan Raticate URL was not retried or accessed through another route. Its optional female-art issue remains open. The previously denied PoGoAPI endpoints also remain excluded.

## Current denominator and limits

After the seventeen candidate additions, the cached-source reconciliation reports normal inventory 1,333 rows: 1,111 identity matches, 26 ambiguous and 196 unmatched; Shiny inventory 1,363 rows: 1,146 matches, 63 ambiguous and 154 unmatched. Dynamax is 135/138; Gigantamax is 16/16 for its incomplete secondary table. Pokemod covers 1,597 addressable file groups (920 mapped, 677 unresolved), plus 1,112 legacy groups (682 mapped, 430 unresolved). Matching is identity presence only, not blanket art/release approval.

The current offline monitor queue has 2682 rows and no cached-source integrity/staleness failure at qualification time. It deliberately omits 85 live news leads; compare it only with the original offline run, not the 2,799-row live baseline. It remains review-required. The newer PokeMiners tree and Dittobase regional inventory checks are supplemental, not claimed as a continuously monitored complete independent source. Existing monitoring retains failure states and the unmatched queue. No new scheduler, account, credential or paid service is introduced.
