# Asset and Data Provenance

Last reviewed: 2026-08-29

This document records the source boundary for data and visual assets used by PoGo Trades. It is an engineering policy record, not legal advice.

Following a source site's reuse or hosting instructions does not create a blanket license to Pokémon intellectual property. Pokémon Support's current public answer asks projects not to use or associate Pokémon characters, names, or designs with a project. There is therefore no zero-risk way to promise complete costume artwork while also claiming universal rights-holder permission. This repository's controls are a conservative provenance and source-site-compliance boundary, not a representation of legal authorization.

## Policy

If a source expressly says its material should not be reused, PoGo Trades does not copy or serve that material. Attribution does not substitute for permission.

Researching names, dates, eligibility, or catalog mappings is different from copying or serving a source's prose or artwork. User records store normalized IDs and app-owned metadata, never volatile source URLs. The user-facing acknowledgements are plain text and contain no outbound source links.

## Current Runtime Sources

### PokéAPI data and sprite repositories

- URLs: https://pokeapi.co/ ; https://github.com/PokeAPI/pokeapi ; https://github.com/PokeAPI/sprites ; https://raw.githubusercontent.com/PokeAPI/sprites/master/README.md ; https://raw.githubusercontent.com/PokeAPI/pokeapi/master/LICENSE.md
- Use: species/form data generation, localized species-name generation, and base/form/regional/gender sprite URLs under `raw.githubusercontent.com/PokeAPI/sprites/`.
- Copy/serve/reference: the app references and the browser fetches sprite-repository files; generated local data catalogs contain normalized data. No third-party prose is copied into the product.
- Stated position: the sprite repository README invites downloading the repository for use. The PokeAPI code/data repository uses a BSD-style license with notice conditions. The sprite repository does not include a separate license file, and its Pokémon artwork remains third-party IP.
- Underlying IP: Pokémon names, characters, and artwork belong to their respective rights holders.
- Decision: **KEEP**, constrained to exact PokeAPI repository paths and with the rights-holder notice retained.

### Pokémon Database

- URLs: https://pokemondb.net/about ; https://pokemondb.net/sprites ; https://img.pokemondb.net/sprites/
- Use: selected Pokémon HOME form/gender fallbacks and a reviewed catalog of exact Pokémon GO costume sprites.
- Copy/serve/reference: reviewed GO sprite files are saved under `assets/sprites/go/` and served by PoGo Trades, following the sprite gallery's request to self-host images instead of consuming its bandwidth. The app does not copy Pokémon Database prose, page layout, or data presentation. HOME fallbacks remain constrained runtime references while their broader replacement is evaluated separately.
- Stated position: the site's About page says its written content, displayed data, and design generally may not be reused, while official Pokémon artwork and sprites are not its creations. Its sprite gallery explicitly offers website use and asks users either to use its linked code or save images to their own hosting.
- Underlying IP: the Pokémon imagery is owned by the relevant Pokémon rights holders, not PoGo Trades or Pokémon Database.
- Decision: **KEEP** for reviewed sprite files and constrained fallback paths only. Do not copy Pokémon Database text, tables, data presentation, or design. Never infer a costume filename at runtime.

### weserv.nl image proxy

- URLs: https://images.weserv.nl/ ; https://github.com/weserv/images
- Use: legacy CORS-compatible transport for validated Pokémon Database targets in signed-in export/canvas paths. Public-share optical sizing uses direct CORS-readable or self-hosted sources and does not use this proxy.
- Copy/serve/reference: no independent artwork comes from weserv.nl. Runtime validation accepts a proxy URL only when its decoded target is `img.pokemondb.net/sprites/`.
- Stated position: open-source image proxy service/software; it does not grant rights to proxied source material.
- Underlying IP: unchanged from the constrained Pokémon Database target.
- Decision: **KEEP** as transport only; never treat the proxy as provenance or use it to bypass the source allowlist.

### Repository-owned interface assets

- URLs: local files under `assets/`, including `assets/max-cloud.svg` and generated background visual tokens in app code.
- Use: interface decoration, fallback cloud treatment, and catalog-ID-derived background colors/patterns.
- Copy/serve/reference: created and served by this repository; no third-party Pokémon GO background artwork is embedded.
- Stated position: project-authored visual treatment. It may describe Pokémon-related concepts without copying official background artwork.
- Underlying IP: Pokémon names and related marks remain with their respective owners.
- Decision: **KEEP**.

## Research-Only Sources

### PokeMiners Pokémon GO assets

