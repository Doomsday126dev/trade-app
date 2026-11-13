# Bounded catalogue review — 2026-11-13

## Verified refresh

128 PokemonDB GO sprite source pages were fetched completely on 2026-11-13 at 06:04:04 UTC. Parsed filenames and labels exactly match the existing snapshot: zero changed pages, zero integrity problems, zero new missing identities. The snapshot timestamp is refreshed based on that complete observation, not a blind expiry extension. Existing 396 exact mappings and seven ambiguous identities are unchanged. No artwork, runtime catalogue, baseline expiry, or deployment changes.

Five Sendai holds were reviewed against https://pokemongo.com/gowildarea/sendai/gameplay : November 6–8 debuts for Dynamax Dialga/Palkia, Gigantamax Duraludon, Hisuian Sliggoo, and Goodra through 100 Candy evolution. Their status now says official debut date passed rather than a still-future announcement. This is official date evidence, not independent field confirmation or blanket tradability/artwork approval. Exact identity/art qualification remains a hold. Other holds were not reverified.

## New evidence requiring a separate implementation review

- https://pokemongo.com/news/forever-stamp-rally-go-wild-area-2026 : ongoing from November 2, 16:00 PST; Lapras with Sendai•Tohoku Location Background and Hawlucha with Mexico City Location Background, both shiny eligible. Qualify exact background images and identities; do not reuse 2024 art.
- https://pokemongo.com/news/clefable-super-mega-raid-day-2026 : Mega Clefable November 28, 14:00 local. Future, not released as of this review.
- https://pokemongo.com/news/dynamax-trails-eternamax-eternatus-2026 : November 16–23 future background opportunities exclude Legendary/Mythical. Eternamax Eternatus cannot be caught; never infer a tradable form from its battle appearance.
- https://pokemongo.com/news/twilight-wishes-2026 : November 24–30 reruns existing costumes, not newly established identities.
- https://pokemongo.com/news/pokemon-center-bangkok-opens-2026 : December 1–10; no Pokemon debut stated.
- https://pokemongo.com/news/save-the-date-s25 : calendar, no species identity.

Other reviewed English leads: black-friday-2026 (shop); community-meetups-go-wild-area-2026-details-asia-pacific (venues); gowildarea-global-2026-osaka-gameplay-update (local adjustments); gowildarea-mexicocity-friday-update (physical experiences, gameplay unaffected); pgo-explorer-gadget-2026-update (UI); get-ready-for-gowildarea-2026 (background display is not acquisition debut); gowildarea-2026-timed-research (existing Gmax Machamp).

Scope: all 13 newly flagged English articles plus Sendai gameplay and Seasons. Korean-only leads and the full 1,618-row independent-inventory queue were not exhaustively reviewed. Therefore the bilingual discovery baseline, release inventory review date, seven ambiguous-identity review dates and expired acknowledgement baseline are intentionally NOT renewed. Freshness may remain red until those separate reviews are complete; this patch must not claim a fully current catalogue.

## Validation and runtime checks

- 38 sprite freshness/catalogue/deployed-catalogue tests passed after snapshot refresh.
- 16 release discovery/coverage tests passed after hold evidence update.
- The unchanged failed performance job was rerun successfully: https://github.com/Doomsday126dev/trade-app/actions/runs/43056060020/job/131722429897 . Static contracts and constrained browser budgets passed. Earlier failure was Ubuntu DNS during browser installation, not app assertions.
- No deployment performed. Signed-in mobile checks are tracked separately; local browser launch was blocked by execution-environment socket permissions, so no passing UI claim is made here.
