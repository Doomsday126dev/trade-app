# Favorites entry after delayed owner restoration

## Reproduced failure

The initial Trainers render may occur before the restored Firebase owner binding is available. `ensureTrainerHistoryStore()` then returns null and `renderTrainerQuickLists()` returned before populating controls, rows or loading feedback. Once the owner was restored, clicking Favorites only changed panel visibility and observed metadata; it did not render the panel. An isolated WebKit regression reproduced zero visible cards with the original saved Favorites still present. This is a confirmed lifecycle defect matching the native reload-associated blank-panel symptom; the native session's exact internal state could not be inspected safely, so do not claim definitive native root-cause confirmation yet.

## Minimal change

Pointer and keyboard selection explicitly request Favorites rendering. Internal mode changes retain their prior non-rendering default, avoiding duplicate scheduled renders. If the owner store is not yet available, use the existing localized loading component, just as for an unready account projection. The existing owner-readiness refresh renders the ready state; no timer, polling, new request path or sync retry is added. Existing metadata observation/cache/retry budgets remain intact. No account records, lists, notes, preferences, identity fields or assets are migrated, normalized, removed or rewritten by this change.

## Evidence and limits

- Before-fix isolated WebKit: Favorites remained blank after owner restoration and normal selection; retained history still contained two records.
- New pointer case retains seven Favorites, byte-identical history and wanted-list/board data, and no additional fixture account writes.
- Keyboard case retains tab focus and populates the ready panel.
- Pending-owner case shows the existing busy/loading state, then recovers through the ordinary readiness render with records preserved.
- Both engines cover the three cases. The existing packaged Favorites suite also covers dates, responsive light/dark layouts, six-second UID latency, bounded retries and stale-session cancellation.
- Source/read contracts remain unchanged (52 surfaces, 24 direct gets, zero onValue, ten repository reads).
- The native Updates underline defect did not reproduce in isolated WebKit; this patch makes no unrelated navigation style change.

## Publication boundary

Local repair branch only, based on .163 merge ef1a6750cd5b1d8380e2b18c9a35b8d1ae8ce58e. It deliberately retains the inherited .163 stamp until a distinct .164 runtime/source registration is prepared. Do not deploy this unstamped branch as .163 or move existing immutable tags. Publication needs a scoped PR, final exact-head hosted qualification, the normal exact-source registration/control dispatcher process, fresh immutable release/control tags and protected Pages deployment. No artwork allowlist change, new read allowance, backend, auth, billing, credentials or permissions change is required. Parent coordinates the focused visual/native check before publication.
