# Backlog review after the frozen .154 repair candidate

The .154 candidate `b44e842d2a1f514f6cd1bc4a4e8983738b0ce637` remains unchanged. This follow-up branch changes discovery/review artifacts only. It does not enable any new trade entry, change a saved identity or deploy staged artwork.

## Actionable minimum

Fifteen standard identities are absent from the standard picker and have official normal-release evidence: Sinistcha, Dottler, Orbeetle, Drakloak, Dragapult, Naclstack, Garganacl, Eldegoss, Boltund, Carkol, Coalossal, Barraskewda, Spidops, Espathra and Houndstone. Their individual official URLs and cached response hashes are in `data/catalogue-sources/identity-reviews.json`.

The previous batch required both normal and Shiny inventory evidence before adding base identities. That excluded legitimate normal releases. The next repair should use a small reviewed per-identity variant eligibility register, extending the existing Shiny editor checks and save validation. Add normal entries after exact-art qualification; keep Shiny art available in the review/upcoming catalogue, with its release state explicit. Preserve existing saved Shiny conflicts rather than silently clearing them. An unverified Shiny release must not be described as definitively unreleased.

Two distinct costume gaps are also actionable:

- **Gimmighoul (10th Anniversary Coin):** the official [July 2026 announcement](https://pokemongo.com/news/10th-anniversary-party) confirms both costume and Shiny availability. Exact art remains urgent and unresolved. The current Serebii normal/Shiny inventories reuse `999-r.png` for ordinary Roaming Form and both anniversary coin labels. The [Leek Duck event](https://leekduck.com/events/10th-anniversary-party/) uses the ordinary `pm999.icon.png`, while PokémonDB lists only the 9th coin. Neither current miner tree establishes the 10th-coin identity. Never substitute the ordinary or 9th-coin sprite.
- **Pikachu (Blue Shirt (Citrus)):** a distinct missing costume, with normal/Shiny originals staged. [GO Hub's archived Jeju event report](https://pokemongohub.net/post/event/pokemon-air-adventures-jeju-island-south-korea/) and Serebii provide historical evidence. The original official event link returns 404; that failure remains recorded. Add an explicit new Citrus Shirt identity after final qualification. Do not reinterpret saved `Pikachu (Jeju)` values, which could mean a different balloon costume.

These seventeen identities are a confirmed minimum, not a completed whole-catalogue claim. The first fifteen have direct official normal-release evidence; the Citrus Shirt release currently has secondary archived evidence. Hisuian Zoroark's normal release is already tracked by the earlier hold and still needs the same variant treatment; it is not counted again here.

## The 2,799 source rows

Every original row remains in the raw artifact, with its original variant/source disposition. Grouping reduces those rows to 2,195 review groups; these are not necessarily distinct game identities.

| Review category | Raw rows |
| --- | ---: |
| Confirmed missing identities above | 18 rows for 17 identities |
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

`proposals/catalogue-art-review/` contains 38 unmodified original PNGs: normal/Shiny pairs for the fifteen standard identities, Citrus Shirt Pikachu, Golbat with a top hat, Crobat with a top hat, and Polteageist with a bow. `data/catalogue-sources/staged-art.json` records source URLs, timestamps, SHA-256, positive upstream Git blob matches where available, dimensions, alpha-pixel counts and decoded pixel checks. All 38 decode, all 19 normal/Shiny pairs differ, and none is empty. The original-image contact sheet was visually reviewed.

The three costume evolutions remain release/identity reviews. Today's official Halloween announcement names the base Zubat/Sinistea costumes, but does not establish those evolutions. Antique and Phony bow Polteageist share one source image; do not assign it to a specific form from the picture alone. These files are outside the frontend manifest and are not shipped or made tradeable by this branch.

## Max coverage and source limits

The existing Max-page parser now checks its Gigantamax section separately. Both sections share one page request. Sixteen Gigantamax species in that secondary table are present in the app. The app has fifteen other Gigantamax entries requiring official release review; absence from this table is not evidence of absence from GO. For example, an official 2025 Garbodor Max Battle Day announcement exists even though this table omits Garbodor. No existing saved entry is removed by this review.

The three unmatched Dynamax species remain the already documented November announcements: Meltan, Melmetal and Regidrago. Their exact-art/upcoming treatment remains open.

An additional read-only evidence check found the public PokeMiners HEAD at `c2a686eb08ace6e890d8fe3d2134c76988db87b5` (October 8, 2026), newer than Pokemod's June 8 HEAD. Its complete Pokémon subtree contains 5,733 PNGs; all paths also exist in the 5,920-PNG Pokemod inventory, with different content hashes. Therefore path overlap is not proof of identical artwork. The observation is retained for source review; no second scheduler or monitoring framework is introduced.

The denied female Alolan Raticate URL was not retried or accessed through another route. Its optional female-art issue remains open. The previously denied PoGoAPI endpoints also remain excluded.
