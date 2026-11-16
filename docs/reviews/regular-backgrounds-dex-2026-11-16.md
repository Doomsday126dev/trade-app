# Regular backgrounds and dex-order defaults

## Cause and change
The multiple-background adapter already supported independent shiny and regular identities. The editor's no-priority validation rejected regular legendary requests because it recognized only manually chosen H/M/L or shiny/lucky/size flags. The anonymous shared renderer also retained insertion order, unlike the authenticated shared renderer.

- Accept priority-free regular legendary / Ultra Beast / tradable special-species wants without changing their shiny flag.
- Group these with shiny wants under **Special trades**, localized in all four interface languages. Existing H/M/L wins; other qualifier combinations remain distinct.
- Keep the legacy `SHINY` section-control key for compatibility. No saved data, schema, URL, priority, or identity migration.
- Keep visible Shiny only labels on individual shiny requests so a mixed section never implies every row is shiny.
- Default owner and shared sections to ascending dex number, with same-species names as a deterministic tie-breaker and unknown numbers last.
- Include regular special-species wants in the combined Special trades search scope.

This is a list organization category, not a complete calculation of a particular pair of trainers' trade eligibility, registration status, or cost. Existing catalogue restrictions remain unchanged.

## Verification
- Complete Node suite: 2,331 passed, 12 skipped, 0 failed.
- Static performance: 34 passed.
- Browser performance: 8 passed (startup and 100–1,000 row list budgets).
- Background batch suite: 13 passed, including no-priority regular backgrounds, shiny/regular coexistence, duplicate prevention, durable reload, failed/lost acknowledgements, late completions and 320px localized picker checks.
- Shared-link checks verify Special trades, normal versus shiny identity, dex order, full-section copy, pagination, and responsive localization.
- Broader browser run is not entirely green: Combine searches' hidden-details assertion and the disabled language-override selector fail on unchanged main as well. A browser context setup timeout passed in an isolated retry. These unrelated tests were not weakened to hide their failures.

Candidate release is 2026-11-16.174; index, client release marker and service-worker cache version agree. `check:pages-release` passes. No production deployment or user-data mutation performed. The controlled Pages release awaits separate production approval.