- URLs: https://github.com/PokeMiners/pogo_assets ; https://github.com/PokeMiners/pogo_assets/tree/master/Images/LocationCards ; https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/README.md
- Use: machine-oriented signal for possible background additions/removals and historical catalog research.
- Copy/serve/reference: reference only. No mined image, sound, or raw game asset is copied or served.
- Stated position: the repository says it is for educational use only and that the material belongs to The Pokémon Company and Niantic; no reusable asset license is supplied.
- Underlying IP: The Pokémon Company, Niantic/Scopely, and other applicable rights holders.
- Decision: **REFERENCE ONLY**. Any former runtime PokeMiners sprite fallback is removed and blocked by the runtime allowlist.

### Serebii

- URLs: https://www.serebii.net/pokemongo/backgrounds.shtml ; https://www.serebii.net/copyright.shtml
- Use: normalized event/location/availability/eligible-Pokémon research for `data/backgrounds.json`.
- Copy/serve/reference: reference only. The app retains normalized facts and stable local IDs; it does not serve Serebii artwork, page text, or layout.
- Stated position: Serebii marks its site content as copyrighted and does not publish a general reuse license for republishing its material.
- Underlying IP: Serebii's original site content belongs to Serebii; Pokémon material belongs to its respective rights holders.
- Decision: **REFERENCE ONLY**. Any former runtime Serebii image fallback is removed and blocked by the runtime allowlist.

### Pokémon GO Hub

- URLs: https://pokemongohub.net/ ; https://pokemongohub.net/terms-of-service/
- Use: historical metadata comparison only; it is not an authoritative runtime or catalog dependency.
- Copy/serve/reference: reference only. No GO Hub image URL is permitted by the runtime or service-worker sprite allowlist.
- Stated position: the site's terms reserve its and third parties' intellectual-property rights and do not grant a general right to republish graphics or protected material.
- Underlying IP: GO Hub and the applicable Pokémon rights holders.
- Decision: **REMOVE / DO NOT SERVE** for images; **REFERENCE ONLY** for non-copied research. Former `cdn08.net` costume URLs are removed.

### Official Pokémon GO and Pokémon sources

- URLs: https://pokemongolive.com/ ; https://www.pokemon.com/uk/news/pokemon-gos-2026-pokemon-world-championships-event ; https://support.pokemon.com/hc/en-us/articles/360000634094-Can-I-use-Pok%C3%A9mon-images-or-materials ; https://www.pokemon.com/us/legal/terms-of-use ; https://www.pokemon.com/us/legal/information
- Use: official terminology and confirmation of ambiguous or recent events/backgrounds.
- Copy/serve/reference: reference only. No official announcement prose or background artwork is copied or served by this feature.
- Stated position: official terms reserve the protected content and marks and do not provide a general reuse license for product assets. Pokémon Support's January 2026 answer says it cannot review reuse requests and asks projects not to use or associate Pokémon IP with a project.
- Underlying IP: The Pokémon Company group, Nintendo, Niantic/Scopely, and other applicable rights holders.
- Decision: **REFERENCE ONLY**.

## Enforcement

- `data/costume-sprite-catalog.json` records every reviewed exact mapping, local asset path, and SHA-256 digest. `js/domain/costumeSpriteCatalog.js` is generated from that manifest and fails closed for known variants without exact art.
- `js/domain/publicPokemonDex.js` is generated from the public catalog labels and contains only normalized names and dex numbers. It lets anonymous shares select CORS-readable base-species art without loading account-oriented `data.js` or any trainer fields.
- `isApprovedRuntimeSpriteUrl()` accepts only exact approved hosts and path prefixes, reviewed local `assets/sprites/go/*.png`, plus repository-owned `assets/max-cloud.svg`.
- The weserv proxy target is decoded and independently checked against the Pokémon Database sprite path.
- `sw.js` lazily caches reviewed local sprites and sprite requests from the approved runtime hosts; the 458 local files are not added to startup precache.
- Known costumes without exact reviewed art stop at the neutral placeholder. They never masquerade as the base species. Unknown ordinary species/forms may still use the approved base/form fallback chain.
- `.github/workflows/sprite-catalog-freshness.yml` performs a monthly, read-only inventory comparison. It reports upstream additions/removals but never downloads or publishes unreviewed artwork automatically.
- The two confirmed 2026 identities, `PIKACHU_PXP_2026` (Cosmog-themed spacesuit) and `PIKACHU_WCS_2026` (World Championships 2026), are present in the catalog but intentionally remain neutral placeholders until exact artwork appears at an approved source and is reviewed.
- Background cards use project-generated colors and patterns derived from canonical IDs; source artwork is neither fetched nor embedded.
