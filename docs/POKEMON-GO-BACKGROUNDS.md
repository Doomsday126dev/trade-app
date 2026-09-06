# Pokémon GO background qualifiers

Background qualifiers are retired from the active wants-only product. This document records the historical format and retained offline metadata. Since .96, no background catalog, artwork module, or picker is loaded by the browser. Saved entries may still carry a stable `backgroundId`; they are not migrated or purged.

## Semantics

- No `backgroundId` on a wanted entry is background-agnostic. A Pokémon with any background can satisfy that want.
- A wanted `backgroundId` requires the offered Pokémon to carry that exact ID.
- A missing background on an offered Pokémon cannot satisfy a specific-background want.
- Background matching composes with the existing species/form, costume, shiny, gender, Lucky, XXL, and XXS rules.
- Pokémon GO search strings intentionally omit backgrounds because the game does not provide a supported background-specific search operator.

Legacy priority strings remain valid. New strings add one token, for example `H[shiny][bg:location-gofestnewyorkcity](F)`. Unknown but syntactically valid future IDs remain round-trippable and display safely as their ID until the local catalog learns their label.

## Catalog

`data/backgrounds.json` is the retained offline registry. Each record includes a stable ID, display and short labels, type, aliases, event/location/year when known, eligible Pokémon where reliable, release status, and source provenance. It is not part of the deployed frontend inventory.

The initial registry normalizes the human-readable catalog available from Serebii as of the catalog date. The accepted PokeMiners `Images/LocationCards` commit remains an offline addition/removal signal. Official Pokémon GO pages supplied terminology evidence.

No third-party background artwork is copied or served. Compact label styling remains for existing public-share compatibility; there is no active artwork or picker presentation.

## Maintenance

Run the deterministic local checks:

```sh
npm run check:background-catalog
```

Run the explicit live maintenance comparison:

```sh
npm run check:background-upstream
```

An added or removed upstream filename exits nonzero and is an archival review signal, not an automatic publication. Any deliberate metadata update requires terminology and mapping review before updating the accepted snapshot. The browser generator has been removed.

Both maintenance checks also report records whose eligible-Pokémon mapping is still empty; those records remain unverified metadata, not active product choices.

To refresh source-derived metadata deliberately:

```sh
node scripts/update-background-catalog.cjs --refresh-catalog
```

The updater preserves existing stable IDs by source identity. A renamed label therefore does not rewrite IDs stored in user lists.
