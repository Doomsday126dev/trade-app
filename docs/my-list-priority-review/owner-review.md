# My List priority workflow — candidate report

This report documents the original `6ca8568` candidate. The subsequent focused owner-review pass is documented in the [refinement report](refinement/report.md) with [new AFTER evidence](refinement/index.html).

Implemented in the isolated `ui/my-list-priority-workflow` worktree, based on `1d8f41529bffc38471ca404157acd71960757234` (main with .99 UI consolidation and verification-routing repair). Ready for owner visual approval. No merge, deployment, production mutation, schema migration, or identity/security/provider change was performed. PR #63 and the separate supplemental auth-transition branch were not modified; the candidate contains no commits from that branch.

Start with the [matched visual review](index.html). Supporting evidence: [historical and semantic audit](history-and-semantics.md), [performance qualification](performance.md), and [raw performance measurements](performance.json).

## A. Historical diagnosis

This drift accumulated over releases. Row H/M/L controls and Edit/Remove labels predated .89. The .90 combined editor renamed High to Top want, flattened the primary list, moved section search into Advanced, and printed priorities under individual export sprites. The .91 wants-only conversion introduced the global search-scope selector. The .97 visual restoration recovered compact .89 shapes while preserving the combined model, making Selection 0 permanent and placing empty-priority special wants in Other. The .99 control consolidation retained that mismatch.

The candidate recovers structural priority, Pokémon-first rows, and contextual section search. It does not restore old LF/FT, inventory, quantities, backgrounds, category UI, ordering, or Board editing. Commit-level evidence and inspected historical screenshots are listed in the [audit](history-and-semantics.md).

## B. Semantic model

High / Medium / Low remain the three priorities; stored `H` / `M` / `L` values retain their meaning. Lucky / XXL / XXS remain independent special requirements. Shiny-only is also an established non-priority want in the older polished runtime and current search contracts.

There are four supported flags and 11 compatible nonempty flag combinations, excluding simultaneous XXL and XXS. A compatible combination gets one accurately named section, such as Lucky · XXL. An entry with both priority and flags stays in its priority section and displays its item-specific flags. **There is no generic Other priority in the rebuilt My List, image export, or recipient views.** EN / JA / ES / DE use coherent High/Medium/Low terminology; compatibility translation keys do not change stored data.

## C. My List hierarchy

Nonempty High, Medium, and Low sections lead, followed by distinct special sections, then a conditional Needs priority maintenance section. Each has its full semantic count, collapse/expand, and direct Copy Search. Combined requirements are neither duplicated nor assigned a fake priority.

Initial rendering is bounded to 120 rows across sections, with unused section allocations redistributed. Each large section has explicit Show more paging. The same fresh declaration model feeds presentation and search; unchanged rows are reused and the cache remains bounded to the current page allowance.

## D. Search

The primary global scope selector is removed. Header Copy Search represents the **entire section**, even while filtering or collapsed, including entries beyond the rendered page. Accessible copy names identify the section. Text filtering finds entries without changing this contract; selection supplies precise subset copying.

This intentionally differs from .89, whose section copies used the text-filtered set. The decision follows the owner's stated preference and is called out in the visual review.

Advanced list tools contain compact High/Medium/Low and available special-requirement toggles. They union the selected sections: High + Medium combines those priorities; Lucky selects no-priority Lucky sections, including compatible combined requirements. Priority-plus-flag entries remain in their priority scope. There is no permutation button matrix or generic query builder.

All copies reuse the canonical localized Pokémon GO serializer and its 1,500-character safe split. These are candidate species searches requiring exact manual checks, not invented Lucky/size/form search syntax. A compact Check exact details disclosure explains that limitation. Unknown identities remain visible with an unresolved count; an entirely unresolved section explicitly reports that search is unavailable instead of producing a match-all query. Clipboard failure exposes the affected query for manual recovery. The compact disclosure does not mount another hidden list of Pokémon.

## E. Rows

Priority is represented by the section instead of repeated badges. Rows retain sprite, exact name/form/costume, Antique, gender, Shiny/Lucky/size qualifiers when item-specific, Dynamax/Gigantamax treatment, and notes. Flags already named by a special section are not repeated as text on each row.

Edit uses the existing sliders icon; Remove uses a trash icon. Both have accessible names, titles, keyboard operation, and focus styling. Desktop hit areas are 40 × 44 pixels; mobile hit areas are 44 × 44. The representative first row is 59 pixels on desktop and 54 on mobile. Remove retains the existing confirmation and guarded mutation path. Decorative sprite overflow no longer intercepts selection-checkbox taps.

## F. Selection

Normal chrome offers Select without Selection 0. Entering selection mode exposes checkboxes; selected entries expose a count, Copy Search, Share, and Clear. Selected declarations survive text filtering, and selected copying/sharing uses only those declarations. Clear returns to the normal state. Owner/session changes also clear the presentation state.

## G. Special wants and editing

Lucky, Shiny, XXL, XXS, and compatible combinations save without H/M/L. The compact editor separates Priority from Special requirement. New normal wants require classification; removing the last classification from an already classified want is also prevented. Existing ambiguous records remain editable and preserved.

The canonical entity identity remains unchanged. Existing same-species normal and Lucky declarations stay separate. A focused mutation test verifies that High → Medium patches the normal declaration and its exact aliases at their existing IDs, without changing the Lucky declaration or its flags. The destination section expands after the edit.

