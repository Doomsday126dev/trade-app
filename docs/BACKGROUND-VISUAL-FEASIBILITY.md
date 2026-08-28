# Background Visual Feasibility

## Decision

**KEEP WITH VISUAL TREATMENT**

The product should retain its structured `backgroundId` catalog, matching, and export behavior. Released backgrounds now receive an original, deterministic visual treatment made from local CSS/canvas geometry plus a concise accessible label. No official or mined background artwork is redistributed or fetched at runtime.

## Asset Boundary

The background catalog is metadata. Artwork is a separate rights decision.

- Official Pokemon GO announcements can confirm that a named background exists, but they do not establish a reusable production-art license for this app.
- The [PokeMiners asset repository](https://github.com/PokeMiners/pogo_assets) is useful as a technical discovery signal. Its README says the project did not create the images and that copyright remains with the respective companies.
- [Niantic's Terms of Service](https://nianticlabs.com/terms) reserve rights in service content and provide only a limited service-use license. That is not a reliable basis for copying or hotlinking an artwork library into this product.
- Official event pages, such as the [GO Wild Area announcement](https://gotour.pokemongolive.com/gowildarea/global/), are useful provenance for metadata and eligibility, not an artwork redistribution grant.

Accordingly, this pass includes no copied, hotlinked, scraped, or remotely hosted background art. A future artwork phase requires an explicit approved asset source and license review.

## Prototype Findings

The three safe prototypes are in `docs/prototypes/background-visual-treatments.html`.

### Option A: clipped art area

This most closely resembles the in-game presentation, but it gives artwork too much visual weight and depends on an approved image source. Placeholder geometry also reads like missing artwork. It is not appropriate for the current release.

### Option B: thumbnail or swatch

This is compact and scales well across list rows, comparison chips, and mobile. Alone, however, it is too subtle to make a background-qualified Pokemon feel meaningfully distinct.

### Option C: original frame plus swatch

This combines a low-opacity deterministic motif behind the Pokemon area with the compact swatch and text label. It works without artwork, preserves row density, remains identifiable without color alone, and translates cleanly into canvas exports. This is the selected treatment.

## Implementation Contract

- The stable catalog ID selects one of a bounded set of original palettes and motifs.
- Location and special backgrounds use separate palette families.
- The visual is supplemental. Full background names remain available through visible text and accessible labels.
- My List, public lists, Compare, Special Trade Board, classic exports, and card exports use the same deterministic resolver.
- There are no runtime network requests, image URLs, user-supplied CSS values, or persisted visual tokens.
- Unknown or legacy IDs remain readable as text and receive a safe deterministic visual when the ID is syntactically valid.

## Future Reactivation Path for Artwork

If approved artwork becomes available, add an optional repository-owned asset reference to reviewed catalog records. Keep the deterministic treatment as fallback, retain the stable IDs, and never make matching or stored user data depend on an image URL.
