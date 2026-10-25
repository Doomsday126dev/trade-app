# Minor findings — 25 October 2026

This is separate from the headline import/request/sharing defects. “Reproduced” means observed in the isolated deployed-code audit, not a production mutation.

| Finding | Evidence / kind | Disposition |
|---|---|---|
| Changing share scope reset the chosen format | Reproduced | Fixed: keep the chosen goal; explain/disable full-list-only actions for partial scopes. |
| Search copied an entire priority section despite a list filter | Reproduced | Behavior preserved deliberately; a visible full-section note now explains scope while filtering. |
| Save pill promised a details panel but instead retried/recovered or showed a toast | Reproduced | Tooltip now accurately names status and recovery actions. A dedicated details panel remains a future design option. |
| N/S shortcuts and PWA add/search actions targeted missing elements | Reproduced | Fixed to active add field and search-sharing view. |
| Tour/help mentioned drag/bulk, quantities and unavailable inventory navigation | Reproduced | Current tour and quantity-edit help repaired; inert data/code retained. |
| Plain text reported “Markdown copied” | Source-confirmed | Fixed to plain-text feedback. Markdown retained separately. |
| Import Select all looked checked despite no selected eligible variants | Reproduced during implementation | Checked/indeterminate state now follows actual eligible selection. |
| Existing import entries could be selected again | Reproduced/source-confirmed | Disabled and preserved; newly appearing existing entries also skipped at confirmation. |
| An old import completion could dismiss a reopened dialog | Reproduced with delayed transport | Guarded by import-session generation. |
| Small priority targets and low-contrast Medium/primary actions | Measured | Priority targets enlarged to at least 44px; Medium text and primary action colors repaired. |
| Some authentication errors remain English-only | Reproduced | Open. New copy is localized in English/Japanese/Spanish/German; this is not a complete historical localization cleanup. |
| Utility actions are scattered between More, List tools and Settings | Design preference, supported by inventory | Export now reaches the coherent share flow. Further navigation consolidation needs a separately reviewed design rather than removing features. |
| Narrow My List controls feel dense; long trainer names wrap | Design preference; no overflow found | Touch controls improved. Broad density/type changes deferred pending user review. |
| Markdown/CSV need not occupy the main share choices | Design preference | Retained under More formats with full-list/contact scope stated explicitly. |
| Raw event bonus/research text may remain English | Feed/content limitation | Labeled; no fabricated automatic translations or completeness claims. |

Not reported as defects: offers/inventory editing are retired in the wants-only product; keyboard shortcuts do not run while typing; landscape modals scroll; viewport emulation is not physical OS coverage.
