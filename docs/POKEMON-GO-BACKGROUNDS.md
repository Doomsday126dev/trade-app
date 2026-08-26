# Pokémon GO background qualifiers

The app treats a Pokémon GO background as an optional structured trade qualifier. Saved entries carry a stable `backgroundId`; they do not carry a display label, source URL, or background artwork.

## Semantics

- No `backgroundId` on a wanted entry is background-agnostic. A Pokémon with any background can satisfy that want.
- A wanted `backgroundId` requires the offered Pokémon to carry that exact ID.
- A missing background on an offered Pokémon cannot satisfy a specific-background want.
- Background matching composes with the existing species/form, costume, shiny, gender, Lucky, XXL, and XXS rules.
- Pokémon GO search strings intentionally omit backgrounds because the game does not provide a supported background-specific search operator.

Legacy priority strings remain valid. New strings add one token, for example `H[shiny][bg:location-gofestnewyorkcity](F)`. Unknown but syntactically valid future IDs remain round-trippable and display safely as their ID until the local catalog learns their label.

## Catalog

`data/backgrounds.json` is the reviewed, versioned product registry. Each record includes a stable ID, display and short labels, type, aliases, event/location/year when known, eligible Pokémon where reliable, release status, and source provenance. The browser consumes the generated `js/domain/backgroundCatalog.js` module; it never scrapes a third-party site at runtime.

The initial registry normalizes the complete human-readable catalog available from Serebii as of the catalog date. The accepted PokeMiners `Images/LocationCards` commit is kept as a machine-oriented addition/removal signal. Official Pokémon GO pages are used to resolve recent or ambiguous terminology. Candidate or future records are not shown in the product picker.

No third-party background artwork is copied or served. UI rows and exports use accessible text badges. Artwork can be added only after a separately approved rights and hosting strategy.

## Maintenance

Run the deterministic local checks:

```sh
npm run check:background-catalog
```

Run the explicit live maintenance comparison:

```sh
npm run check:background-upstream
```

An added or removed upstream filename exits nonzero and is a review signal, not an automatic publication. Reviewers confirm event terminology and release status, refresh `data/backgrounds.json`, inspect the diff, regenerate the browser module, and then update the accepted upstream snapshot only after mapping review.

Both maintenance checks also report records whose eligible-Pokémon mapping is still empty. The picker treats those records as relevance-unknown and keeps them available under All backgrounds rather than asserting incompatibility.

To refresh source-derived metadata deliberately:

```sh
node scripts/update-background-catalog.cjs --refresh-catalog
npm run generate:background-catalog
```

The updater preserves existing stable IDs by source identity. A renamed label therefore does not rewrite IDs stored in user lists.