Current new-entry storage still has one looking-for slot per exact catalog identity. Existing semantically different historical slots are preserved; this task does not invent extra identity slots or silently merge meanings. Historical contradictory XXL+XXS flags are structurally possible and preserved for manual correction, while the editor continues rejecting new contradictory combinations.

## H. Export/image

The active wants image uses structural High/Medium/Low sections followed by correctly named special sections and conditional Needs priority. Priority labels are not repeated beneath individual Pokémon. Exact names, form/costume qualifiers, gender, shiny treatment, Max identity, and notes remain visible. The same species can appear in multiple distinct sections.

The dense eight-column grid uses 900 logical pixels, exported at 1800 physical pixels. Small special sections can sit alongside each other. The [before/after export](index.html#image) uses the same 18 declarations as My List.

One pre-existing fixture limitation remains visible: Dragonite's saved declaration has no admitted Pokédex number and its exact export artwork proxy is unavailable, so the image preserves its name without a sprite. The baseline has the same fallback. All 18 editable-list row images loaded during visual capture. No species/variant identity was guessed to replace missing export art.

## I. Public shared list

Both anonymous and signed-in recipient views use the same priority/special hierarchy, direct full-section copy, counts, collapse, and bounded 80-entry section paging. Exact qualifiers remain visible, while section-level flags are not duplicated. The global search-scope pattern is absent.

Old version-1 published links still render through their existing admission path. Public projection, gateways, routing, schemas, and private viewer-data boundaries are unchanged. Focused recipient tests cover localization, copying, legacy data, supported scopes, and large sections.

## J. Legacy unclassified data

Unclassified normal wants are structurally possible: canonical values allow empty priority and no flags, historical encodings preserve that state, and .99's new-entry editor could create it. **Production occurrence/count is unknown** because no production audit was performed.

Needs priority preserves those records until the owner assigns a priority or legitimate special requirement; it disappears when none remain. It is a maintenance treatment, not a fourth product tier or normal new-entry option. Records are not deleted, silently made Low, or published as Low.

No production migration is needed for this presentation fix. Future cleanup would require a separately authorized inventory and owner-chosen classification using normal patches to the existing entity IDs. No automatic inference of priority is proposed.

## K. Visual evidence

The [focused review index](index.html) presents 11 matched before/after pairs (22 primary images), plus two narrow/light public supplements. It covers desktop 1440, mobile 390, narrow 320, complete priority/special sections, active selection, Advanced combinations, generated image, public desktop/mobile, and representative light mode.

The synthetic editable fixture has 18 declarations, including High/Medium/Low, Lucky-only, XXL-only, XXS-only, Shiny-only, Lucky + XXL, normal and Lucky Pikachu, exact costume and Unown, female Eevee, Antique Sinistea, Dynamax, and a preserved legacy Psyduck. A separate fixture has 1,004 declarations with 120 initial rows. Public comparisons use a matched admitted recipient fixture. Captures verify no horizontal page overflow and no broken editable-row art.

Reproducible capture lives in `tests/my-list-priority-review.spec.js` with `tests/helpers/my-list-priority-fixture.cjs`; set `MY_LIST_PRIORITY_REVIEW_DIR` to capture explicitly. Without that setting, the capture suite deliberately skips instead of writing review evidence during normal test runs.

## L. Performance and tests

Final focused Node checks: **102 passed** across section semantics, export, performance contracts, contextual search, Pokémon GO syntax/localization, language coverage, recipient localization, and declaration comparison.

Focused browser coverage:

| Coverage | Result |
| --- | --- |
| New priority workflow, editing, search, selection, legacy handling, responsive behavior | 10 passed |
| Existing combined-intent, contextual-search, and My List restoration regressions, including signed-in recipient cases | 15 passed; 1 optional old screenshot capture skipped |
| Anonymous public recipients | 14 passed |
| Affected Groups High-label assertions | 2 passed |
| Existing large-list performance scenarios | 2 passed |
| Focused real-artwork review captures | 2 passed |

That is 43 behavior/performance browser tests plus two visual-capture tests, without double-counting the signed-in recipient recheck. The final standalone public/recipient recheck also passed 16/16. My List assertions in the broader UI consolidation suite were updated; unrelated whole-app cases were not run.

The final responsive check waits for the existing row entrance animation before measuring resting hit areas; this avoids subpixel transform-rounding noise without weakening the 40/44-pixel requirements.

At 1,000 synthetic wants: initial rendering **35.8 ms** (<200), filtering **14.9 ms** (<100), row update **16.3 ms** (<100), **120** initial rows, **1,648** DOM nodes (≤2,500), **492** controls (≤1,000), and **319,677** HTML bytes (≤358,400). Explicit paging reaches every row. At 4× CPU throttling: filter **20 ms** (<50), clear **14.6 ms** (<50), edit **13 ms** (<100), maximum long task **66 ms** (≤200). All existing numeric budgets are unchanged.

The isolated benchmark waits for the local renderer and a completed Firebase startup attempt because remote traffic is deliberately blocked; no Auth runtime was changed to make it pass. Unrelated identity/provider/canary history was not run. Full commands and measurements are represented by the focused test files and [performance evidence](performance.md). Final `git diff --check` and JavaScript syntax checks are clean.

## M. Branch and candidate state

Branch: `ui/my-list-priority-workflow`. Base: `1d8f41529bffc38471ca404157acd71960757234`. Worktree: `my-list-priority`, separate from the source checkout. Runtime, presentation helpers, four locale files, focused tests, and this evidence form one local candidate commit; the final response supplies its commit hash.

No push, merge, deployment, release bump, production write, schema change, or identity/security/provider change was performed. Owner visual approval is the stop point.
