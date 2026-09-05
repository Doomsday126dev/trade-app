# Product diagnosis at .88

Method: current source at study base, `.88` manifest, existing approved synthetic
screenshots in `docs/product-audit/approved-evidence`, and public loader paths.
Not a fresh signed-in production walkthrough; no real account reads or edits.
Prior product-audit reports are historical evidence, not assumptions of current bugs.

## Core diagnosis

The app preserves intent carefully but makes the trainer manage too much of its
representation. List direction, old category, search preset, saved trainer scope,
comparison and export curation compete for attention before the next trade.
Do not erase the shipped improvements: My List already has explicit LF/FT,
Board is already selection over declarations, and Share already groups outputs.
The next gain is reducing modes and making reciprocal intent immediately useful,
not renaming those improvements as new features.

## Source-grounded observations

| Surface / source | What works | Friction / proposed challenge |
|---|---|---|
| `index.html` My List intent tabs and type tabs | Explicit offers, no possession inference | Direction then category makes a two-dimensional collection feel like separate editors |
| `js/app/application.js` unified list/render/share paths | Shared publication and edit flows | Large orchestration file retains many concept-specific state paths |
| `js/domain/tradeListComparison.js` | Exact qualifier keys, two reciprocal directions | Exact equality cannot express 'any BG'; wants overlap is not an offer |
| `js/domain/trainerDiscovery.js` | Name matching, saved/recent ranking | Reciprocal usefulness orders within name-search tiers; does not answer who is useful without a name |
| `index.html` saved-trainer Pokemon search | Scope explicitly says saved trainers' wants | A trainer may reasonably expect community-wide offer discovery |
| `js/domain/searchStrings.js`, `pokemonGoSearchSyntax.js` | Shared localization, length guards | Historic priority profile excludes shiny/BG and adds CP cap; inappropriate as universal collectible search |
| `index.html` share dialog, `publicShareApp.js` | LF/FT public projection, recipient copy | Publication vs saved vs rendered export are separate truths; must remain understandable |
| `specialTradeBoardExport.js` | Dense imagery, curated export | Configuration should not become another editable collection |
| `backgroundVisual.js`, `data/backgrounds.json` | Stable metadata separate from art | Historical feasibility docs recommend motifs; latest exact-art/text policy supersedes that direction |
| Settings/More/events/organizer | Secondary tools available | Multiple saved/history/tag concepts add navigation and retention obligations |

## Persona walkthrough hypotheses

| Trainer | Current conceptual cost | Better first useful action | Validation |
|---|---|---|---|
| New | Login/access before useful draft | Add one want locally | Time to first correct declaration, no auth change in prototype |
| Existing PIN | Fear redesign changes identity/login | Same credentials, same list | Familiar return and Saved semantics preserved |
| One-handed mobile | Category/mode/tool layers | Search and add near thumb, stable navigation | 320px, keyboard, large text, no accidental edits |
| 20 wants | Too much scaffolding per entry | Two compact sections on one page | Can describe both sides without switching modes |
| Hundreds | Repeated section controls, long scrolling | Filter, dex order, compact rows/grid, bounded pages | Find a named variant; retain filter after edit |
| Costume collector | Art and identity can disagree | Exact asset or explicit text-only identity | Missing costume is never base Pikachu |
| Background collector | Background meaning obscured by decoration | Exact named BG vs any BG as distinct intent | No themed rectangle masquerading as actual artwork |
| XL/random trader | Species catalog over-specification | Session intent 'random trades' plus optional species | Do not assert exact offers/counts from that preference |
| Event trader | Event browsing separate from actionable people | Optional meetup context on matches | No new calendar management obligation |
| Anonymous recipient | Must decipher image and message manually | Both sides + 'Check what I can offer' | No signup to inspect or build local candidate subset |
| Nearby discovery | Knows a Pokemon but not trainer name | Reciprocal results in chosen community | Coarse consented region, never inferred GPS |
| At meetup | Manual comparison-to-game handoff | Two search strings + private checklist | Never mark an in-game trade complete automatically |

These are expert walkthrough hypotheses, not measured user failure rates. We do
not know active-user distribution, dormant counts, or local match liquidity.

## Preserve strengths

Exact variants and reviewed asset provenance; dense board imagery; explicit FT;
anonymous useful public view; contextual local-language query infrastructure;
same-UID access; sync/recovery and privacy truthfulness. Avoid a rewrite that
loses these just to gain a tidier component tree.
