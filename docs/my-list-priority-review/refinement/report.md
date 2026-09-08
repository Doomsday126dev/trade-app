# Focused owner-review refinement

Branch: `ui/my-list-priority-workflow`, refining `6ca8568` in the existing separate worktree. The approved information architecture is preserved. This pass addresses only the four owner findings. No rebase, merge, deployment, production mutation, schema change, or identity/provider change was performed.

The [AFTER review](index.html) contains the eight requested views and one supplemental mobile selection check. The original candidate's evidence remains available in the [earlier review](../index.html).

## Dragonite: fixture metadata, not a changed sprite resolver

The synthetic fixture inserted an ordinary `Dragonite` want into the owner's list, but the seed catalog had no matching ordinary Dragonite entry. `productDeclarations()` therefore supplied `no: null`. The export candidate list contained only the Pokémon Database image-proxy URL, which was unavailable during the reviewed capture. The ordinary inline image could load directly without the canvas CORS requirement, explaining why the row had art while the export did not.

The fixture now supplies the missing catalog entry using `PogoI18n.pokemonNames.speciesIdByEnglishName('Dragonite')`, which resolves to **149**. It does not change production catalog data or inject an alternate image into the canvas. The existing export resolver now selects its approved PokeAPI HOME artwork at `…/other/home/149.png` and draws the correct **512 × 512** base Dragonite image.

All **18** Pokémon in the new generated image have visible artwork. Seven existing sprite/loading functions are byte-identical to `6ca8568`, including `entrySpriteUrl`, `spriteFallbackChain`, `exportSpriteFallbackUrls`, and `loadCanvasImageWithFallback`. The renderer's image-loading call is unchanged. Only the recipient-facing section heading changed in the export runtime.

Evidence: [resolver hashes and root cause](dragonite-resolution.json), [actual canvas draw URLs and dimensions](after/capture.json), and the focused browser regression in `tests/my-list-priority-refinement.spec.js`. This proves the runtime resolves correctly when given the properly identified synthetic species; no wrong-species or guessed-variant fallback was introduced.

## Selection wording

The contextual action is now **Share selected**. The ordinary full-list action remains **Share**. Both retain their existing handlers and scopes; no toolbar or modal was added.

The new label is localized in EN / JA / ES / DE. Browser checks exercise all four languages at **1440** and **390** widths, including overflow checks. Both desktop and mobile active-selection screenshots are included.

## Owner and recipient legacy wording

The owner's internal section remains **Needs priority**. Existing unclassified entries are preserved, and the new-entry editor never offers that label. Lucky / Shiny / XXL / XXS and compatible combinations still stand independently without priority.

Generated wants images, anonymous public lists, and signed-in recipient lists now say **Priority not set**, with localized equivalents. The entry is retained without assigning High/Medium/Low, hiding it, or migrating it. The section key and stored values are unchanged; the shared label helper receives an explicit recipient-presentation option.

## Exact rule for search disclosures

For compact section, selection, Advanced, and recipient search panels, each declaration counts as **one manual check** if any of these apply:

- its species number is unresolved;
- it has Lucky, Shiny, XXL, or XXS requirements;
- it has variant/modifier, gender, Max, note, or other existing exact-check metadata;
- it belongs to a form/costume/Max category rather than the ordinary species list;
- its name identifies a variant or cannot be confirmed as the ordinary resolved species.

Multiple qualifiers on one declaration still produce one count. Priority alone, including an unset priority, does not create a search exception. The full runtime compares the exact name with the existing species catalog without stripping meaningful punctuation such as Unown `!`. The lightweight anonymous runtime uses its existing admitted public sprite catalog and base-name rules. A focused test checks every admitted public catalog name against the species catalog to ensure all known variants retain a manual disclosure.

A nonempty, resolved ordinary-species scope with no exceptions and one query part normally shows **Copy Search only**. A scope containing exceptions shows **1 manual check** or the localized plural. A clean scope that exceeds the search-length limit retains **Split search** guidance and the existing safe part buttons.

Opening the exception reveals the existing species-prefilter warning, exact entries/qualifiers/notes, unresolved guidance, and query bytes. Exact review rows are created only when opened and page in batches of **50**. There are no hidden duplicate Pokémon lists and no persistent strong-reference plan cache. Raw search strings remain hidden by default. Clipboard failure can still reveal the exact query for manual copying, including for an otherwise clean section.

The canonical query serializer, 1,500-character split limit, species identity, and whole-section copy contract are unchanged. The clean-section screenshot uses an explicitly reduced synthetic list containing one ordinary High Pikachu, so its lack of an exception is truthful. The main mixed fixture still has genuine exceptions in each populated priority section.

## Tests and performance

- **76 focused Node tests passed:** exception classification, complete admitted public-name inventory, section semantics, recipient labels, export, localization, query bytes/splitting, and performance contracts.
- **38 focused browser tests passed:** owner workflow, the four refinements, selection/localization, Advanced/search, signed-in recipients, and anonymous public recipients. One opt-in older baseline-capture test was skipped.
- **2 existing performance tests passed**, with no numeric budget changes.
- **2 focused capture checks passed**. The full-section image was then captured alone at the same 1440 width with a taller viewport to keep sticky navigation outside the element crop. No runtime styling was changed for that capture.

| 1,000 wants | Measured | Existing budget |
| --- | ---: | ---: |
| Initial render | 36.6 ms | < 200 ms |
| Filter | 15.4 ms | < 100 ms |
| Row update | 13.5 ms | < 100 ms |
| Initial rows | 120 | 120 |
| DOM nodes | 1,651 | ≤ 2,500 |
| Controls | 492 | ≤ 1,000 |
| HTML bytes | 319,974 | ≤ 358,400 |

At **4× CPU throttling**, filter took **24.6 ms** (<50), clear **11.2 ms** (<50), and edit **10.3 ms** (<100). No long task was observed in the measured interaction window. Explicit paging still reaches all 1,000 wants, unchanged rows are preserved, and filtering builds one fresh declaration model. [Raw performance evidence](performance.json).

The requested 1440/390 captures were visually inspected, alongside mobile selected-action wording, all priority/special sections, the complete generated image, public mobile, an opened manual exception, and a clean section. Existing focused responsive coverage also passed at 320 and in both themes. No unrelated identity/provider/canary suite was run.

Ready for owner visual approval. The final response supplies the new candidate commit SHA.
