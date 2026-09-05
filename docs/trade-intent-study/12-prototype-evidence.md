# Prototype evidence and limits

The prototype is a navigable design artifact, not production-release qualification.
Real representative species/costume names and reviewed imagery are combined with
fictional trainers, groups, intent, availability and meeting context. No user data
was read into the fixture, and no live identity operation was performed.

## Concrete screens

| Required experience | Screenshot |
|---|---|
| Mobile primary list | [390px](screenshots/list-390.png) |
| Add Pokemon | [Catalog search](screenshots/add-390.png) |
| Combined LF/FT editor | [Independent controls](screenshots/edit-both-390.png), [compact rows](screenshots/combined-rows-390.png) |
| Trainers | [People](screenshots/people-390.png) |
| Reciprocal match | [You and Mira](screenshots/match-mira-390.png) |
| Public recipient | [No-login example](screenshots/public-390.png) |
| Share/export | [Preview](screenshots/share-image-390.png), [downloaded selection](screenshots/selected-export.png) |
| Large list | [300 variants](screenshots/large-390.png) |
| Special collectibles | [Exact identity](screenshots/special-390.png), [Max details](screenshots/max-detail-390.png) |
| New trainer | [Empty state](screenshots/empty-390.png) |
| Search | [Species-only copy](screenshots/contextual-search-390.png) |
| Preparation | [Checked draft](screenshots/session-checked-390.png) |
| Alternatives | [Opportunity first](screenshots/concept-b-390.png), [session first](screenshots/concept-c-390.png) |
| Desktop | [List](screenshots/list-1440.png), [People](screenshots/people-1440.png) |

## Executed checks

- Six pure fixture-model tests: exact BG, any-BG asymmetry, variant/shiny/gender,
  separate reciprocal directions, immutable inputs/uncertain evidence, declaration
  deduplication and distinct Max qualification.
- Playwright: nine routes at 320, 390, 430 and 1440px; no horizontal page overflow
  or failed visible image loads. Desktop height 1000px; mobile height 844px.
- Interaction spine: add both sides, no duplicate Snom, preserve shiny base variant,
  preserve Max choice, filter, row/grid, selected export, pixel nonblank check,
  real PNG download, text clipboard, anonymous local candidates, exact query copy,
  session checks leave standing intent unchanged, 300-entry pagination, three IAs.
- Fresh browser blocks external requests. Final report has zero external requests
  and zero page script errors. [Machine-readable report](screenshots/verification.json).

Visual inspection caught and fixed transparent-padding sprite inconsistencies,
320px People filter overflow and export sprite scaling. Shiny glyph rendering was
replaced with fixed vector geometry to avoid font-dependent diamond shapes. Mobile
screenshots are viewport captures, not full-page captures with a misleading fixed
navigation bar halfway down the image. Source images remain unchanged.

The sandbox initially blocked Chromium's macOS process service; the same local-only
check ran with approved process permissions. An optional offline formatter lookup
was unavailable; that is not a browser or product-test result. No broad historical
auth qualification was restarted.

## Deliberately smaller than the target product

- Concepts B/C change the primary object/navigation and use shared detail views.
  They are structural explorations, not three independently implemented apps.
- Prepare currently starts with all exact candidates. Checklist completion is
  demonstrated; arbitrary per-side proposal selection/negotiation remains specified,
  not a complete workflow. No matching algorithm asserts equal trade value.
- Search output is explicitly a species-number prefilter with existing localized
  `!traded` syntax. Exact costumes/BGs/forms remain manual; no claim that a search
  proves ownership, release status, trade eligibility or safe transfer.
- The local matcher uses fixture names and numeric species; the production design
  requires reviewed stable variant IDs. It is not reusable production identity code.
- BG exactness uses text because approved exact artwork is not supplied. No theme,
  skyline imitation or base art is presented as the captured background.
- Publication, stale/revoked link handling, offline save errors, server consent,
  back-stack restoration and complete screen-reader/browser qualification are
  future contracts, not completed by this prototype. The public example remains
  Mira's synthetic list regardless of the share sheet's selected export scope.
- There are no participant observations or measured competitor completion times.
  Proposed advantages and ranking weights are hypotheses for the roadmap's gate.

## Safety boundary

Only two non-runtime auth bookkeeping files accompany the isolated docs/prototype.
No app entrypoint, production version, Firebase Rule, runtime, IAM, provider flag,
deployment workflow, or existing product test is changed. Do not merge this branch
as a product release. Review the next-phase prompt in [the roadmap](11-roadmap.md).
