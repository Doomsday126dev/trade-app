# Pending Costume Artwork

Reviewed 2026-09-06 against production `2026-09-06.95`, main `1521b742819c574a12b346a6b9f7e3d1f4f04543`.

Before and after this audit: **376 canonical records, 355 exact, 21 unsupported**; 402 exact active costume rows and 21 excluded rows. No new art was accepted. Unsupported identities are excluded from active selectors; historical stored rows remain readable with honest unavailable artwork, never base-species substitutions. Backgrounds remain outside the active product. No identity migration or user-data change is part of this work.

The machine-readable review inventory is [pending-costume-artwork.json](../data/pending-costume-artwork.json). Every excluded identity now has a specific blocker, accepted source page, search terms, candidate disposition, next action and review date. The old .80/.86 comparison and claims that all gaps were valid, newly announced costumes were obsolete.

## Root Cause

- The accepted source itself has gaps: live comparison of all 127 captured species galleries found no new filenames compared with August 30. Pikachu's gallery reaches Worlds 2025 but not Worlds 2026. A release announcement does not mean accepted sprite publication.
- The old check ran monthly, compared filenames only, and reported "current" even when reviews were old. It had no fetch timeout, empty-parser guard, label diff, pending-candidate crosswalk or release-identity queue.
- Some art already exists but the legacy identity cannot choose it: generic festival, location and size labels are not deterministic costume mappings.
- Previous pending classifications included unsupported assertions: Gloria/Victor variants were not established; Slakoth's official visor was conflated with a nightcap; Jeju and GO Fest 2023 were incorrectly described as restricted-only artwork.
- There was no explicit promotion checklist connecting identity evidence, source review, local SHA-256, generated assets and browser checks.

The complete September 6 observation also exposed 260 label-format differences across 15 pages: gender caption order/case and duplicate gender tokens in the old normalized snapshot. Review found no changed costume meaning and no added or removed files. The snapshot is rebaselined to the actual parser output, with a fresh capture timestamp; none of these label-only changes authorizes new artwork.

## Source Decision

