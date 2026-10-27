# Backlog review after the frozen .154 repair candidate

The .154 candidate `b44e842d2a1f514f6cd1bc4a4e8983738b0ce637` remains unchanged. This follow-up branch changes discovery/review artifacts only. It does not enable any new trade entry, change a saved identity or deploy staged artwork.

## Qualified local follow-up

Based on live .154 runtime `cdf0171c08508940a34f53df2eb6653e878b2574`, the follow-up adds fifteen standard identities, two previously held Hisuian forms and four exact costumes. All 1,346 existing seed rows are byte-for-byte preserved as objects; no existing user choices or labels change. The candidate is not published by this task.

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

## Integrated regional and Hisuian identities

Taiwan and Philippines are integrated as separate canonical regional costumes, each with four original decoded images (normal, Shiny, female, female Shiny). The final labels are **Pikachu (PokeXciting Taiwan)** and **Pikachu (PokeXciting Philippines)**, with reviewed color/region source aliases in the art catalogue. Existing Malaysia and Singapore identities are preserved.

Taiwan's dedicated event occurred October 10–11, 2026, with independent GO Shiny inventory corroboration. Philippines' dedicated event is January 23–24, 2027. Its earlier cross-region obtainability is unverified; the registry says Announced for both variants, allows wants, and retains a conflicting secondary release claim for review. Sources: [official APAC announcement](https://pokemongo.com/news/event-apac-30th-anniversary-2026), explicit [Taiwan](https://www.dittobase.com/pokemon-go/pokedex/pikachu-anniversary-2026-taiwan-01) and [Philippines](https://www.dittobase.com/pokemon-go/pokedex/pikachu-anniversary-2026-philippine-01) art pages.

The previously held **H-Zoroark** and **H-Goodra** are also integrated using the cached, byte-verified exact form IDs 10239 and 10242. Hisuian Zoroark's normal release is established; its Shiny state remains unverified. Hisuian Goodra remains Announced for normal and unverified for Shiny. Both variants remain selectable for wants. Only default art is qualified; optional gender choices are not offered as new verified options and saved choices are preserved. This is not a genderless assertion.

## Actual remaining canonical absence

The practical reconciliation now lists **67 absent source identities**, individually named with provenance and explicit next actions in `identity-reviews.json`: 64 standard/form/costume identities plus three announced Dynamax identities. The 64 are absent from the complete current app identity inventory after removing reviewed aliases and separating ambiguous/default labels and represented gender options. It is a canonical absence count, not a blanket claim of GO release or exact-art qualification.

Of the other unmatched non-Mega/Primal/Eternamax units, six are battle/transformation eligibility questions, five are existing gender options whose exact routes need qualification, and four are ambiguous existing defaults/year labels. These remain visible. Nine newly reviewed identity aliases add thirteen source rows to the existing alias review, for 147 alias rows total; no raw art/release row is erased by that classification. Mega/Primal/Eternamax and remaining miner groups retain separate coverage limits.

The remaining normal-only gaps include Victini, Gastrodon, Sandaconda, Kilowattrel, Mabosstiff, Brambleghast, Glimmora and Dudunsparce. Those source-listed release claims still need independent release checks and exact normal/Shiny byte qualification. Source entries with uncertain GO release, such as several newer species and forms, remain distinct from confirmed released gaps. Do not turn an uncertain release into an unavailable state or block an early want.

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

## Coverage limits

Normal, Shiny, Dynamax and Gigantamax source denominators remain 1,333 / 1,363 / 138 / 16. Gigantamax's secondary table is incomplete. Pokemod has 1,597 addressable groups and 1,112 legacy groups. Canonical identity matching never automatically approves exact variant art or released/tradeable status.

The source-backed missing list now complements the retained raw queue. The independent inventories still do not fully reconcile. The current offline monitor deliberately omits 85 live news leads and must not be compared with the 2,799-row live baseline as if every difference were a resolved identity. It remains review-required. The newer PokeMiners tree and Dittobase checks are supplemental, not continuously monitored complete sources. The existing scheduled check remains daily; no new scheduler, credentials, permissions or owner-alert publication change is introduced here.

Final cached reconciliation after all twenty-one additions: normal 1,113/1,333 identity matches (26 ambiguous, 194 unmatched); Shiny 1,148/1,363 (63 ambiguous, 152 unmatched); Dynamax 135/138; Gigantamax 16/16 for the incomplete secondary table. The offline monitor retains 2,679 raw rows in 2,076 groups, with 147 identity-alias rows and 67 individually named absent canonical identities. No cached source-integrity/staleness failure was observed at qualification; this is not a live-source success claim.

The 67 absence entries carry distinct evidence states: 50 secondary released-source claims requiring independent confirmation, 14 uncertain, and 3 announced Max entries. Their source sprites are listed but exact bytes are not yet qualified, unlike the integrated candidates. Artwork and release must be checked independently before integration; no entry is closed as unavailable.
