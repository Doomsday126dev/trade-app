# Research notebook: observations, not the recommendation

Observed 2026-09-05. Public pages only, fresh signed-out browser where practical.
No accounts created, posts published, contact initiated or competitor data imported.
Search results establish leads, not feature proof. O = directly observed controls;
D = provider documentation/claim; C = community anecdote; U = unverified.
No timed human usability study occurred. Dates/counts on sites are not independently
audited catalog completeness. Source artwork is not permission to redistribute it.

## Sources and bounded findings

**S1, 9db (O):** [generator](https://9db.jp/pokego/data/2235).
Two visual sections, per-section search copy, dex ordering, editable columns,
drag sorting, badge/memo and image output. Five saved slots require login.
English/Japanese controls observed. Listing backgrounds are presentation themes;
they are not proof of exact captured-background matching. Manual badge text is
flexible but cannot establish structured ownership or reciprocity. The owner's
supplied examples corroborate dense sprite-first output; they are not timing data.

**S2, Leek Duck (O):** [shiny checklist](https://leekduck.com/shiny/).
Web extraction saw only a shell; a fresh Chromium session loaded the real tool.
Observed nickname, owned/registered totals, extensive named costume/form picks,
save control and image width/scale/export. This is a shiny collection checklist,
not evidence of a dedicated two-sided offer ledger. A WC 2026 label was visible;
that does not certify every variant, its release eligibility or image rights.
[Historical community use](https://www.reddit.com/r/TheSilphRoad/comments/c2e5nd)
describes image/short-link sharing (C, 2019, not current persistence verification).

**S3, GO FRIEND (O):** [English maker](https://pokemongo-get.com/en_ntradeimage/).
Want/offer image creation, ten folders, optional names, sorting, text/search-code
output, normal/shiny/event/Dmax/Gmax filters, background/avatar uploads and a
posting flow. Social login is described for durable storage. English tool within
a mixed Japanese site. Uploading a background image is not evidence of a licensed
exact-background catalog. Posting/location controls were inspected, never used.
[Public trade board](https://pokemongo-get.com/bbs/201/?pages=33&prefs=8)
contains corrections to variant details and chat coordination (C); not a sample
from which to infer average failure rates.

**S4, PokeXperience (O/D):** [generator](https://pokexperience.com/trade/),
[matching](https://pokexperience.com/trade/matches/),
[guide](https://pokexperience.com/guides/how-to-make-a-pokemon-go-trade-list/).
Fresh browser verified separate add-to-FT/LF actions, device-save notice, optional
trainer/code, image theme and discoverability controls. Cross-device save uses
Discord login. Public matching documentation describes exact variants, mutual
swaps, close matches and sharing contact identifiers, with opt-out. Actual signed-in
ranking and exhaustive art coverage were not tested. Its surrounding product
promotes spoofing; do not copy that affordance or treat its trade-rule prose as
authoritative. The guide emphasizes variant clarity and removing stale offers.

**S5, PoGo Alley (D):** [public product](https://pogoalley.com/).
Describes exact form/shiny/costume/background reciprocity, newest-first results,
free listing and in-app messaging. This invalidates a claim that exact mutual
matching alone would be novel. Signed-in experience and privacy enforcement U.

**S6, Nexus Dex (D):** [trade tool](https://nexusdex.ai/pokemon-go-trade-matcher/).
Describes on-device Dex scans, friend linking, ranked suggestions, proposal/done
actions and contextual strings; full matching needs both people using its app.
Actual scan accuracy and possession inference U. This is a warning against
calling all trade preparation a unique feature. No subscription purchased.

**S7, community workflows (C):**
[2026 spreadsheet discussion](https://www.reddit.com/r/TheSilphRoad/comments/1smkz86/pokedex_tracker/)
shows people building missing-Dex search strings and struggling with mixed form
queries. [Vague-offer megathread](https://www.reddit.com/r/PokemonGoTrade/comments/1snih7h/megathread_looking_for_offers_vague_posts/)
shows that some people want open offers without precise wants.
[Background post](https://www.reddit.com/r/PokemonGoTrade/comments/1ubl8gd/background_trades_lf_first_ft_second/)
uses image order and private messages; a reply reports messaging friction.
These are purposive examples, not representative surveys. Do not infer prevalence.
Discord/Reddit are distribution and conversation layers. Their image posts lose
machine-readable intent and freshness; screenshots cannot be revoked after saving.

**S8, rules (D, primary):**
[official search reference](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/)
documents species numbers, shiny, costume, background/locationbackground and Max
tokens, plus logical operators. It does not document exact named costume/BG IDs.
[trading](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/96-trading-pokemon/)
and [friendship](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/2847-friend-list-friendship-levels-1614900279/)
must govern eligibility. Current friendship documentation includes Forever Friends
and remote opportunities: do not hard-code 'every trade always needs 100 metres'.
Do not promise remote eligibility from a PoGo Trades profile or compute fixed daily
special-trade limits from old competitor articles. Defer final eligibility to game.

**S9, assets:** existing reviewed `data/costume-sprite-catalog.json` and local GO
images are reused, with original provenance retained. [PokéAPI sprite README](https://github.com/PokeAPI/sprites)
allows downloading the repository; a bounded HOME sample is used for the prototype,
with the existing license notice. Pokémon rights remain with their holders.
No new background art imported, competitor screenshots republished, or costume
image silently replaced by a base species. Catalog metadata and artwork rights
are independent gates.

## Research limitations and next evidence

No competitor account signup, paid mode, full mobile journey timing or live
matching correctness test. GO FRIEND/9db public controls are richer than a simple
marketing comparison suggests; U must not become 'missing'. Native browser tool
timed out once; fresh Playwright supplied Leek Duck/PokeXperience evidence instead.
Our signed-in study uses source and existing synthetic visual evidence, not an
owner session. A prototype can validate comprehension and mechanics, not liquidity.
Next: observe a collector and a casual local trader making a list and identifying
a useful partner, plus an anonymous recipient. Measure misunderstandings as well
as time. Do not claim a measured 10x improvement before this.