[Pokémon Database's Pikachu gallery](https://pokemondb.net/sprites/pikachu) continues to permit saving sprite files to one's own hosting. Retain the existing individually reviewed, self-hosted GO sprite boundary; do not copy its prose or layouts. This is source-site compliance, not a blanket license from the Pokémon rights holders.

[PokeAPI sprites](https://github.com/PokeAPI/sprites) remains an accepted base/form source, but its documented inventory does not supply exact GO versions of the 21 gaps. Its [current license file](https://raw.githubusercontent.com/PokeAPI/sprites/master/LICENCE.txt) has a CC0 repository statement while expressly retaining Pokémon image copyright; the former "no license file" statement has been corrected.

[Official news](https://pokemongo.com/news) establishes identity and availability, not permission to republish event images. [PokeMiners](https://github.com/PokeMiners/pogo_assets) is a useful discovery source but retains an educational-only disclaimer, so mined art is not imported. Serebii and GO Hub remain reference-only under [the existing provenance policy](ASSET-DATA-PROVENANCE.md); no new reusable-image grant was established. Search results and publicly accessible image URLs alone do not qualify a new source.

Worlds 2026 and Cosmog Spacesuit are distinct costumes confirmed in [the official August 25 announcement](https://www.pokemon.com/uk/news/pokemon-gos-2026-pokemon-world-championships-event). Both remain unsupported: the accepted gallery has neither exact costume, and official/mined artwork cannot be copied under the current policy. Do not map either to Worlds 2025, World Cap or each other.

## Remaining Inventory

14 accepted-source gaps, four ambiguous identities, three unverified legacy identities.

| Identity | Blocker | Next Action |
| --- | --- | --- |
| Pikachu (Cosmog Spacesuit) | PIKACHU_PXP_2026 is confirmed by the official Worlds announcement; no Cosmog/spacesuit GO sprite is listed in the live accepted Pikachu gallery. Official event imagery is reference-only. | Recheck Cosmog/spacesuit candidates; require the PXP costume, not the distinct WCS 2026 outfit. |
| Pikachu (Fossil) | The official museum event identifies Excavator Pikachu, but the accepted Pikachu gallery has no Excavator/Fossil sprite. Adventure and safari hats are different costumes. | Review an exact Excavator candidate against the museum identity; never substitute Adventure Hat. |
| Pikachu (Gloria) | No Gloria-labelled GO sprite exists in the accepted gallery and this audit found no authoritative announcement establishing the legacy Gloria costume. The previous multiple-variants claim was not substantiated. | Establish that this exact GO costume exists and resolve its identity before considering artwork. |
| Pikachu (GO Fest 2023) | Five gem-crown variants are already in the accepted gallery; the legacy GO Fest 2023 label does not select a crown colour. This is an identity gap, not missing artwork. | Keep excluded until explicit user-safe identity evidence selects one crown; do not choose a default colour. |
| Pikachu (GO Fest 2024) | Moon Crown and Sun Crown sprites are both in the accepted gallery; the legacy GO Fest 2024 label does not choose between them. | Resolve the intended tiara through a separate identity compatibility decision, not an art-only alias guess. |
| Pikachu (Instinct) | Team Instinct hat Pikachu is officially confirmed for GO Fest 2026; the live accepted gallery contains no Instinct hat sprite. | Review only Team Instinct hat artwork, not another team's hat. |
| Pikachu (Jeju) | Official Jeju evidence names Blue Shirt (Citrus) and multiple balloon costumes, which have accepted sprites. The legacy location-only label does not establish which one it means; the previous restricted-only claim was incorrect. | Obtain evidence tying the legacy Jeju identity specifically to Blue Shirt (Citrus) or an explicit balloon variant before mapping. |
| Pikachu (Marathon) | The official Spring Marathon announcement confirms a marathon visor. The accepted gallery has Nate and Rosa visors, but no marathon-visor sprite. | Review the exact marathon visor; Nate/Rosa visors are not substitutes. |
| Pikachu (Mystic) | Team Mystic hat Pikachu is officially confirmed for GO Fest 2026; the live accepted gallery contains no Mystic hat sprite. | Review only Team Mystic hat artwork, not another team's hat. |
| Pikachu (Professor Willow's Assistant) | Professor Willow's assistant Pikachu debuted at the official July 21 birthday event; its outfit is absent from the accepted gallery. The Ph.D. sprite is a different costume. | Review the assistant outfit against the official identity; do not use Ph.D. Pikachu or merchandise artwork. |
| Pikachu (Valor) | Team Valor hat Pikachu is officially confirmed for GO Fest 2026; the live accepted gallery contains no Valor hat sprite. | Review only Team Valor hat artwork, not another team's hat. |
| Pikachu (Victor) | No Victor-labelled GO sprite exists in the accepted gallery and this audit found no authoritative announcement establishing the legacy Victor costume. The previous multiple-variants claim was not substantiated. | Establish that this exact GO costume exists and resolve its identity before considering artwork. |
| Pikachu (Worlds 2026) | PIKACHU_WCS_2026 is confirmed by the official August 25 Worlds announcement. The accepted gallery lists Worlds 2022, 2023, 2024 and 2025, but no 2026 outfit. Official and mined images are not approved for copying. | Review only the WCS 2026 costume when published by an accepted sprite source; do not reuse Worlds 2025 or Cosmog Spacesuit. |
| Teddiursa Witch Hat | The accepted Teddiursa GO gallery contains only teddiursa.png, with no witch-hat version. The official Halloween 2025 announcement confirms the costume but does not grant image reuse. | Wait for an accepted Teddiursa witch-hat sprite or separately documented source permission. |
| Ursaring Witch Hat | The accepted Ursaring GO gallery contains only ordinary male/female sprites, with no witch-hat version. An evolved costume must have its own exact art. | Review an Ursaring witch-hat asset; neither base Ursaring nor Teddiursa art is acceptable. |
| Galarian Corsola Pink Sunglasses | The official Sustainability Week announcement confirms Galarian Corsola with pink sunglasses. The accepted gallery contains ordinary Corsola and Galarian Corsola only, neither wearing sunglasses. | Review the Galarian pink-sunglasses version; reject ordinary Galarian or Johto Corsola. |
| Slakoth (Night Cap) | The official Slumbering Sands event names Slakoth wearing a visor and Snorlax wearing a nightcap. The accepted Slakoth visor sprite exists, but it does not validate the legacy Night Cap label. | Resolve the legacy label with identity evidence; do not silently rename it or map the visor as if it were a nightcap. |
| Pumpkaboo (Spooky) | Four accepted Spooky Festival sprites exist (small, average, large, super); the legacy Spooky label does not encode a size. | Resolve the stored size before selecting exact artwork; do not assume average. |
| Noibat Headband | The accepted Noibat GO gallery contains only noibat.png, without a headband. The official Halloween 2025 announcement is identity evidence, not an artwork license. | Review exact Noibat headband artwork from an accepted source. |
| Noivern Headband | The accepted Noivern GO gallery contains only noivern.png, without a headband. Noibat's headband image cannot stand in for its evolution. | Review exact Noivern headband artwork from an accepted source. |
| Ursaluna Witch Hat | The accepted Ursaluna GO gallery contains only ursaluna.png, without a witch hat. Neither base Ursaluna nor an earlier evolution's costume is exact. | Review exact Ursaluna witch-hat artwork from an accepted source. |

## Identity Evidence

- Nine confirmed 2026 gaps have individual URLs and availability dates in [costume-release-evidence.json](../data/costume-release-evidence.json), including Worlds, Cosmog, Excavator, team hats, marathon visor, Willow's assistant and Galarian Corsola.
- [Halloween 2025 Part II](https://pokemongo.com/news/halloween-part-2-2025?hl=en) names the Teddiursa/Ursaring/Ursaluna witch hats and Noibat/Noivern headbands.
- [Jeju's official event page](https://pokemongo.com/en/events/airadventures-jejuisland?hl=en) names Blue Shirt (Citrus) and balloon variants, not a unique location-only identity.
- [Slumbering Sands](https://pokemongo.com/post/slumbering-sands-2024?hl=en) distinguishes Slakoth's visor from Snorlax's nightcap.
- Exact gem-crown, sun/moon and Pumpkaboo size candidates are recorded in the accepted source snapshot. Their availability does not resolve the generic legacy identity.

The September 6 [official News review](https://pokemongo.com/news) found four **upcoming**, not yet released identities missing from the catalog: [Turquoise PokeXciting Pikachu](https://pokemongo.com/news/event-kuala-lumpur-30th-anniversary-2026) on September 12 and [Charmander, Charmeleon and Charizard wearing Friede's goggles](https://pokemongo.com/news/pokemon-horizons-celebration-event-2026) on September 16. All four are in the evidence queue; none is added to product identity data. Their accepted galleries currently have no exact files. Reports show them as upcoming now and flag missing catalog entries on their release dates. Further regional PokeXciting colours require local announcement details; do not guess those identities.

## Lightweight Review Workflow

The existing GitHub Actions workflow now runs **weekly on Monday at 09:17 UTC**, or manually. It stays read-only, needs no new credentials or service, and publishes the actionable report in the run summary, including failed-source status. Pull requests affecting the catalog/check run deterministic fixture tests plus offline integrity; they do not fetch external pages.

```sh
node --test tests/costume-sprite-freshness.test.cjs
node scripts/check-costume-sprite-freshness.cjs --offline
node scripts/check-costume-sprite-freshness.cjs --report /tmp/costume-review.json --summary /tmp/costume-review.md --capture /tmp/costume-upstream-candidate.json
```

A nonzero exit means review is required or a source check failed. `no-new-findings` means no newly actionable changes, not complete costume support. Known rejected/ambiguous candidates remain visible without generating a fresh alert on every run. Failed or empty parses do not create a candidate snapshot. Requests have 10-second timeouts, a 10-minute overall budget and a 250 ms inter-page pause; no artwork is downloaded.

1. **Discover:** the maintainer reviews official News and Events weekly, appends each confirmed new costume to the release-evidence register with exact species/name, source URL and availability date, then updates its review date. This is intentionally semi-automated, seeded with nine pending and four upcoming 2026 identities, not an exhaustive announcement scraper. The check flags those released names if missing from the catalog. A discovery review older than seven days is actionable; no unattended process claims to have reviewed announcements.
2. **Inspect:** review new/removed/relabeled source files and candidate matches. Matching uses species plus explicit token groups, not a guessed runtime filename. Every new source file also appears in the general diff even when no pending alias matches. Add a reviewed species page to the source snapshot when a release introduces a species not yet monitored; do not assume the existing 127 pages cover every future costume.
3. **Record:** update the pending reason, evidence and next action. For rejected candidates, record their exact filenames in `reviewedCandidateFiles`; this acknowledges inspection, not approval. Refresh the accepted snapshot from the complete candidate only after reviewing its diff. Do not merely bump timestamps to silence alerts. Source snapshot and per-identity reviews expire after 14 days.
4. **Promote:** follow the checklist below. The check never changes runtime status, publishes artwork, migrates an identity or updates a reviewed baseline automatically.

## Promotion Checklist

1. Confirm the existing canonical identity, species, form, event/year, size and gender against authoritative evidence. An ambiguous legacy identity stays excluded; any compatibility/migration decision is a separate task.
2. Verify the source's current reuse/hosting position against [provenance policy](ASSET-DATA-PROVENANCE.md). For a new source, obtain and record the permission decision before downloading product assets.
3. Find the actual GO sprite file in the accepted gallery. Visually inspect the normal sprite and any female variant against the identity evidence. Record reviewer, date, evidence URL, exact source page/file/label/URL and the mapping rationale in the catalog record (not merely a substring match).
4. Save only the reviewed PNGs under `assets/sprites/go/`; record each local path and SHA-256 in `data/costume-sprite-catalog.json`. Reuse an existing reviewed local asset only with an explicit identity-to-art rationale. Add new local files to `scripts/pages/frontend-files.json`; keep them lazy, out of startup precache.
5. Remove the promoted identity from the pending register, retain its release evidence, update inventory counts and focused expectations, and run `npm run generate:costume-sprites`. Check `npm run check:costume-sprites`, the freshness tests and `--offline`; digest/source-path/generation failures block promotion.
6. Run the signed-in and anonymous costume browser checks on desktop/mobile; inspect the new art and verify unresolved variants still cannot fall through to base art. Use the normal reviewed PR, release gates and deployment controls for a runtime release.

This audit changes maintenance tooling and documentation only. Production remains .95; there is no reason to deploy an unchanged runtime or weaken provenance merely to reduce the unsupported count.
