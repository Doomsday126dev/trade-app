# My List: historical and semantic audit

Reference baseline: `1d8f415` (main with `.99` UI consolidation and verification routing repair). This audit read repository history and committed visual evidence only; it did not read or mutate production accounts. It did not interact with PR #63.

## Why the workflow drifted

The changes accumulated across several releases rather than one deliberate replacement of the priority model:

| Change | Evidence and original motivation |
| --- | --- |
| Repeated row priority | `0633ec2` (2026-08-11) retained a three-button H/M/L editor on every row. `d706e98` (2026-08-15) compressed those buttons to the active H/M/L chip, a quick-edit affordance. The chip already existed in accepted `.89`; it was not introduced by `.99`. |
| Repeated Edit / Remove | `0633ec2` introduced the labeled sliders Edit popover to collect flag and detail controls. `e2fd673` exposed the separate compact Remove text action. These styles survived `.89` and were reused by `.97`. |
| High renamed Top want | `b9fd948` / PR #72 (`.90`) introduced a combined LF/FT declaration editor, a Top want checkbox mapping directly to stored `H`, and full / top / selected sharing. H/M/L remained stored unchanged, but High became a featured boolean in primary presentation. |
| Priority Copy Search detached | The same `.90` commit placed a new combined list before the old list and moved the original priority/special sections and their search footers into Advanced list tools. The old section search code remained but lost primary visibility. |
| Global Search scope | `3f47948` / PR #73 (`.91`) made the app wants-only and promoted a global filtered / Top want / selected selector above the combined list. Its goal was to make the newly honest contextual search visible while retaining the `.90` combined row architecture. |
| Selection 0 became permanent | `.90` added Selection details, with the count inside the disclosure. `639c9f2` / PR #81 (`.97`) moved the count into the summary, making “Selection 0” persistent chrome. |
| High/Medium under each image sprite | `.90` added `renderProductShareImage`; it reused `productShareDescription` for each image cell. That description included `entry.p ? priLabel(entry.p)`, while images were grouped only by LF/FT (later wants-only), so the priority was repeated per Pokémon. |
| Special meanings mixed | `.90` flattened priority and special sections into combined declaration rows. `.97` restored `.89` section shapes but grouped only H/M/L/empty priority, labeling the entire empty group Other. That discarded `.89`'s distinct no-priority Lucky/Shiny/XXL/XXS presentation without changing the underlying flags. |
| `.99` retained the mismatch | `7ec6c67` consolidated control styling and removed the duplicate retired list runtime. It retained `.97`'s compact section shape, row chips, textual actions, persistent selection count and global search selector. |

`docs/MY-LIST-VISUAL-RESTORATION.md` explicitly scoped `.97` to restoring `.89` density while retaining “priorities/Top want,” canonical editing and current search. That explains why the compact visual language returned without recovering the original interaction hierarchy.

## Visual evidence inspected

The committed `docs/product-audit/approved-evidence/trusted-my-list-1440x900.png` and `trusted-my-list-390x844.png` show the compact add form, clear sprites, dense rows and contextually placed controls, alongside intentionally retired LF/FT and category UI. Those retired concepts must not be copied. Accepted `.89` source at `fc79c4e` provides more exact workflow evidence than these older screenshots: `myListPrioritySectionHtml` had collapsible priority sections and `data-priority-search` footers; `myListDexGroups` provided separate Lucky, Shiny, XXL and XXS sections for entries without priority.

The good design to recover is Pokémon-first density, structural priority, compact actions and search attached to the relevant section. Restoring a historical commit wholesale would also restore retired features and older storage writers.

## Existing meanings and identity

`js/domain/priorityValues.js` independently parses and encodes a priority (`H`, `M`, `L`, or empty) and the flags `lucky`, `shiny`, `xxl`, `xxs`. `js/domain/accountSyncModel.js` explicitly permits empty priority, and `accountSyncProduct.tradeValues` defaults it to empty.

