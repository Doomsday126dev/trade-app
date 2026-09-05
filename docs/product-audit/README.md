# PoGo Trades: End-to-End Product Review

## Approved Decision Implementation

The owner approved LF/FT under My List, My List / Trainers / More navigation, and Share / Link / Image / Text. These are implemented as a working **product draft**, not a release.

Read [the current A-P report](approved-implementation.md) first. It supersedes the recommendations and pending-fix status in the historical audit below and includes screenshots, exact commands, compatibility limits and test rationalization.

- Implemented: explicit intents; Board as selection/export over the same declaration view; More navigation; Share modes; empty search suppression; neutral public priority; publication-before-copy with persistent failure/retry feedback; friend-code copy; truthful comparison and saved-trainer discovery wording.
- Compatibility: exact duplicates display once; different records remain reviewable; original physical records remain readable. **Canonical deduplication is not complete or exposed.** Removing a categorized copy before public sharing supports its replacement could remove published data.
- Public Link retains the existing categorized LF contract, not unified LF/FT. Images and text use the declaration view. No provider infrastructure or public schema was changed to conceal this limit.
- Test cleanup: one duplicate static block consolidated, arbitrary registry totals replaced with semantic checks, outdated source guards replaced/updated with behavior tests, and legacy fixture stubs repaired. Zero safety suites deleted. Files: 183 baseline, 184 current.
- CI: path-selected product/sync/privacy/release contracts and affected Chromium journeys; unrelated documentation skips performance. Mandatory release controls are unchanged. No PR #63 tests were run.

### Updated Roadmap

| Tier | Status / Next |
|---|---|
| 1 | Empty searches, neutral public priority and publication truthfulness fixed in draft. Before release, close the public-projection / canonical-consolidation gap and qualify that exact migration. |
| 2 | Approved navigation, intent, Share, Board curation and comparison draft is reviewable. Finish unified LF search presets and category simplification after the data contract is settled. |
| 3 | Physical-device accessibility, broad browser coverage and large-list performance remain separate qualification. No live canary is authorized by this document. |

## Historical Audit

The original baseline audit below is retained for traceability. Its recommendations are not new approval requests.

Review date: 2026-09-04. Baseline: main `794f8dbe08ee30a7de29ca73013b5ad77070ad44`; production `2026-08-31.86`. Proposed changes only on `product/astra-end-to-end-review`.

## Evidence and Scope

**Reported** means owner/user feedback in this task, including roughly 50 real users, missing public searches, previous sprite/board problems, and previously confirmed sync/provider checks. **Observed** means current production navigation/screenshots or local execution explicitly identified below. **Source** means implementation inspection, not a newly executed production proof. **Opinion** means a proposed product/design direction, not a measured user failure.

Production inspection covered an already authenticated non-owner session, My List, List Tools, qualifiers, trainer discovery, a published trainer, wanted-list comparison, Events, Profile/Settings, narrow 320 px layout, and direct anonymous share. No production data was deliberately edited. Production screenshots remain in the workspace's sibling `product-audit-evidence` directory; they are not uploaded in this review.

The existing synthetic local journey exercised add/change priority/remove, Favorites/Recents/Find by Pokemon, comparison, Events, Settings, board editing surface, Markdown/CSV, and locale changes. Public-route tests exercised fresh contexts, direct URLs, categories, clipboard success/denial, empty/unknown data, privacy boundaries, four languages, and four widths. Synthetic screenshots use fake identity/data; public test sprites are deliberate geometric fixtures, **not artwork-quality evidence**.

Coverage limits: no new live account registration, provider linking, admin mutation, cross-device canary, OS installation, physical iOS keyboard test, or screen-reader listening session. Existing real-user confirmations are evidence, not substituted with an invented new acceptance gate. PWA persistence/recovery and production identity are source/prior-evidence review here, not recertified by this audit. Inventory covers all tracked files and test declarations structurally; detailed semantic review concentrated on user-facing paths, their shared helpers, and test/release boundaries. This is not a line-by-line security re-audit of every backend module.

## A. Product North Star

**Build an accurate trading intent, share it, find someone useful, and prepare the trade.**

Success is a recipient moving from a shared link to a useful Pokemon GO search and a clear way to contact the trainer. It is not the number of settings, badges, or infrastructure stages exposed.

The strongest existing assets are persistent owned lists, exact qualifier data, no-login public projections, practical exports, and explicit recovery. Preserve those. The largest conceptual weakness is that **a wanted-list overlap is not a reciprocal trade match**.

### Competitor Expectations

Reviewed current public pages, not their claimed adoption or private account flows. No competitor assets were imported and no external accounts were created.

