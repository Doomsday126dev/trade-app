# Reviewed 20-costume Shiny artwork candidate

Prepared locally from released .146 runtime `77d5a85e297e783a81ecc0977df19babe826ccef`. This candidate has not been registered, pushed, or deployed. It does not allocate a new release version.

## Source and scope

Input: Library `libfile_21478516a7a48191a0b3a58d6c7aeb62`, version 0, `verified-costume-batch20.json`, SHA256 `4e259cb44ee4ddcbd8c6dd37d3b4fa3d15166487d67302f50e3fff67bb87f3da`.

All 44 source PNGs were downloaded from the supplied URLs at pogorewind commit `5c6bb56c4026e5fe3cd146910c7e9dad9f07d716`. SHA256, byte count, dimensions, decoded transparency and alpha-composited pixels were rechecked. All 20 source IDs match the pinned `datas_debut.csv`; that CSV establishes identity, not release eligibility or independently audited debut dates. Per-record release evidence and original byte hashes are retained in `data/reviewed-costume20-shiny-assets.json`.

The patch adds 22 original Shiny PNGs for these 20 existing mappings:

- Butterfree Bow; Raticate Party Hat; Nidorino Party Hat.
- Vulpix Halloween; Ninetales Spooky Festival.
- Jigglypuff Ribbon; Wigglytuff Ribbon.
- Diglett Fashionable Hat; Dugtrio Fashionable Hat.
- Grimer Party Hat; Muk Party Hat.
- Cubone Cempasuchil; Marowak Cempasuchil Crown.
- Chansey, Togepi, Togetic, Blissey, Buneary, Happiny and Togekiss Flower Crown.

All 22 existing normal PNGs and their mappings remain byte-identical. Butterfree and Raticate retain distinct female artwork. Shared models for species without visual dimorphism use the same legitimate source image. Nidorino is explicitly male-only; Chansey, Blissey and Happiny are explicitly female-only, matching the supplied manifest and independently checked Serebii species pages. Existing saved invalid qualifiers remain unchanged during unrelated edits and reload; cancellation writes nothing.

No source discrepancy was found. No existing aliases, canonical identities or saved records were renamed. Every other catalog entry is unchanged. Held Spinda, unreleased forms and ambiguous identities are unaffected. Of the separate 178-record inventory (173 released Shiny and five unreleased), this local candidate closes 20 released mappings, leaving 153 released mappings outside this patch. Those 20 remain absent from live production until a later approved release.

## Qualification

- Full local unit suite: 1,957 passed, 12 existing skips, zero failures (`node --test tests/*.test.cjs`).
- Chromium and WebKit at 390 × 844: eight cases passed. Each browser exercised search selection, valid gender options, normal/Shiny save and reload, exact shared-list image URLs and decoding, all 72 valid gender/normal/Shiny combinations, and preservation of four legacy invalid-gender records.
- Normal and Shiny shared-list screenshots were visually reviewed in both browsers; all 20 entries render without horizontal overflow.
- Generated catalog/public dex checks and offline source-provenance freshness check passed.
- Scope comparison against .146 confirms only the 20 approved catalog mappings changed, all prior asset bytes are unchanged, and the frontend asset list gains exactly the 22 new PNGs in its existing order.

The new provenance validator rejects wrong source IDs, commits, gender substitutions, source hashes, normal references and mismatched review records. Asset-count assertions increase by exactly 22; existing behavioral assertions and performance budgets remain intact.

## Publication prerequisites

This is a local review checkpoint. Release registration, qualification workflow selection, reviewed baseline delta, final CI, protected deployment and live verification remain for a separately authorized publication step. This preparation changes no read contracts, permissions, authentication code, release controls, workflows, performance budgets, baseline content or baseline expiry.
