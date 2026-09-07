# My List visual restoration: approved .97 release

Owner approved the desktop/mobile comparison on September 7. Runtime candidate:
2026-09-07.97. Base: current .96 main, 23aee7b. No further aesthetic changes.

## Exact history reference

- Accepted .89: release-2026-09-05.89, fc79c4e9b834285693cff51300b451ed188cc74e.
- PR #72: f59bed3529f4c44d71df6b05518c08ac68da8a2e (.90).
- PR #72 added renderCombinedList and the combined editor/selection state in
  js/app/application.js. renderMyList began calling the new renderer first.
- index.html gained combined-toolbar, combined-filter, combined-search and
  combined-list before the existing My List. The former primary add form,
  category controls, mylist-out and search outputs moved under legacy-list-tools.
- css/app.css gained combined-row: a full-width 28px/44px/content/actions grid,
  minimum height 68px, plus combined-entry and combined-sides presentation.
- PR #73 (.91) retained that row presentation while making it wants-only and
  exposing the current scope selector and open contextual-search output.

## Restored presentation

Reuse the existing .89 mylist-priority-section, mygrid, myrow, myrow-copy,
myrow-sprite-wrap, type accents, trait badges, priority chips and edit/remove styles.
Rows are now rendered from the current .96 declaration groups, not old storage.
The giant combined-row markup and its CSS are deleted.

The add form reuses .89 add-form/frow/ac-wrap/add-pri-group/add-actions styling.
Its submission still calls the current canonical editor and mutation authority.
New draft state is cleared at session boundaries; pending saves cannot clear a
different account's new draft. Removal retains confirmation plus current authority.

Search retains .96 contextualIntentSearchHtml and its search-plan engine. Only
the My List presentation is adapted: compact scope, visible Copy Search, collapsed
raw/details, accessible manual verification, and explicit copy-failure recovery.
Other contextual-search consumers and Trainers/Groups/Events markup are unchanged.

## Intentionally not reused

- LF/FT tabs, inventory, quantities and backgrounds remain absent.
- The old category-dependent inline edit popover wrote through legacy list paths.
  The .96 canonical modal remains, with its stale-draft and failure handling.
- The old category-specific add writer, speed-add queue and native reorder logic
  are not promoted into the restored primary UI. Current wants span categories.
- Current sharing, navigation, priorities/Top want, canonical identity, provider
  boundaries and costume exclusions remain. No backend or data/schema changes.

## Same-fixture visual comparison

Actual .89 and candidate pages were loaded locally using the same 12 synthetic
wants and dark theme, with no ordinary account writes. All 12 sprites rendered.

| Measurement | .89 desktop / mobile | Restored desktop / mobile |
| --- | --- | --- |
| Viewport width | 1440 / 390 | 1440 / 390 |
| First row height | 59.5 / 55 px | 59.5 / 55 px |
| Sprite slot | 34 / 32 px | 34 / 32 px |
| Name size, weight | 14 / 13 px, 700 | 14 / 13 px, 700 |
| Grid tracks | 527 + 527 / 360 px | 527 + 527 / 360 px |

The original font stack is unchanged. More Pokemon are visible earlier because
retired direction tabs and the permanently open raw search output are absent.
Current declaration ordering is retained within the restored priority sections.

Focused checks: 17 browser tests passed, including search scopes/localization,
selection, sharing, stale/failed edits, canonical sync/recovery boundaries, layout
at 320/390/768/1440, clipboard fallback and account-switch draft safety. 59 focused
Node checks passed. No broad backend, rules, release or deployment suite was run.

The approved screenshots remain the visual acceptance reference. The runtime
file inventory is unchanged, so the existing .96 immutable control and selector
can deploy this release without a dispatcher repin. Production must match the
approved desktop/mobile fixture; otherwise use the normal rollback to .96.