| Reference | Observed / documented expectation | Match, improve, or intentionally differ |
|---|---|---|
| [9db Trade List Generator](https://9db.jp/pokego/data/2235) | Explicit Wanted / Can offer areas, adjustable dense image grid, sorting, search copy, save/export; browser inspection showed the actual two-sided canvas below considerable page/ad chrome | Match the clear two-sided intent and compact exports. Improve direct list access and next actions; do not copy its surrounding clutter |
| [LeekDuck Shiny Checklist](https://leekduck.com/shiny/) | Visually inspected dense species/form tiles, ownership/registered counts, export controls, costume distinctions | Match recognizable artwork and scan density. It is a checklist reference, not evidence of a reciprocal trading engine. Do not reintroduce stock counters into the approved board |
| [GO FRIEND trade image generator](https://pokemongo-get.com/en_ntradeimage/) | Public generator exposes category filters, optional names, sorting and image download; login is associated with persistence rather than just viewing a tool | Match easy export and optional labels. Improve reliable, no-login shared links and honest exact-form semantics |
| [PokeXperience trade tool](https://pokexperience.pages.dev/trade/) | Public product describes For Trade / Looking For and matching, including distinction between close and exact matches | Use explicit direction and match confidence if PoGo gains declared offers. This audit did not verify their private matching accuracy or user base |

These are interaction references, not proof that PoGo should inherit every feature. The app can be better by reducing steps from received link to useful search/contact, keeping exact intent visible, and avoiding advertisements and unnecessary account gates. No claim of being “better than every site” is supported by a few screenshots.

## B. Current Journey Map

| Step | Current path | Evidence / friction |
|---|---|---|
| First visit | Username/PIN; request access; public links bypass login | Observed/source: account gate dominates the app entry; useful anonymous route exists |
| Sign in | Approved username + PIN; recovery helper | Reported: owner tested access; no new credential test here; future Google source is not public rollout |
| My List | Trades / Dynamax / Gigantamax / Others | Observed: first category really stores wants; Others hides costume/form meaning |
| Add | Search, priority, Add; Flags & details | Local journey passed; empty account banner competes with Add on 320 px |
| Refine | Priority, shiny/lucky/size, variant, background; row edit | Rich data; multiple entry surfaces and decorative badges add cognitive load |
| Special board | List Tools -> Special Trade Board; separate LF/FT entries | Observed local: distinct saved board; stale inventory-import wording |
| Export | List Tools: two images, board, Markdown, CSV | Source/local exports: useful formats, flat menu mixes creation/editing/sharing |
| Share link | Copies URL, then starts publication | Source: recipients can beat publication; copy success is not publish success |
| Anonymous | Separate public renderer, categories, priorities, CTA | Observed production: search copy missing; restored in this draft |
| Discover | Trainers / Favorites / Find by Pokemon | Observed: separate scopes; Pokemon lookup is favorite-scoped, not global inventory |
| Compare | Trainer -> Compare with My List | Observed: Both Want / Only I Want / Only They Want; no ownership inference |
| Prepare | Search strings and external contact | Fragmented between own list, trainer page and exports |
| Events | Primary nav; filters + calendar + feed | Observed: useful reference, weak connection to actual trading intent |
| Profile/settings | Account menu -> Settings -> six sections | Observed: public profile, utilities, recovery and technical detail are interleaved |
| Return/cross-device | Saved state, pending/recovery UI | Reported successful prior tests; source preserves mutation/recovery boundaries |

## C. Ideal Journey Map

| Goal | Information needed | Primary action -> next | Remove or reduce |
|---|---|---|---|
| Understand a received list | Trainer, wanted category, exact qualifiers, freshness | Copy category search -> inspect own storage | Login demand, signup competing with copy |
| Start own list | What the list represents | Add Pokemon -> optional qualifiers | Full onboarding banner once entries exist |
| Express intent | Looking For versus For Trade, exact variant | Save entry -> next entry | Implicit meaning of Trades; inventory quantities |
| Share | Exactly which entries will be visible | Share -> copy published link or export image | Publication internals and fragmented export locations |
| Find trainer | Name or Pokemon plus explicit search scope | Open trainer -> inspect useful overlap | Three unrelated search mental models |
| Evaluate match | Wants and declared offers, freshness, qualifiers | Select useful entries -> copy search/contact | Calling two wants a have/want match |
| Prepare trade | Friend code, optional Discord, selected Pokemon | Copy code/contact -> coordinate externally | New internal offers, reservations, quotas or inventory ledger |
| Return | Last list/category, saved trainers, save health | Resume editing | Repeated tours and technical status when healthy |
| Recover | What is safe, what needs choosing | One specific recovery action | Raw architecture names or silent destructive replacement |

No new trade-completion tracking is proposed. Finish coordination in the existing channel; a lightweight list edit is enough afterward.

## D. Top 10 Findings

| Rank | Finding | Evidence and impact | Disposition |
|---|---|---|---|
| 1 | Anonymous recipients cannot copy search strings in production | Reported + observed direct URL; blocks a core trading action | **P1 fixed in draft**, not deployed |
| 2 | Wanted overlap cannot answer “they have what I want” | Observed Compare; source `tradeListComparison`; false ownership inference would damage trust | Keep truthful wanted wording; owner decision on unified offer intent |
| 3 | My List can render flag search blocks with no species | Observed trainer output + `buildStrings` calls canonical helper on empty flag arrays; helper returns filter prefix | Before beta, suppress empty-source blocks in a narrow follow-up; do not change serializer globally |
| 4 | Anonymous display invents Low priority for an unprioritized entry | Observed Baltoy appears Low publicly but flag-only internally; `entryModel` defaults to L | Before beta, use a neutral “Other entries” group or preserve no-priority explicitly |
| 5 | Sharing is a copy-then-publish race | Source `copyShareLink` copies before async publish and recovery toast; recipient can see stale/unpublished list | Separate copied/published states; preserve full hydration gate |
| 6 | Public locale support stops before Pokemon/form/background names | Observed JA local screenshot: Pikachu/Eevee/Chicago 2026; production Garden lacks Vivillon prefix | Reuse canonical display-name path without changing stored keys |
| 7 | First action is pushed down on narrow empty accounts | Observed production 320: tall identity/banner/category stack; long trainer name clipped | Long-name wrapping fixed; compact empty state/navigation needs design decision |
| 8 | Discovery scope is easy to misread | Observed three tabs; source favorite catalog excludes global directory | Label “Search saved trainers' lists”; retain name search as global visible directory |
| 9 | Board and list describe separate intents and styling systems | Reported board revisions; observed editor still says “add from your inventory”; renderer/export are independent | Keep accepted dense artwork export; unify entry model only with approval |
| 10 | Tests protect source shape more than some real recipient flows | Static “public share” tests inspect authenticated `renderShareView`; initial synthetic PIN fixture was stale | Added actual anonymous route contracts; corrected fixture; conservative test rationalization |

Ranks 2, 5, 7-9 are product/UX impact judgments grounded in observable behavior, not newly measured churn. No new data-loss incident was established.

## E. Feature Disposition

One primary recommendation per meaningful feature. “None” means no data migration. Rows marked merge/remove describe proposals, not changes made.

| Feature | Purpose / evidence | Problem | Primary recommendation | Migration impact |
|---|---|---|---|---|
| My List | Core list; 50-user reported use, exercised locally | Trade versus want unclear | **SIMPLIFY**: explicit intent | Preserve keys and entries |
| Wishlist / Trades category | Main wanted collection | Generic label | **SIMPLIFY**: Looking For | Label-only initially |
| Dynamax | Special capability | Separate category still useful | **KEEP** | None |
| Gigantamax | Distinct exact form | Long mobile label | **KEEP**; abbreviated visible label with full accessible name | None |
| Others / Costumes | Event-specific entries | Others is not findable terminology | **SIMPLIFY**: Costumes & Forms where accurate | Audit entries before relabeling |
| H/M/L priorities | Rank wants | Mixed with no-priority flags | **KEEP**; neutral unprioritized group | No silent priority conversion |
| Shiny | Exact wanted state; owner requested sparkle | Different presentation across surfaces | **KEEP**: clean sparkle, accessible text | None |
| Gender | Exact variant | Duplicate decorations in internal share | **SIMPLIFY**: one aligned symbol | Preserve mod/gender values |
| Lucky / XXL / XXS | Conditional trade intent | Competes with priorities | **KEEP** in optional details | None |
| Variant details | Form precision | Free text versus structured form can diverge | **SIMPLIFY**: structured first, note only when needed | Preserve legacy notes |
| Background qualifier | Exact requested provenance | Catalog labels may imply art support | **DEMOTE** to optional exact-match detail | Preserve IDs; no imaginary operators |
| Backgrounds on image board | Owner rejected labels without real art | Cannot represent supported artwork completely | **REMOVE** from board contract, as already retired | Preserve underlying old data, never silently encode labels as art |
| Add/autocomplete | Fast entry | Multiple similar search fields | **KEEP**; scope-aware labels | None |
| Voice entry | Optional fast input | Permission/device variability | **DEMOTE** to input accessory | None |
| Row editing | Repeated core action | Hover-heavy desktop interactions | **SIMPLIFY**: predictable inline or sheet controls | Same mutation contract |
| Mobile editing | One-hand entry | Header/control stack consumes viewport | **SIMPLIFY**: focused edit sheet; Add reachable | No data change |
| Reorder/sort | Personal ranking / scanning | Mode and command mixed | **KEEP** in list overflow | Preserve manual order |
| Bulk edit | Power-user efficiency | High-impact actions | **KEEP** with scoped count/undo where supported | Preserve tombstones, no broad rewrites |
| Speed add | Multi-entry efficiency | Parallel creation concept | **MERGE** into repeated Add mode | Preserve import/intent parser |
| Search-string import | Populate many species | Cannot reconstruct unsupported exact variants | **KEEP** with honest scope | Never fabricate qualifiers |
| My List filter | Scan a collection | Competes with Add search | **KEEP** with distinct label and compact placement | None |
| List Tools | Entry point to occasional commands | Editing, sharing and creation intermingled | **SIMPLIFY**: Share prominent, edit utilities overflow | Route aliases preserved |
| Search strings | Prepare storage | Empty flag blocks; coarse default filters | **KEEP** canonical generator; expose supported scope | No new operators |
| Classic image / Dark image | Social export | Two format entries | **MERGE** into one image export with theme control | Retain equivalent output modes |
| Markdown | Discord/Reddit sharing | Hidden but valuable | **KEEP** under Share | None |
| CSV | Portable structured data | Not primary social action | **DEMOTE** to export submenu | Preserve all fields |
| Copy share link | Core distribution | Published state unclear | **KEEP**, distinguish publication result | Preserve sanitizer/hydration |
| Special Trade Board | Curated LF/FT image; owner approved | Separate saved list/model | **MERGE** conceptually into My List -> Board export | Requires explicit LF/FT migration, not inferred stock |
| Dense board export | High-value visual artifact | Artwork gaps; accepted current design | **KEEP** approved sprite-only layout | No mirror, counts, background labels or question marks restored |
| Trainer name search | Find known people | Scope not explained | **KEEP** | Preserve visibility rules |
| Name suggestions/typo matching | Fast discovery | Potential ambiguous identity | **KEEP** exact identity confirmation | Never merge similar handles |
| Favorites | Repeat traders; reported cross-device tests | Term implies preference more than useful contacts | **SIMPLIFY** label to Saved trainers | Keep IDs/tags/order |
| Recents | Resume last interaction | Competes with favorites display | **MERGE** within Trainers landing section | Preserve bounded history, no new remote history |
| Private tags | Organize frequent traders | Extra organizer layers | **DEMOTE** to saved-trainer filtering | Preserve private tags and ownership |
| Find by Pokemon | Locate relevant saved lists | Sounds globally comprehensive | **MERGE** into discovery with explicit Saved scope | Preserve narrow public reads |
| Trainer public profile | Identity/context | Friend code not an action; initials differ from avatar | **SIMPLIFY**: identity + copy code + current list | No additional private fields |
| Compare | Identify exact wanted overlap | Not reciprocal matching | **KEEP** truthful comparison on trainer page | No claim of possession |
| Reciprocal have/want matching | Future useful trade selection | No integrated declared offers | **DEFER** until owner chooses intent model | No inventory inference |
| Events | Current game reference | Primary nav without trade action | **DEMOTE** to More | Preserve event URLs/filter state |
| Event filters/calendar | Find relevant dates | Date repetition and dense chrome | **SIMPLIFY**: upcoming list first, calendar optional | No migration |
| Friend code | Start actual trade coordination | Display/edit/copy fragmented | **KEEP** one editable profile field, copy on public page | None |
| Discord handle | Existing contact channel | Plain text | **KEEP** optional; copy action | Do not imply Discord auth enabled |
| Bio | Trade preferences/location context | Long text can dominate | **KEEP** bounded optional field | None |
| Avatar | Recognize trainer | Public/internal mismatch | **KEEP** one policy-compliant display path | Preserve selected ID |
| Profile editing | Public identity maintenance | Buried in Settings | **SIMPLIFY** one profile form | Preserve identity immutability |
| Language | Recipient understanding | Name catalogs incomplete on public path | **KEEP** viewer-controlled | Never overwrite owner data |
| Search language override | Different game/app language | Adds another setting | **DEMOTE** advanced; public uses explicit viewer priority | Preserve browser preference |
| Appearance | Light/dark | Duplicate topbar and settings action | **SIMPLIFY** one predictable setting | Preserve local choice |
| Account & Security | Login/recovery | Technical framing | **KEEP** plain sign-in methods and recovery | Identity architecture untouched |
| Username/PIN | Existing approved access | New-user friction | **KEEP** compatibility/recovery | Never reset identities for redesign |
| Google onboarding | Future lower-friction access | Public rollout blocked independently | **DEFER** to existing identity release process | No rollout action in this audit |
| Discord sign-in | Future method | Unavailable to users | **DEFER**; keep hidden publicly | No enablement |
| Request access | Controlled admission | User needs product context before form | **SIMPLIFY** concise preview + request | Preserve approval/identity guards |
| Saved indicator | Trust | Red preserved-count copy can be alarming | **KEEP** quiet green; specific action only on exceptions | Preserve recovery state machine |
| App & Data / diagnostics | Troubleshooting | Technical details burden normal users | **DEMOTE** details behind “Save status” | No removal of evidence/recovery |
| PWA install | Frequent mobile return | Install entry deep in Settings | **KEEP** optional; contextual after real use | Preserve SW/version contract |
| Shortcuts | Power-user navigation | Not core first visit | **DEMOTE** to Help | Keep keyboard parity |
| Safe-to-transfer string | Prune storage against selected wants | “Safe” is too absolute; potentially consequential | **SIMPLIFY**: “Review transfer candidates” | Preserve safeguards; never automate transfer |
| Legal/asset attribution | Transparency | Information still needed | **KEEP** accessible footer | Source licenses/policy unchanged |
| Admin approval/reset | Owner operations | Mixed legacy remnants | **KEEP** owner-only, task grouped | Protect current rules and audit trails |
| Backup export | Recovery/portability | Dangerous if broad data exposed | **KEEP** restricted admin path | No new public export |
| Legacy Inventory archive | Recover old data | Old product vocabulary | **DEMOTE** read-only archive | Preserve records + CSV until compatibility decision |
| Old offers/community/trade scheduling/quota UI | Retired product | Large dormant implementation | **REMOVE** reachable product paths; already mostly quarantined | Delete code only after call graph/legacy window; never purge records now |
| Repeated onboarding/tour | Orientation | Interrupts repeat use | **REMOVE** redundant recurring explanation | Keep first useful empty state |

## F. Navigation Recommendation

**Mobile bottom navigation: My List | Trainers | More.** Desktop uses the same three destinations in a compact header. Profile remains reachable from the avatar. More contains Events, Settings, Help; Admin appears only to authorized owners.

My List contains category filters, Add, and a prominent **Share** command. Share offers **Link**, **Image**, **Text**, and secondary CSV. **Board** belongs inside image creation, not another top-level destination. Compare belongs on the trainer page, not primary navigation.

If approved, My List gains **Looking For | For Trade** intent views, using the existing board offer declarations as explicit input, not as inventory quantities. Until then retain current wanted-only semantics and call the image tool **Trade Board**, not a promise of matching.

This is a recommendation, not implemented navigation. A fourth top-level Events tab is not justified by current observed trade actions; this is design judgment, not usage telemetry.

## G. Screen-by-Screen Design Review

| Screen | Desktop | Mobile | Recommendation |
|---|---|---|---|
| Sign-in | Large form and explanatory paragraphs | Multiple identity paragraphs before action | Product preview from share, concise sign-in/recovery copy; no public provider exposure |
| My List populated | Add/filter/tool bars dominate above rows | At 320, first row only starts near viewport bottom | One compact header, Add primary, filter secondary, visible Share |
| My List empty | Tall banner duplicates two nav actions | Banner consumes most first viewport | Single meaningful Add prompt, no box within box |
| Entry row | Small sprites, names and qualifiers useful for editing | Interactive controls need persistent targets | Keep names in editing list; sprite-only applies to board export, not every surface |
| Trainer discovery | Tabs/search/recents use inconsistent widths | Nested modes require reach to top | One search scope selector and saved/recent sections |
| Trainer page | Dense useful content; identity metadata passive | Long list needs category context | Copy search primary; copy friend code secondary |
| Compare | Three columns of wanted overlap | Three long stacked result groups | First show useful counts, expand one group; retain exact qualifier explanation |
| Anonymous share | Isolated, fast, read-only; no copy previously | Four-column desktop becomes legible single-column | Restored category copy near tabs; signup remains subordinate |
| Board editor | Two framed columns, imports mention inventory | Modal must stack and preserve controls | Keep accepted output; fix editor terminology without redesigning approved art |
| Events | Calendar + up-next + filters + grouped list | Date/filter chrome competes with events | Upcoming first; demote calendar to optional view |
| Settings | Six sections in a large modal | Full-height panel, long PIN space, nested Back control | Profile, Preferences, Sign-in & Recovery; utilities move to owning workflow |
| App status | Healthy state quiet; recovery detail visible | Preserved counts consume header width | “Saved” normally; human-action message on exceptions, diagnostics collapsed |
| Legacy/Admin | Source-only owner/path review | Not exercised as live owner | Keep archive/access guard, no new top-level legacy navigation |

**Cohesive direction:** compact trading utility, Pokemon art as the content, 8 px spacing rhythm, restrained neutral surfaces, one accent for commands, red/amber/green for meaningful state only. Use existing shared button/icon tokens; do not add another design system. Standardize 44-48 px interactive targets, tight section headings, stable sprite columns, and one qualifier treatment. Reduce nested cards, strong shadows and repeated help. Keep names in operational rows, omit them in the approved dense board. Do not add mirror symbols, stock quantities, lightning for shiny, or background names masquerading as artwork.

Evidence images are linked in the [visual evidence index](evidence.md).

## H. Public Share

### Restored contract

The anonymous bootstrap now loads the existing `pokemonGoSearchSyntax` and `searchStrings` helpers, without loading Auth or the private application. Each nonempty displayed category has one explicitly named **Copy [category] search string** action near its tabs. The button and disclosure use the same generated bytes.

Viewer active language wins; saved supported browser choice then supported browser language then English initialize it. Invalid saved locale now falls through to supported browser language. Changing the viewer language updates labels and output without reading private data or changing the owner's projection. EN/JA/ES/DE are covered.

Copy success has a polite status announcement. Clipboard denial exposes and selects the read-only string with failure feedback. Unknown Dex mappings disable copying rather than silently dropping entries. Over-limit strings are visible but not offered as a successful copy. Empty categories have no control. Language dialog supports Escape, focus return, and keyboard wrapping.

### Precision boundary

The canonical generator currently uses **Dex numbers plus the existing trade prefilters**, not exact form/gender/costume/background matching. Default priority query excludes shiny, traded, shadow, purified, backgrounds and 4-star, with CP-2500. This is existing behavior, not a newly invented exact query. A shiny/background-marked wanted list therefore does not become an exact shiny/background query just because its species are present.

The restoration preserves those existing semantics and discloses the limitation. It does **not** invent event-background operators, localize stable stored IDs, or claim to select exact costumes. Expanding canonical qualifier-aware search is a separate product/technical change requiring supported operators and regression tests across all consumers.

### Minimal next actions

1. Copy displayed category search (implemented).
2. Copy friend code (recommended next small action, no extra login).
3. Create own list remains a quiet secondary link.

An authenticated “Compare with My List” can be offered through the existing app route, preserving anonymous isolation. Saved trainer/contact belongs after sign-in; do not load a private session into every public page. Share onward should use the browser share action or copied URL, not another large CTA.

Remaining defects: raw public Pokemon names, no-priority default to Low, plain friend code, publication race, and question-mark fallback on ordinary public rows when exact art is unavailable. The board deliberately excludes unavailable artwork; do not silently remove named entries from the textual public list.

## I. Mobile Review

| Width | Observed verification | Main finding |
|---|---|---|
| 320 x 568 | Production My List/Profile; local public JA and synthetic core screens | Empty banner/header height is expensive; long name wrapping fix; no horizontal document overflow in tested local screens |
| 390 x 844 | Local public ES and My List/discovery/settings | Touch-safe controls, but top navigation and large forms consume reading area |
| 430 x 932 | Local public DE and same authenticated layouts | Room to increase useful row density, not scale fonts with viewport |
| 1440 x 900 | Production + local flows, public EN | Several screens underuse width while controls remain oversized |

The installed experience shares the layout; manifest requests standalone display and CSS includes safe-area/reduced-motion handling. That does not prove an installed iOS keyboard or interrupted-update scenario. No new physical-device test is a gate for this product review. Existing owner cross-device/offline confirmations are retained as reported evidence.

Future layout: bottom destinations with safe-area padding, Add reachable by one hand, sheet content independently scrollable, no fixed footer covering keyboard input, preserve selected category and query when returning. Validate real visual viewport behavior when implementing that redesign, not as another full historical matrix now.

## J. Accessibility

Implemented low-risk defects: anonymous language dialog Escape/focus containment and return; copy result is a live status; visible keyboard-selectable fallback; 44 px search disclosure; wrapped long names.

Existing strengths: priorities carry letters/labels as well as color, row removal has named controls, settings fields have labels, reduced-motion rules exist, legal dialog is reachable, tested row controls reach 44 px.

Remaining: public category rerender replaces the focused button node; restore focus to the newly selected category. Audit unnamed autocomplete fields against actual computed accessible names, not placeholder presence. Mixed decorative and meaningful gender/shiny symbols need one spoken representation. Background labels must remain legible without color. Tall settings require predictable focus on section change. “Safe to transfer” needs less absolute wording.

No blanket WCAG compliance claim: sampled keyboard/target behavior was tested, not complete screen-reader or contrast certification. Color-token presence and screenshot appearance are not contrast measurements.

## K. Localization

The restored output follows viewer locale; owner locale does not participate. Tests cover saved JA over browser default, saved ES over DE, invalid saved FR falling to browser DE, unsupported browser FR falling to EN, and active switches among all four languages.

Material gaps: anonymous Pokemon/structured form names remain English; some background labels and Privacy footer copy remain English; public “Garden” versus internal “Vivillon (Garden)” loses species context. Translations for “Others”, “Trades”, “Find by Pokemon” should follow the final product scope, not receive a stylistic rewrite first.

Key parity is useful but insufficient: non-English catalogs spread the English catalog, so inherited untranslated entries can pass parity. Two brittle exact total-key-count assertions were replaced with required-key checks; parity and actual rendered/copy checks survive. English fallback remains important; never translate stable account keys or search IDs.

## L. Technical Complexity

Source metrics: `application.js` 14,872 lines / 898,001 bytes; CSS about 273 KB; index about 135 KB. Counts are working-tree text metrics, not transferred/gzipped payloads. [Source inventory](source-inventory.csv) and [application function map](application-functions.json) make the inspection reproducible.

| Area | Timing class | Recommendation |
|---|---|---|
| Anonymous copy and language dialog | **SAFE NOW** | Small independent UI fixes implemented |
| Empty source flag-search blocks | **SAFE NOW** | Guard source arrays at `buildStrings`, not globally changing serializer |
| No-priority public grouping | **SAFE NOW** | Preserve neutral state; do not mutate stored priority |
| Repeated literal locale/release counts | **SAFE NOW** | Keep coherence/required-key invariants, remove arbitrary totals |
| Repeated display/qualifier rendering in private/public/export | **AFTER PROVIDER ROLLOUT** | Share pure display models, keep separate privacy-capability entry points |
| account/profile/public projection validators | **DO NOT TOUCH** casually | Different trust boundaries: client sanitization does not replace server validation |
| Local history/cache + account-sync projection + legacy sync queue | **AFTER PROVIDER ROLLOUT** | Document store ownership; redundant-looking stores have offline/migration roles |
| Oversized application: auth, sync, list, discovery, events, export, admin, legacy | **AFTER PROVIDER ROLLOUT** | Extract by owning feature only while changing it; no mass split |
| Legacy inventory editing, offers, reservations, quota/schedule rendering | **AFTER LEGACY COMPATIBILITY WINDOW** | Remove unreachable code after reference/capability audit, retain read-only data/export until approved |
| Old feature flags and community schema | **AFTER LEGACY COMPATIBILITY WINDOW** | Prove consumers and read boundaries before retirement |
| Provider creation/linking, UID/handle mapping, Rules, migrations, canary operators | **DO NOT TOUCH** in product audit | Existing separate release process remains authoritative |
| Service worker/version rollback and pinned release workflow | **DO NOT TOUCH** | Source extraction or cache changes require their specific contracts |

No storage migration, dead-record purge, auth refactor or broad source rewrite was performed. Importing another shared generator is safer than a second parser.

## M. Test Inventory

All 183 existing test/spec files are listed in [test-suites.csv](test-suites.csv), with one primary class, action, and survivor/rationale. [test-declarations.csv](test-declarations.csv) enumerates 2,129 parsed declaration sites including this draft's additions; loops may create more runtime cases. This is **not** a claim that 2,129 tests ran. [package-commands.csv](package-commands.csv) covers 112 scripts across packages; [validation-entrypoints.csv](validation-entrypoints.csv) covers 45 check/audit/review tools. Fixtures/configuration remain preserved in the repository; the structural source inventory indexes executable/text source files, not every asset or configuration file.

| Primary suite class | Files |
|---|---:|
| CRITICAL CONTRACT | 110 |
| HIGH-VALUE REGRESSION | 26 |
| USEFUL FOCUSED | 14 |
| IMPLEMENTATION-DETAIL | 14 |
| DUPLICATE COVERAGE | 1 |
| RETIRED-FEATURE | 2 |
| PRIVATE/MANUAL | 6 |
| SCHEDULED/DEEP ONLY | 10 |
| STALE as an entire deletable suite | 0 |
| **Total** | **183** |

The stale PIN fixture does not make its entire journey obsolete. It now includes synthetic PIN data, preserving the expected account-method check. No real credential was used.

Recommendations: keep 170 files, consolidate three mixed suites, move ten to deep/scheduled/default-exclusion while still running them when their owned code changes. No wholesale test-file deletion is proven safe. “Private/manual” is the operator contract's domain; its offline guards may still run on relevant PRs, while live operations never run automatically.

### Exact rationalization and surviving invariants

| Candidate | Action | Surviving coverage |
|---|---|---|
| Two `1314` locale-count assertions | Replaced now with required feature keys | Exact cross-locale key parity in same suites, translator behavior, real anonymous switching/copy |
| Trusted geometry 375 and 1728 iterations | Removed now; 6 -> 4 widths | Same assertions at 320,390,430,1440; 320 catches narrow overflow, 390 typical,430 large phone,1440 desktop |
| Static public search checks in `public-share-localization` | Consolidate later, not wholesale deletion | New anonymous route covers recipient copy/privacy; keep signed-in renderer checks until an equivalent signed-in test survives |
| Repeated syntax and asset enumerations in `ui-readiness` | Consolidate later | Single syntax pass plus `frontend-asset-extraction`, `client-asset-versioning`; retain unique loader/boundary assertions |
| Broad visual smoke / cross-browser a11y and perf scenarios | Deep by default; keep relevant change-triggered execution | Focused anonymous recipient and synthetic editing journeys on changed UI |
| Rules emulator plus domain/adapter identity assertions | **Keep**, not duplicate | Authorization enforcement, serialization and state transitions protect different failures |
| Retired-feature archive/entry guards | **Keep** | Prevent resurrection and data deletion; legacy feature status is not deletion proof |
| Explicit release numbers in test titles/content | Review exact assertion, no blanket removal | Release coherence, immutable asset graph, atomic install and rollback must survive |
| Multiple package aliases listing same suites | De-duplicate selected files per run | Union of affected suite paths; preserve all unique assertions |

The initial old journey failed at the synthetic PIN fixture; after correction both journey and geometry checks passed. Report the failed attempt rather than counting it as a production defect.

## N. Streamlined CI Strategy

Existing workflows: frontend performance on main PRs; manual Pages release; reusable pinned release control; monthly/manual sprite freshness. All four are classified in [workflows.csv](workflows.csv). The product-only focused draft workflow is an addition, not a baseline fifth workflow.

Measured [successful frontend job](https://github.com/Doomsday126dev/trade-app/actions/runs/33542394966/job/99971584464): **58 seconds execution**, including 22 seconds browser installation and 27 seconds browser budgets. Recent successful runs inspected were generally about 61-82 seconds creation-to-completion. Queue/outlier time is not a valid test-runtime estimate.

| Gate | Recommended selection | Runtime statement |
|---|---|---|
| Fast PR | One syntax selection; affected domain tests; always minimal privacy/ownership contracts; one affected Chromium journey | Target 45-90 sec for ordinary UI changes with current setup overhead; estimate, not measured whole new pipeline |
| Sensitive PR | Add owning Rules/Functions/sync subset when those paths change | No fixed promise; preserve enforcement and mutation integrity |
| Release | Core add/edit/share/anonymous path, relevant Rules, sync/tombstones/recovery, SW/install/rollback, browser sanity | Measure separately; not rerun here or claim a fabricated baseline |
| Deep/scheduled | Extended viewports/engines, full Functions inventory, large performance and migration scenarios | Preserve tests, omit unchanged-area routine runs |
| Manual/production | Provider identity, IAM/deployment and canary proof | Explicit window authorization; never inferred from a passing mock |

This draft skips the existing performance job **only while this exact branch is draft**, substituting the focused anonymous contract job. Marking ready restores performance; other branches and manual dispatch remain unchanged. No required release safety workflow was weakened.

Actual economy: zero suites deleted, two redundant viewport iterations removed (33% fewer iterations in that one sweep), two arbitrary count assertions replaced, three new browser scenarios in the existing recipient suite. Ten suite moves and broader alias consolidation are recommendations, not already-installed nightly automation. Do not promise a dramatic speedup from a one-minute baseline; reduced false confidence and maintenance churn are the larger gains.

For tree-equivalent rebases, a future result cache must key the exact tested tree, dependency lockfiles, runner/browser versions, test selection and policy revision; never reuse secrets-bearing artifacts or label-only success. No unsafe CI cache was added.

## O. Implemented Changes

Implemented: anonymous category search; shared canonical generator; viewer-language initialization correction; localized copy feedback/fallback; disabled unknown/oversized output; public language keyboard handling; copy/disclosure target sizing; long trainer-name wrapping; focused anonymous tests; repaired synthetic PIN fixture; reduced viewport duplication; two meaningful locale assertions; isolated draft CI; audit inventories and evidence.

Not implemented: major navigation, LF/FT data-model merge, provider changes, background artwork import, new stock tracking, broad test deletion, old-record deletion, publication redesign or full name-catalog integration.

Commit and draft PR identifiers are recorded in the visible completion message and the PR itself; this report intentionally does not contain a self-referential commit hash.

Implementation commit: `82a6529c535f2f312dfb74dc3e6a731c6ba1da57`. The following documentation commit contains this A-R review, evidence and inventory. Remaining product findings are recommendations, not claims of fixes in that implementation commit.

### Verification commands

```sh
node --test tests/i18n.test.cjs tests/public-share-localization.test.cjs tests/pokemon-go-search-syntax.test.cjs
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8896 npx playwright test tests/anonymous-public-share.spec.js tests/trusted-readiness.spec.js --project=desktop --workers=1
node scripts/product-audit-inventory.cjs
```

Node focused results: 50 localization/search checks plus 12 asset/versioning checks passed. The latter were selected because the anonymous loader's shared-helper dependencies changed. Final targeted Chromium run: 11 passed in 14.5 seconds. Browser verification includes four viewport widths within the selected scenarios, not every browser. Final CI state is stated in the completion message. No complete Functions, account-sync, Group E, provider operator, all-browser, or large performance run was launched.

## P. Owner Decisions

1. **Intent model:** unify Looking For / For Trade under My List using explicit declarations, with Board as an export view; or retain wanted-only My List plus a separate curated board? Recommend unification without quantities, possession inference, or revival of Inventory.
2. **Navigation:** adopt My List / Trainers / More on mobile, demoting Events? Recommend yes; retain direct Events access in More.
3. **Export organization:** one Share entry with Link / Image / Text, and Board inside Image? Recommend yes, retaining existing formats and the accepted dense output.

Everything else in the narrow defect list can be handled as engineering follow-up without a formal user-testing gate.

## Q. Roadmap

**Tier 1: before public beta, only three grouped fixes.**

1. Recipient search and public keyboard access: implemented here, pending normal review/release.
2. Truthful list/search representation: suppress species-empty flag blocks and stop assigning Low to no-priority public entries. Keep explicit coarse-query semantics.
3. Share result truthfulness: copied URL must not imply published/current; clearly handle unavailable publication without weakening hydration.

Existing identity rollout remains a separate pre-existing safety boundary, not an extra product-audit prerequisite.

**Tier 2:** approved intent/navigation/export consolidation; compact empty state; explicit discovery scope; public canonical Pokemon names; copy friend code; consistent qualifier/sprite treatment; simpler profile/preferences organization.

**Tier 3:** optional event-to-want shortcuts, additional supported exact search operators, richer image themes, extended contact/coordination conveniences. No new internal trade marketplace, inventory ledger or migration machinery.

## R. Production Boundary

No merge to main. No deployment. No identity/provider mutation. PR #63 not modified. Production release markers remain `.86`; draft code is not live. Public browsing and read-only repository/CI checks do not constitute authorization for the provider window.

Read-only final boundary check: main remained `794f8dbe08ee30a7de29ca73013b5ad77070ad44`; PR #63 remained OPEN/DRAFT at `aa9f9a7cac8c86737b59b7afcf8c47787b3d19dc`; production `sw.js` returned `2026-08-31.86`.

## OWNER PRODUCT DECISIONS NEEDED

- Unify explicit Looking For / For Trade in My List, or retain the separate board model?
- Approve My List / Trainers / More, with Events secondary?
- Approve one Share menu, with Board as an image-export mode?
