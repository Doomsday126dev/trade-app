# Max icon preview and bounded form repairs

Local review candidate only. Based on catalog repair 1064b4bfd5311a4d631737e237e8893e3920bda7; no production mutation.

Green Core Minior is a separate selectable form; generic Minior records are unchanged. Published pinned green-core PNG inspected; no Shiny file assigned. Official event establishes the release family; GO Hub explicitly corroborates Green Core's October 19 debut. No other cores enabled.

Cinderace and Charizard use reviewed actual Gigantamax normal/Shiny assets. Cinderace October 3 Shiny release evidence and exact source URLs, original hashes and review notes are in data/max-presentation-asset-review.json. Existing catalog records and normal references were not replaced.

Display-only Max suffix removal affects My List and current canvas share-image rendering. Full canonical dataset names, search and text exports remain intact. Icons carry full alt/title labels in the editable list. Outlined Dynamax and filled Gigantamax PNGs come from the recorded immutable community icon source. No generated Pokemon art.

Synthetic comparison captures hold art constant on both sides to isolate presentation. They include Shiny female Dynamax Deino, male Dynamax Sizzlipede, Shiny male Gmax Charizard, Shiny female Gmax Cinderace and ordinary Pikachu. Canvas export uses actual app renderer. Phone control Pikachu remains an unavailable-art placeholder in the existing fixture; canvas control has original Pikachu artwork.

Qualification: Chromium and WebKit sample tests passed; 67/68 focused tests passed before the public-dex whitespace optimization, and the remaining size test is rerun separately. Initial aggregate found 10 failures; nine were fixed via explicit inventory counts/provenance routing, preserved-hold fixture coverage, harness helper loading and bounded public-dex compaction. Final aggregate required before release; no thresholds raised.

Library comparisons: libfile_808f7e4a75248191a8d4a0fa95aa2000 (phone), libfile_dbf780b6b6f0819199a28a74977f5dcb (canvas image).

Final qualification update: aggregate 1,976 passed / 12 existing skips, with four stale inventory/parser expectations subsequently corrected. Focused contract reruns cover those four; public dex is 34,997 bytes under the unchanged 35,000-byte limit. The initial aggregate failures were resolved without changing behavior assertions or budgets. Full protected release qualification is still required before publication.

## Shiny presentation revision

The saved Shiny flag survived model projection. The generic `publicSpriteUrls` helper ignored its Shiny argument when constructing HOME URLs; the export helper additionally prepended normal-color high-quality candidates. Standard Shiny requests now build only Shiny URLs, and export returns that color-specific chain before any normal-color preference. Reviewed costume and Gmax assets retain their earlier exact-variant path. Missing exact art remains unavailable.

My List and shared-card decorative Shiny badges are replaced with screen-reader text; canvas Shiny starbursts are removed. Max icons appear once at the sprite corner. Input/selection controls, filters, text exports and saved flags remain unchanged. The sample adds female Shiny Eevee with verified original female artwork and checks the actual decoded image URL.

`apri-shiny-marker-followup.patch` is a separate, unapplied presentation-only follow-up for PR179. Its explicit pink shared-card Shiny label and My List trait occur at source lines 12813 and 499 in the preserved redesign. Apply the shared resolver correction with this integration before removing those labels. The patch does not activate auth or deploy the redesign.

## Optional gender preference qualification

Stored `gender` or a legacy gender qualifier is a trade preference. Catalog `availableGenders` and the sprite resolver's single-gender default affect eligibility/art only; they are not copied into saved requests. Existing saved qualifiers cannot prove historical user intent beyond their stored value, so none are migrated or erased.

Added `tests/gender-preference.spec.js`: ordinary Eevee and female-only Orange Hanbok are saved without a gender preference, reloaded through the normal account-sync fixture, and checked in My List, public declarations and export details. Hanbok still resolves to female artwork while its request stays empty. The existing Max preview explicitly selects male/female and covers their persistence and rendering. Those symbols in the approved sample were deliberate fixture requests, not inferred costume genders.

Release remains separate from PR179: confirm live baseline, freeze this runtime source, update exact-source/read-contract registration without changing guards/budgets/expiry, open the scoped PR, run required immutable CI and browser/performance qualification, merge only the qualified head, create immutable runtime/control release tags, dispatch the existing protected Pages workflow, approve its production gate only under matching authorization, then verify served source/assets and real phone/share/export journeys. Do not include auth or redesign changes. Stop any denied action rather than using another route.