- High / Medium / Low are the three priorities. No generic Other priority exists in the canonical values.
- Lucky / XXL / XXS are legitimate requirements independent of priority.
- Shiny-only is an additional established non-priority want: accepted `.89` had a Shiny dex section, and `searchStrings.myListSearchPlan` still recognizes `SHINY` alongside `LUCKY`, `XXL`, `XXS`.
- Multiple compatible flags can coexist. A truthful combination title such as Lucky · XXL represents one declaration requiring both; it must not invent a priority or duplicate the declaration in multiple sections. The editor already rejects simultaneous XXL and XXS.
- Assigned priority plus special flags is valid stored meaning: an H Lucky want remains in High with Lucky as its item qualifier. It must not become an independent second record just for display.
- Gender, variant text, forms, costume, Antique, Dynamax/Gigantamax and notes remain exact entry information. Their presence alone does not establish another named priority-free section. Retired backgrounds remain storage compatibility fields, not active presentation.

The structural inventory is three priorities, four independent supported flags (11 compatible nonempty flag combinations when simultaneous XXL/XXS is excluded), and unclassified normal records. Field-level schema validation does not itself reject both size booleans, so contradictory historical XXL+XXS values are structurally possible even though the editor prevents new ones. There is no production occurrence evidence. Preserve such records for manual correction; a broad candidate query must not claim to satisfy both incompatible size requirements.

`tradeListComparison.wantedIntentKey` includes canonical name identity, type, gender, variant and all four flags. Baseline `combinedKey` added note but omitted priority, so the combined presentation could co-group otherwise matching H and M declarations. Distinct normal and Lucky declarations for the same species already remained separate. `unifyDeclarations` additionally considers priority and note when determining exact aliases; only truly identical declarations alias together. The candidate presentation key also includes priority so differing priority declarations stay in their own sections; canonical storage identity remains unchanged.

The canonical storage key remains `surface + lane + catalogId` (`accountSyncModel.tradeEntryId`). Existing records can legitimately occupy historical `my-list/wishlist`, `my-list/looking-for`, or `special-board/looking-for` slots for the same species with different meanings. Current new-entry UI has one `my-list/looking-for` slot per exact catalog identity and rejects collisions. This task must preserve existing distinctions without inventing a new storage identity or using old Board as a second editable model.

The current editor targets the selected declaration group and its exact aliases. Its priority-only patch preserves flags and notes. Tests should prove that High → Medium changes that normal declaration while a same-species Lucky declaration remains unchanged, including source entity IDs and flags.

## Search contract and deliberate filtering change

The accepted `.89` `buildStrings` function read the active `mylist-filter` and generated priority footer queries from that filtered set. `.91` made filtering explicit in the primary “Filtered wants” selector. A new High header action representing the whole High section is therefore an intentional behavior change, consistent with the owner's stated preference. It should be explained in the visual review, not described as identical historical behavior. Selection can provide the secondary filtered-subset workflow.

Current `searchStrings.contextualSearchPlan` is the canonical honest serializer. It emits a localized `!traded` species prefilter, splits at the existing 1,500-character limit, retains all exact entries in a manual verification model, and reports unresolved Pokédex identities. It intentionally does not claim to encode exact form, costume, gender, Shiny, Lucky or size requirements. Combining priorities or special sections is truthful under that same candidate-search/manual-check contract; it must not claim exact flag matching or revive assumed keyword syntax. Unsupported entries remain visible as wants, with an explicit unresolved count beside copy actions when a numeric query can be generated for the remaining known species. Compact search disclosures preserve the manual-check warning without mounting a second hidden copy of every Pokémon row.

## Legacy or unclassified normal wants

These are structurally possible today, not only in hypothetical migration data:

1. The canonical schema accepts empty priority and all flags false.
2. Legacy list encodings can contain empty, modifier-only, or gender-only values; `parsePri` preserves their lack of priority.
3. Existing special-board looking-for records can have neither priority nor one of the four supported flags.
4. Baseline `.99` compact Add begins with no priority and its editor can save an unflagged entry unchanged.

Production occurrence/count is unknown because no production data audit was requested or performed. The honest preservation treatment is a conditional Needs priority section for existing unclassified entries, disappearing after classification. It is not a new-entry choice. New normal wants should require H/M/L, while supported special-only wants remain valid with no priority. Existing ambiguous records must remain editable/preserved without silent Low assignment, deletion or republishing as Low.

No production migration is necessary for the presentation correction. Any future cleanup would need a separately authorized inventory of unclassified records and owner-chosen classification, followed by ordinary priority patches to existing entity IDs. It must not infer priority from species, other records or flag absence.
