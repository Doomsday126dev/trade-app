# Domain display localization

Pokémon and event localization is separate from the general UI catalogs. Canonical Pokémon names, Pokédex numbers, event IDs, Firebase paths, list keys, filters, stored selections, and generated Pokémon GO search strings remain locale-independent.

## Pokémon source and coverage

`data.js` contains 966 app entries: 548 wishlist, 125 Dynamax, 31 Gigantamax, and 262 costume entries. Every entry has a usable positive Pokédex ID. The entries collapse to 571 unique species IDs; 139 IDs occur in more than one app entry because forms, Dynamax/Gigantamax records, and costumes intentionally reuse the species identity. There are no duplicate keys within a generated locale catalog.

`js/i18n/pokemonNames/catalog.js` is generated from `PokeAPI/pokeapi` `data/v2/csv/pokemon_species_names.csv`, Git blob `44954a1248493d8cc336f121ce5cce394cee9ac0`, retrieved 2026-08-06. Language IDs are Japanese 1, German 6, Spanish 7, and English 9. The pinned source contains 1,025 names per locale and covers all 571 app species IDs in every locale: 571 localized, 0 English fallbacks, 0 missing, 0 duplicate mappings, and 0 invalid mappings for base species.

Regenerate only from a locally reviewed copy of that exact CSV:

```sh
npm run generate:pokemon-names -- /path/to/pokemon_species_names.csv
```

The generator verifies the Git blob SHA, rejects duplicate/blank/invalid mappings, requires 1,025 names per locale, and performs no network request. Individual generated names must not be edited by hand. PokéAPI's license notice identifies Pokémon and character names as Nintendo trademarks and requires preservation of its redistribution notice; the complete notice is retained in `docs/third-party/POKEAPI-LICENSE.md`, and the source repository and exact blob remain recorded here and in the generated asset.

## Forms and composites

The app has 378 entries matching at least one composite pattern. Overlapping audited families include:

| Pattern | App entries | Display behavior |
| --- | ---: | --- |
| Regional `A-`, `G-`, `H-`, `P-` | 39 | Structured exact-prefix parsing and locale-specific complete templates |
| Nidoran gender records | 2 | Species catalog names, including `♀` and `♂` |
| Gigantamax | 31 | Stable whole-label English fallback |
| Costume collection | 262 | Stable whole-label English fallback |
| Rotom | 6 | Stable whole-label English fallback |
| Unown | 29 | Stable whole-label English fallback |
| Vivillon | 20 | Stable whole-label English fallback |
| Pumpkaboo/Gourgeist sizes | 5 | Stable whole-label English fallback |
| Furfrou trims | 10 | Stable whole-label English fallback |
| Oricorio styles | 8 entries / 4 distinct labels | Stable whole-label English fallback |
| Tatsugiri forms | 3 | Stable whole-label English fallback |
| Background/location-like labels | 4 | Stable whole-label English fallback |
| Mega/Primal text in canonical app data | 1 | Stable whole-label English fallback |
| Origin/Altered, Therian/Incarnate, Deoxys, Maushold/Dudunsparce, Shadow/Purified | 0 | No canonical entries currently present |

This deliberately does not translate arbitrary suffix fragments or costume prose. A composite remains clean English unless its structure is exact and supported. Identity remains `{speciesId, variantId}` where `variantId` is the unchanged canonical app name because `data.js` does not provide separate stable form or costume IDs.

## Search, sorting, and rendering

Search indexes a bounded deduplicated set containing the active localized label, original English display label, canonical app label, and Pokédex number. NFKC and Unicode letter/number normalization support Japanese scripts, accents, gender symbols, existing aliases, and English queries under every locale. Generated Pokémon GO strings remain canonical dex/filter strings.

User-visible alphabetical tie-breaking uses `Intl.Collator`. Pokédex, priority, family, category, chronological event, and deliberate game ordering remain authoritative.

Localized Pokémon labels are routed through the resolver in autocomplete, Browse, My List, Find Trainer/public shares, comparison and change details, Legacy Inventory, owned inventory, trade-match display, and import preview. Intentional canonical bypasses are limited to database/list keys, publication payloads, identity comparisons, sprite lookup, generated Pokémon GO strings, form parsing, event-to-Pokémon matching, and storage/export serialization. None of those values is user-facing localized identity.

## Event model and current coverage

ScrapedDuck supplies source-faithful English records at runtime. The raw `events.min.json` and `raids.min.json` payloads are cached unchanged in `pogoEventCache_v1`. Localization is derived only while rendering.

The event source audited on 2026-08-06 used `events.min.json` Git blob `94d874920664674a6a6c0b9a1c704b2269e1186f`: 39 event-card records, all with stable IDs. Coverage was 0 source-provided official localized titles, 11 safely template-localized recurring titles, 23 unique English fallbacks, 5 ambiguous recurring-looking English fallbacks, and 0 missing stable IDs. The separately fetched raid roster contained 19 Pokémon records and is used for availability badges, not event-card title identity.

Structured composition is allowed only when the event type and complete English title exactly match one of these patterns and the captured text resolves to one species in the pinned catalog:

- `<Pokémon> Community Day`
- `<Pokémon> Community Day Classic`
- `<Pokémon> Spotlight Hour`
- `<Pokémon> Raid Day`
- `<Pokémon> Raid Hour`
- `<Pokémon> Research Day`
- `<Pokémon> Max Battle Day`
- `Dynamax <Pokémon> during Max Monday`
- `<Pokémon> Hatch Day`

Templates are complete locale-specific title functions; they do not replace fragments inside prose. Multi-species Raid Hours, `Fire and Ice Hatch Day`, `Starmie Super Mega Raid Day`, GO Fest/Tour/Wild Area titles, seasonal narratives, collaborations, ticket products, and location brands stay official English unless a source record supplies a locale map. Source-provided `title`, `name`, `heading`, `summary`, `description`, `translations`, or `localizations` maps take precedence.

Event type IDs, event filters, route/link values, chronological sorting, source links, and cache keys remain unchanged. Thirteen recurring/event-domain type concepts and eleven structured bonus concepts have labels in all four locales. Arbitrary source prose falls back to English without runtime machine translation.

## Locale and cache guarantees

Locale changes rerender visible list, search, comparison, public-share, inventory, organizer, and Events surfaces. The current event filter, Pokémon/list filters, selected trainer, organizer drafts, Settings state, canonical records, and scroll position are preserved. Locale changes do not refetch Events, rewrite their cache, republish a share, or write translated labels.

Anonymous public shares use the viewer's device-local locale while reading the same locale-independent public projection. Direct URLs and public-share identities remain stable.

## Asset and offline impact

The generated four-locale Pokémon catalog is 75,224 bytes uncompressed, approximately 30,893 bytes with gzip and 18,052 bytes with Brotli in the local measurement. Pokémon core and event-label code add another 14,493 uncompressed bytes. The catalog loads eagerly and is precached so offline locale switching is reliable. Autocomplete adds at most four deduplicated labels per app entry and is rebuilt only when its existing cache is built or locale changes. Lazy locale loading was rejected for this baseline because it would complicate offline switching for a small compressed asset.
