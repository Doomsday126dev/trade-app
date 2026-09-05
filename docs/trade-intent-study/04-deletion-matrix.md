# Delete before simplify

Product concepts, not permission to erase data. Every retirement depends on the
archive/compatibility gates in [legacy retirement](09-legacy-retirement.md).

| Concept | Decision | Replacement / preserved value |
|---|---|---|
| My List | KEEP | Trainer's explicit trading intent, not game inventory |
| Separate LF/FT editing modes | MERGE | Both sections; common add/editor with independent want/offer controls |
| LF/FT meaning | KEEP | Never infer offer from owned, registered, absent, or wanted |
| Permanent Max/costume list tabs | MERGE | Typed variant attributes and filters |
| Separate Board entity/editor | REMOVE | Share selection references source entries; preserve historic selections as presets |
| Compare as destination/name | REMOVE | 'You give / You receive' inside a trainer or share |
| Wants-in-common | DEMOTE | Optional context, never a reciprocal match |
| Events destination | DEMOTE | Optional community/meetup context; browse via account menu initially |
| Calendar/event aggregator | DEFER | Existing events accessible; no new aggregation backend |
| Favorites / saved trainers | MERGE | One private Saved filter under People |
| Recents | DEMOTE | Search suggestions, not another collection/tab |
| Pokemon Favorites | DEMOTE | Existing private selection accessible through advanced filter; don't conflate with game favorite |
| High/Medium/Low | SIMPLIFY | 'Top want' is primary; preserve existing tiers in advanced detail until explicitly converted |
| Private tags | DEMOTE | Advanced filters; retain text/private ownership, exclude public projections |
| Trainer history | DEMOTE | Recent shared-list changes on that trainer; archival history export |
| Public profile | SIMPLIFY | Intent, chosen community, availability freshness, optional contact |
| Profile browsing directory | MERGE | People results driven by trading usefulness; name lookup remains |
| Multiple discovery search surfaces | MERGE | One People search and scope selection |
| List tools menu | REMOVE | Actions on selection; advanced import/export in account |
| Image theme/config wizard | SIMPLIFY | Useful default; output type and scope only; advanced sizes optional |
| Share Link/Image/Text | MERGE | One Share flow with output selector, one selected set |
| Background feature/page | REMOVE | Exact/any typed qualifier, approved art or text |
| Inventory numbers/mirror flags | REMOVE | No new stock ledger or mirror symbols; retain historical data only in archive |
| App account vs trainer handle vs provider | SIMPLIFY | One account to user, immutable UID internal; sign-in methods secondary |
| Admin diagnostics and reset | DEMOTE | Owner-only maintenance; not normal navigation |
| Search-string tool destination | REMOVE | Copy from current side/selection/match/session |
| New internal chat | DEFER | Prepared message handed to existing chosen channel |
| AI recommendations | REMOVE | Deterministic qualified intersections with explanations |
| Market price/rarity score | REMOVE | User's own top wants; no global bargaining authority |
| Safe transfer automation | DEFER | Separate high-risk action; trade search is never transfer advice |

## Do not build

Do not build a second Pokemon inventory, a social activity feed, raid coordination,
an AI broker, spoofing/travel automation, a map with exact home coordinates, public
ratings for people, an internal currency/escrow marketplace, inferred owned Dex,
per-collectible top-level modules, background facsimiles, automatic offer deletion
after checking a session item, or new chat storage before existing channels fail.
Do not add onboarding questions whose answer is not needed for the next action.
Do not delete audit receipts to reduce noise. Hide them from normal UI, preserve
their role and exportability. Do not maintain dual writes forever 'just in case'.
