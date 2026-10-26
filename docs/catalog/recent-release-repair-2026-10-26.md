# Recent release catalog repair (local candidate)

Baseline: live `.148`, runtime `84e057be83f5de292c660324b156fd07940ec3af`.
This candidate is isolated from the Apri redesign and authentication work. It has not been published.

## Cause and repair

The old checks validated artwork for identities already present; they did not independently reconcile newly announced identities with the selectable catalog and public Max allowlist. Ordinary Deino and Sizzlipede existed, but their Dynamax families did not. Orange Hanbok Pikachu was absent entirely. The pending redesign used the same catalog.

Add Orange Hanbok Pikachu with two exact original Serebii PNGs (17,009 bytes total), normal and Shiny. The official Korean announcement confirms September 18 at 10:00 Korea time and Shiny eligibility. Female-only restriction is supported by the documented collector mapping and inspected heart-tail source artwork; it is not described as an official gender statement. Do not invent a male variant or an official GO costume identifier.

Add 13 reviewed Dynamax identities: Deino, Zweilous, Hydreigon, Rhyhorn, Rhydon, Rhyperior, Sizzlipede, Centiskorch, Sneasel, Weavile, Uxie, Mesprit and Azelf. Evolution dates describe availability through the released family, not a claim every evolution debuted in Max Battles. Search supports dmax/d-max, the common “sizzlepede” spelling, Korean Pikachu/Korean pika, Korea, Orange Hanbok and Autumn Picnic.

The Dynamax sprite-equivalence helper previously discarded Shiny and gender. It now uses ordinary-form artwork with the requested color/gender; it does not create inflated Dynamax artwork. Exact underlying forms remain distinct. Lake guardians offer no new male/female selection; existing incompatible saved qualifiers remain preserved. Gigantamax artwork is not substituted with ordinary species art.

## Preservation and qualification

Local structural comparison with the baseline confirms 997 old seed rows unchanged, all 392 old costume records unchanged and all 524 normal-art references preserved. Only 13 empty-user Max rows and one reviewed costume identity are added. No account, stored list, permission, route or release registration changes are included. The generated public dex is 34,996 bytes against its unchanged 35,000-byte budget. The frontend asset allowlist gains exactly the two reviewed PNGs.

Final unit qualification: 1,980 passed, zero failed, 12 existing skips (1,992 total).

Chromium and WebKit: six real synthetic journeys exercise all 14 names, aliases, selection, normal/Shiny, female-only Hanbok, five dimorphic Max females, genderless guardians, save, reload, public-share rendering and actual generated image exports. The export path also now preserves the reviewed Dynamax Shiny/gender chain instead of preferring normal artwork. Image decode uses original downloaded PNG bytes, hash verified and visually inspected; outside network traffic is blocked. No production writes or analytics. Original Max images and all four rendered normal/Shiny browser outputs were inspected.

Reproduce:

```
node scripts/generate-costume-sprite-runtime.cjs --check
node scripts/generate-public-sprite-dex.cjs --check
node scripts/check-released-catalog.cjs
node --test tests/*.test.cjs
node scripts/prepare-recent-catalog-sprite-fixture.cjs
CATALOG_SPRITE_CACHE=/tmp/trade-recent-catalog-sprite-cache npx playwright test --config=playwright.catalog-repair.config.cjs
```

## Ongoing discovery and routing

The existing Sprite catalog freshness workflow remains daily at 09:17 UTC, manual and relevant-PR triggered, with `contents: read` and the same 15-minute timeout. No secrets, issue-writing permission or communication integration are added. The existing maintainer surface is the Actions failure/check and visible job summary plus its evidence artifact; this change does not assert that any particular person's notification subscription is enabled.

A separate source-derived release inventory checks the selectable collection and generated public Max allowlist, including missing ENTIRE records. Runtime artwork validation checks Hanbok's exact assets, hashes, Shiny and gender contract. The live discovery step independently reads the official English and Korean news indexes and current season Max cards. A wholly new announcement or Max species creates an actionable review finding even if it has never appeared in application data or fixtures. Fetch/partial-source failures, wrong content types, zero/changed parser structure, missing sources, unexpected redirects, contracted indexes, malformed holds and observations older than seven days fail or require review. No source failure becomes an empty successful catalog.

An announcement is not a release authorization. A known announcement crossing its date-level review deadline now raises `announced-unconfirmed` for human date/time/timezone confirmation, rather than being called a released missing identity or silently promoted. It never changes catalog data or imports artwork. Existing source-review dates remain unchanged; the new Hanbok evidence has a narrowly scoped supplemental review.

The monitor produces actionable candidate metadata and evidence URLs. Exact identity, art, eligibility and dates still require review before preparing runtime changes. Discovery is bounded: index additions and season Max cards do not cover every article edit, older off-index item or other locale-only announcement. It is not a complete worldwide release feed and does not guarantee no future omission.

## Explicit remaining review holds

`data/recent-release-review-holds.json` keeps these visible in the daily summary even if no new announcement arrives:

- Green Core Minior: generic Minior does not establish all cores. Verify exact form artwork and eligibility; preserve generic saved records.
- Shiny Gigantamax Cinderace: October 3 is the Shiny debut, not initial Gigantamax release. Verify actual Gigantamax-form Shiny rendering; no normal-as-Shiny or ordinary-form substitution.

The live source discovery read succeeded, returning 30 links per news index and six season Max cards; it intentionally reports `review-required` for those two holds. Future Halloween costume announcements and prior ambiguous/unreleased/Spinda holds remain outside this repair. Existing old-source freshness findings are not waived or marked reviewed.

The requested distinct Max-icon old/new sample is separate presentation work and requires user review before any release.
