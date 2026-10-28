# Scoped current-design polish

This retains the existing design, routes and data contracts. My List uses continuous compact rows with a slightly larger sprite slot, no per-row shadow/type stripe, and one edit action. Removal remains in the existing editor, with an explicit accessible name, and bulk selection stays available. Section Copy actions retain their original full-section scope and 44px target while becoming visually secondary.

The name picker now uses an accessible combobox/listbox showing one canonical name per result. Alias terms remain in its matching index rather than a repeated gray subtitle. Pointer selection, Arrow keys, Enter, Escape, focus retention and composition input are browser-tested. The picker does not merge catalog or saved list records.

More's heading has a 16px gap before destinations. Events shows a quiet last-checked timestamp for healthy data; cached/bundled data says Showing saved events and uses a saved-schedule timestamp rather than claiming a successful refresh. Refresh remains available. A separate read-only live check returned 59 events with stale/sourceFallback false; the earlier preview warning came from its synthetic blocked-network fallback fixture.

The 48-costume fixture shows seven rows in the initial 390px phone viewport and 18 on desktop. Chromium phone/desktop and WebKit phone screenshots were inspected for names, spacing, dropdown readability and overflow. Tests preserve keyboard editing/removal, long names, exact sprite handling and existing performance limits. No logo, palette, global redesign or authentication changes are included.
