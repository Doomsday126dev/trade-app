# Maintenance Log

## 2026-05-25 - Codex - Multi-community architecture audit

### Summary
- Audited the current single-community app before adding multi-community support.
- No application code was changed in this pass.
- The app is still centered on global username-keyed data: `users`, `wishlist`, `dynamax`, `gmax`, `costumes`, `have`, `offers`, `trades`, `requests`, `authIndex`, `loginDirectory`, and `pendingDecrements`.
- Recommended adding community metadata and membership indexes beside the existing Pokemon/user data instead of moving current lists.
- Recommended keeping existing NYC behavior as the default and gating all new community behavior behind `MULTI_COMMUNITY_ENABLED`.

### Files touched
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None added yet.
- Proposed: `MULTI_COMMUNITY_ENABLED=false` for the first implementation phase.
- Proposed: `DEFAULT_COMMUNITY_ID='nyc'`.

### Firebase paths reviewed
- Existing global paths: `users`, `loginDirectory`, `authIndex`, `admins`, `requests`, `wishlist`, `dynamax`, `gmax`, `costumes`, `have`, `offers`, `trades`, `pendingDecrements`, `_ping`.
- Current app code subscribes to broad top-level collections after auth and lazy-loads some list collections by tab.

### Firebase paths proposed
- `communities/{communityId}`
  - `name`
  - `slug`
  - `description`
  - `visibility`: `public | private | inviteOnly`
  - `ownerId`
  - `ownerUsername`
  - `admins/{uid}: true`
  - `members/{uid}: true`
  - `memberUsernames/{username}: true`
  - `createdAt`
  - `updatedAt`
  - `inviteCode` or invite settings, if enabled later
- `userCommunities/{uid}/{communityId}`
  - `role`: `owner | admin | member`
  - `username`
  - `joinedAt`
- `communityRequests/{communityId}/{requestId}`
  - `userId`
  - `username`
  - `note`
  - `status`
  - `createdAt`
  - `decidedAt`
  - `decidedBy`
- Existing `offers/{recipient}/{offerId}` and `trades/{tradeId}` should eventually gain `communityId`, with missing `communityId` treated as `nyc`.
- Existing `requests/{id}` should remain supported and default to `nyc` during migration.
- `selectedCommunityId` should be local/app state initially, not a required Firebase field.

### Security rules changes needed later
- No rule changes were made in this audit.
- Later rules need to allow authenticated users to read community metadata and their own memberships.
- Community owners/admins need scoped permission to manage only their community members and requests.
- Existing global admin behavior should remain as a break-glass/admin migration path until community admin rules are proven.
- Avoid requiring non-admin users to read all of `authIndex`; use denormalized `memberUsernames` for community filtering because the app's main data remains username-keyed.

### Impacted single-community assumptions
- Auth/login: login directory and requests currently assume one shared community.
- Admin approvals: approved users are added globally and appear to everyone.
- Browse: `activeUsers()` and `renderBrowse()` aggregate all users globally.
- Strings and compare: user rows, diff modal, and trade-match modal are built from global user/list data.
- Inventory: community inventory browse and offers are global.
- Schedule/events: trainer picker and scheduled trades are global; event context is not scoped.
- Special trade board: board data is user-global, which is probably fine, but any community sharing context needs care.
- Profile/friend code/Discord: global per-user profile should remain global for now.
- Export/import/backup: backup restore can write the root database and must be revisited before adding community paths broadly.
- Health/perf panel: currently reports global user/list counts rather than selected-community counts.
- Firebase rules: current rules protect user-owned paths, but have no community-level membership model.

### Manual test checklist for the next implementation phase
- With `MULTI_COMMUNITY_ENABLED=false`, verify current production behavior is unchanged:
  - Login works for existing users and `TestUser`.
  - Browse shows the same trainers and Pokemon as before.
  - My List edits persist.
  - Strings and copy buttons work.
  - Inventory add/edit, offers, accepted offers, and pending decrements work.
  - Schedule regular/special/remote trades work.
  - Admin add/reset/approve flows work.
  - Health Check loads and reports Firebase/auth status.
  - Image exports, CSV/markdown exports, and backup export still work.
- With the Phase 1 foundation enabled later:
  - `nyc` community is created once.
  - Existing users are enrolled into `nyc`.
  - Existing global admins are mapped to NYC owner/admin where possible.
  - Old records without `communityId` still show in NYC.
  - Missing or invalid selected community falls back to `nyc`.
  - No user has to recreate wishlist, inventory, profile, offers, or scheduled trades.

### Known risks / TODOs
- Identity is split between username-keyed app data and Firebase Auth UID-keyed security. Community data must bridge both.
- Relying on global `authIndex` for ordinary member filtering would conflict with current security expectations.
- Existing requests, offers, and trades lack `communityId`; migration must treat them as NYC without rewriting everything at once.
- Backup/restore is high risk because it can replace root data.
- Community scoping will reduce render/matching work before it reduces Firebase bandwidth; per-user subscriptions remain a later scaling phase.
- Sync queue paths are literal Firebase paths, so path changes must not strand old queued writes.
- Admin roles need a transition period where global admins still work.

### Instructions for the next contributor
- Do not move Pokemon list data under communities in Phase 1.
- Add only small helpers first: `getCurrentCommunityId`, `getCommunityMemberUsernames`, `filterUsersBySelectedCommunity`, `isUserInCommunity`, `canManageCommunity`, and default-community migration helpers.
- Keep `MULTI_COMMUNITY_ENABLED=false` until the NYC default community migration is verified.
- Treat missing `communityId` on old offers/trades/requests as `nyc`.
- Update this log after any community, auth, security-rule, scaling, or data-model change.

## 2026-05-25 - Codex - Multi-community Phase 1 foundation, pass 1

### Summary
- Added the first inert foundation for multi-community support.
- Production behavior remains unchanged because `MULTI_COMMUNITY_ENABLED` is `false`.
- Added default NYC community normalization in local/app state only.
- Added helper functions future screens can use for community scoping.
- Firebase listeners understand the future community paths, but only subscribe to them when the feature flag is enabled.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- Added `MULTI_COMMUNITY_ENABLED=false`.
- Added `DEFAULT_COMMUNITY_ID='nyc'`.
- Added `DEFAULT_COMMUNITY_NAME='NYC'`.
- Added local selected-community key `pogoSelectedCommunityId_v1`.

### Firebase paths added/changed
- Local normalization now preserves/supports:
  - `communities`
  - `userCommunities`
  - `communityRequests`
- No production Firebase writes to those paths were added in this pass.
- No existing paths were moved.

### Security rules changes needed
- None for the flag-off foundation.
- Before enabling the flag in production, add rules for community metadata, community membership, and community request management.

### Manual test checklist
- Load app with existing local cache and confirm login screen still appears.
- Login as existing admin and confirm Browse/My List/Strings/Inventory/Schedule still render.
- Confirm `getLocal()` normalization does not remove existing `wishlist`, `have`, `offers`, or `trades`.
- Confirm no community switcher or scoping UI appears while `MULTI_COMMUNITY_ENABLED=false`.
- Confirm Health Check still opens.

### Known risks / TODOs
- The default NYC community is normalized locally but not yet written to Firebase for existing production users.
- Membership is bridged by both UID and username; future security rules must not rely on broad `authIndex` reads for normal members.
- Existing old records still lack `communityId`; future filters must continue treating missing `communityId` as `nyc`.
- Backup/restore still writes root data and needs review before community writes become active.

### Instructions for the next contributor
- Keep the flag off until a Firebase rules draft and NYC migration write path are ready.
- Do not scope Browse/Strings/Inventory/Schedule yet unless the default community exists server-side.
- When adding server writes, verify an admin account can create `communities/nyc`, `userCommunities/{uid}/nyc`, and request migration data without breaking old users.

## 2026-05-25 - Codex - Multi-community Phase 1 foundation, pass 2

### Summary
- Added an owner-only Admin maintenance panel for preparing the default NYC community foundation.
- The panel is hidden from non-owner admins and all members.
- Added a controlled `prepareDefaultCommunity()` write path for `communities/nyc` and `userCommunities/{uid}/nyc`.
- The panel only treats NYC as prepared after a successful write stores `communities/nyc/preparedAt`.
- Kept `MULTI_COMMUNITY_ENABLED=false`; no user-facing community switcher or scoped browsing behavior was enabled.
- Synced the Admin security copy box with the canonical rules in `SECURITY-RULES.md`.

### Files touched
- `index.html`
- `SECURITY-RULES.md`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- `MULTI_COMMUNITY_ENABLED` remains `false`.
- No public feature flag was enabled.

### Firebase paths added/changed
- Owner-only migration writes may create/update:
  - `communities/nyc`
  - `userCommunities/{uid}/nyc`
- Existing app data remains global:
  - `users`
  - `wishlist`
  - `dynamax`
  - `gmax`
  - `costumes`
  - `have`
  - `offers`
  - `trades`

### Security rules changes needed
- `SECURITY-RULES.md` canonical block was updated to v5.
- v5 adds owner-only write rules for:
  - `communities`
  - `userCommunities`
  - `communityRequests`
- Publish v5 rules before running the owner-only NYC preparation button in production.

### Manual test checklist
- Non-owner admins should not see the "Owner maintenance · NYC community foundation" panel.
- Owner should see the panel in Admin.
- Before v5 rules are published, the Prepare NYC action may fail with permission denied; that is expected.
- After v5 rules are published, owner can click Prepare NYC and verify `communities/nyc` exists in Firebase.
- Confirm Browse, Strings, Inventory, Schedule, and login behavior remain unchanged.

### Known risks / TODOs
- The owner-only migration relies on existing users having `authUid`; users without `authUid` are indexed by username only until repaired.
- `communityRequests` rules are owner-only for now; later create/join flows need more nuanced rules.
- `MULTI_COMMUNITY_ENABLED` must stay false until the default community write has been verified and scoping screens are implemented.

### Instructions for the next contributor
- Do not expose community UI to members or ordinary admins yet.
- Do not make Browse/Strings/Inventory/Schedule community-scoped until `communities/nyc` exists on the server.
- When starting Phase 2, treat missing `communityId` on old records as `nyc`.

## 2026-05-25 - Codex - Multi-community Phase 1 foundation, pass 3

### Summary
- Added owner-only verification details to the NYC community foundation panel.
- The panel now shows whether it is using the Firebase community record or local preview data.
- Added dry-run scoping counts for Browse, Strings, Inventory browse, and Schedule picker.
- Added server drift detection so the owner can see when local users are missing from `communities/nyc` and refresh the foundation write.
- Kept `MULTI_COMMUNITY_ENABLED=false`; no production behavior changed for members or ordinary admins.
- Marked the v5 Firebase rules as confirmed after the owner successfully created `communities/nyc`.

### Files touched
- `index.html`
- `SECURITY-RULES.md`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- `MULTI_COMMUNITY_ENABLED` remains `false`.
- No public or admin-wide community UI was enabled.

### Firebase paths added/changed
- No new paths beyond the Phase 1 pass 2 foundation:
  - `communities/nyc`
  - `userCommunities/{uid}/nyc`
- The owner-only Prepare/Refresh NYC action may update those same paths if local users drift from the server copy.

### Security rules changes needed
- No new rules beyond v5.
- `SECURITY-RULES.md` now notes that v5 was confirmed by the owner on 2026-05-25.

### Manual test checklist
- Owner should see the maintenance panel in Admin.
- Non-owner admins and members should not see the maintenance panel.
- The panel should show "Server ready" after `communities/nyc/preparedAt` exists and member counts are current.
- If new users are added later, the panel should show server drift and allow refreshing NYC.
- Dry-run counts should not change Browse, Strings, Inventory, Schedule, login, or exports while `MULTI_COMMUNITY_ENABLED=false`.

### Known risks / TODOs
- Dry-run counts are trainer-level estimates; they do not yet prove every per-Pokemon filter path is scoped correctly.
- Users without `authUid` can only be represented in `communities/nyc/memberUsernames` until their accounts are repaired/logged in.
- Future Phase 2 still needs actual scoped rendering and then subscription reduction.

### Instructions for the next contributor
- Keep this panel owner-only until the community switcher/scoping UX is ready.
- Use the dry-run counts to validate that all intended NYC members are present before enabling any scoping.
- When implementing Phase 2, scope one surface at a time: Browse first, then Strings/Compare/Trade Match, then Inventory browse, then Schedule picker.

## 2026-05-25 - Codex - Multi-community Phase 2 pass 1, owner Browse preview

### Summary
- Added an owner-only Browse preview toggle to the NYC community foundation panel.
- Added `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true` as a code availability gate and `pogoOwnerCommunityPreview_v1` as the owner's local opt-in state.
- Added Browse-only community member filtering through `browseAllowedUsers()`; `activeUsers()` itself was left unchanged so Strings, Inventory, and Schedule cannot inherit preview behavior accidentally.
- Added a Browse banner when preview is active so the owner can tell the Browse tab is scoped.
- Tightened default community normalization so a prepared `communities/nyc` record can be trusted as explicit membership instead of always being overwritten with every local user.
- Kept `MULTI_COMMUNITY_ENABLED=false`; no public community switcher or member/admin-visible community behavior was enabled.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- Added `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true`.
- `MULTI_COMMUNITY_ENABLED` remains `false`.
- Owner runtime toggle is stored in localStorage as `pogoOwnerCommunityPreview_v1`.

### Firebase paths added/changed
- No new Firebase paths.
- Browse preview reads existing `communities/nyc/memberUsernames` when `communities/nyc/preparedAt` exists.

### Security rules changes needed
- None beyond v5.
- Preview is read-only and owner-only in the UI.

### Manual test checklist
- Owner can see the "Browse preview" toggle in the owner maintenance panel.
- Non-owner admins and members do not see the owner maintenance panel or toggle.
- With preview off, Browse behaves exactly as before.
- With preview on, Browse shows the owner preview banner and only includes trainers in `communities/nyc/memberUsernames`.
- Activity filters still apply on top of the community preview.
- Strings, Compare, Trade Match, Inventory browse, Schedule picker, login, and exports remain unchanged.

### Known risks / TODOs
- This pass scopes only Browse rendering, not Firebase subscriptions, so bandwidth is unchanged.
- Browse preview depends on `communities/nyc/preparedAt`; if the community record is stale, refresh NYC from the owner panel first.
- The dry-run trainer counts are still estimates; verify actual rendered Browse results before copying this pattern to Strings.

### Instructions for the next contributor
- Keep owner preview as a local opt-in until at least Browse and Strings have been validated.
- Next Phase 2 pass should scope Strings/Compare/Trade Match separately; do not reuse Browse-only helper names for other surfaces.
- If adding a true community switcher later, keep this owner-preview localStorage key separate from the public selected-community state.

## 2026-05-25 - Codex - Multi-community Phase 2 pass 2, owner Strings/Compare preview

### Summary
- Expanded the owner-only preview toggle from Browse-only to Browse + Strings.
- Added an owner preview banner on the Strings tab.
- Scoped the Strings trainer list to `communities/nyc/memberUsernames` only when owner preview is on and the owner is signed in.
- Added guards so Compare and Trade Match cannot be opened for out-of-community trainers while owner preview is enabled.
- Kept Inventory browse, Schedule picker, login, exports, and Firebase subscriptions unchanged.
- Kept `MULTI_COMMUNITY_ENABLED=false`; this remains an owner-only preview, not a public launch.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE` remains `true`.
- `MULTI_COMMUNITY_ENABLED` remains `false`.
- Existing localStorage opt-in `pogoOwnerCommunityPreview_v1` now controls Browse + Strings preview.

### Firebase paths added/changed
- No new Firebase paths.
- Preview reads existing `communities/nyc/memberUsernames` when `communities/nyc/preparedAt` exists.

### Security rules changes needed
- None beyond v5.
- This is read-only UI filtering.

### Manual test checklist
- Owner with preview off should see global Browse and global Strings behavior.
- Owner with preview on should see the Browse banner and the Strings banner.
- Owner with preview on should only see trainers from `communities/nyc/memberUsernames` in Strings.
- Compare and Trade Match buttons should only appear for the scoped Strings trainers; direct calls for out-of-community trainers should toast and stop.
- Inventory browse and Schedule should remain unchanged.
- Non-owner admins and members should not see the owner maintenance panel, preview toggle, or preview banners.

### Known risks / TODOs
- This still does not reduce Firebase bandwidth because protected subscriptions are unchanged.
- The preview does not yet scope Safe-to-transfer trainer selection, Inventory browse, or Schedule.
- Direct console access could still call old functions, but the guard blocks out-of-community compare/trade-match modals when owner preview is enabled.

### Instructions for the next contributor
- Validate owner preview against production before implementing Inventory browse scoping.
- Keep future scoping helpers surface-specific until the UX is proven stable.
- If preview shows no visible difference, that likely means all current users are in NYC; test by temporarily removing a test member from `communities/nyc/memberUsernames` in a local/dev copy before shipping public scoping.

## 2026-05-25 - Codex - Owner preview live community subscription fix

### Summary
- Fixed owner preview using stale local community membership after Firebase edits.
- The app now subscribes to `communities`, `userCommunities`, and `communityRequests` for the owner-preview path even while `MULTI_COMMUNITY_ENABLED=false`.
- `showApp()` re-checks protected subscriptions after `cur` is known, so owner-only community preview data can load reliably after sign-in/session restore.
- Turning the owner preview toggle on also requests protected subscriptions again, so the preview can recover if the first auth observer fired before `cur` was set.
- Kept the preview UI owner-only; ordinary admins and members still do not see the maintenance panel or preview toggle.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new flags.
- `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true` now also controls owner-only community data subscriptions.
- `MULTI_COMMUNITY_ENABLED` remains `false`.

### Firebase paths added/changed
- No new paths.
- Owner preview now live-subscribes to existing `communities`, `userCommunities`, and `communityRequests` paths.

### Security rules changes needed
- None beyond the current community-aware rules.
- These paths must be readable to signed-in users under the current rules; writes remain constrained by rules.

### Manual test checklist
- Owner signs in, enables Browse + Strings preview, and sees preview banners.
- Remove `TestUser` from `communities/nyc/memberUsernames` in Firebase.
- After refresh/sign-in, `TestUser` should disappear from Browse and Strings while preview is on.
- Turn preview off and verify global Browse/Strings behavior returns.
- Add `TestUser: true` back to `communities/nyc/memberUsernames`.
- Non-owner admins/members should still not see owner preview controls.

### Known risks / TODOs
- Owner preview now downloads community metadata for the owner even with the public multi-community feature disabled.
- This still does not reduce global list subscriptions; it only makes owner preview scoping accurate.

### Instructions for the next contributor
- If owner preview looks stale again, first inspect `_pathLoadState.communities` and whether `subscribePath('communities')` is active after owner sign-in.
- Keep Phase 2 scoping behind owner preview until Browse and Strings are verified against production data.

## 2026-05-25 - Codex - Multi-community Phase 2 pass 3, owner Inventory browse preview

### Summary
- Expanded the owner-only community preview to Inventory -> Browse community.
- Renamed the owner toggle from "Browse + Strings preview" to "Community preview" because it now covers Browse, Strings, Compare, Trade Match, and Inventory browse.
- Added an owner preview banner inside Inventory browse.
- Inventory browse now filters trainers by `communities/nyc/memberUsernames` when owner preview is on, while preserving the existing activity filter and self-exclusion.
- My inventory remains unchanged.
- Schedule remains unchanged.
- Kept `MULTI_COMMUNITY_ENABLED=false`; this remains an owner-only preview, not a public launch.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new flags.
- Existing localStorage opt-in `pogoOwnerCommunityPreview_v1` now controls Browse, Strings, Compare, Trade Match, and Inventory browse preview.

### Firebase paths added/changed
- No new Firebase paths.
- Inventory browse preview reads existing `communities/nyc/memberUsernames` from the live owner-preview subscription.

### Security rules changes needed
- None beyond the current community-aware rules.
- This is read-only UI filtering.

### Manual test checklist
- Owner with preview off should see global Inventory -> Browse community behavior.
- Owner with preview on should see an Inventory browse preview banner.
- Remove `TestUser` from `communities/nyc/memberUsernames`; with preview on, `TestUser` should disappear from Inventory browse in both By Pokemon and By Trainer modes.
- My inventory should still show the current user's own inventory regardless of community preview.
- Browse and Strings preview behavior should remain unchanged.
- Schedule should remain unchanged.
- Non-owner admins/members should not see the owner preview controls or banners.

### Known risks / TODOs
- This still does not reduce Firebase bandwidth because the global `have` subscription remains unchanged.
- Offer modals still use the currently rendered Inventory browse result as the primary entry point; if direct console calls become a concern, add an owner-preview guard around `openOfferModal`.
- Schedule scoping remains the next separate pass because scheduled trades have quota/reservation side effects.

### Instructions for the next contributor
- Validate Inventory browse preview in production before touching Schedule.
- Keep Schedule as a separate Phase 2 pass; do not bundle it with offer/trade quota changes.

## 2026-05-25 - Codex - Multi-community Phase 2 pass 4, owner Schedule preview

### Summary
- Expanded the owner-only community preview to the Schedule tab.
- Schedule preview now scopes visible scheduled rows, reserved-trade rows, the Schedule notification badge, and the schedule partner picker to `communities/nyc/memberUsernames`.
- Quota cards intentionally still use the owner's real daily scheduled/completed trade usage, even if a hidden out-of-community trainer is involved. This keeps the owner from overbooking regular/special/remote usage while testing the preview.
- Added an owner preview banner inside Schedule explaining the scope and quota behavior.
- Kept `MULTI_COMMUNITY_ENABLED=false`; this remains an owner-only preview, not a public launch.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new flags.
- Existing localStorage opt-in `pogoOwnerCommunityPreview_v1` now controls Browse, Strings, Compare, Trade Match, Inventory browse, and Schedule preview.

### Firebase paths added/changed
- No new Firebase paths.
- Schedule preview reads existing `communities/nyc/memberUsernames` from the live owner-preview subscription.

### Security rules changes needed
- None beyond the current community-aware rules.
- This is read-only UI filtering plus client-side schedule partner validation.

### Manual test checklist
- Owner with preview off should see global Schedule behavior.
- Owner with preview on should see a Schedule preview banner.
- Remove `TestUser` from `communities/nyc/memberUsernames`; with preview on, `TestUser` should disappear from the Schedule partner picker.
- Any scheduled/reserved rows involving only out-of-community counterparties should be hidden while preview is on.
- Schedule quota cards should still reflect the owner's real trade usage for the day.
- Turn preview off and verify global Schedule behavior returns.
- Add `TestUser: true` back to `communities/nyc/memberUsernames`.
- Non-owner admins/members should not see the owner preview controls or banners.

### Known risks / TODOs
- This still does not reduce Firebase bandwidth because the global `trades` subscription remains unchanged.
- Schedule quota counters are intentionally not community-scoped; this should be revisited only if/when quotas become community-specific, which they are not in Pokemon GO.
- Offers and accepted-offer trade creation remain globally stored; community scoping is currently a preview filter only.

### Instructions for the next contributor
- Validate Schedule preview in production before touching create/join community flows.
- If a hidden trade still affects quota cards, that is expected; do not "fix" it unless product direction changes.
- The next safe Phase 2 pass is a small audit of cross-surface consistency before exposing any community switcher or create/join UI.

## 2026-05-26 - Codex - Inventory browse performance + Scatterbug pattern support

### Summary
- Paused broader Phase 2 community work to investigate reports that Inventory -> Browse community is slow on mobile and desktop.
- Audit finding: the slow path was mostly client-side rendering, not Firebase reads. `renderHaveBrowse()` rebuilt large hidden trainer item grids on every search keystroke/refresh, repeatedly scanned wishlist/list sources for matches/sprites, repeatedly filtered offers per item, and created many sprite tags before users expanded trainer cards.
- Implemented a localized fix without changing the data model:
  - Debounced the Inventory browse search input via `queueRenderHaveBrowse()`.
  - Added per-render caches for current-user wanted entries, sprite lookup, and offer lookup/counts.
  - Changed By Trainer view so the header/counts still render immediately, but the item grid and its sprites are hydrated only when that trainer card is expanded.
  - Wrapped the render path with existing `perfTime('render:inventory-browse', ...)` so Health Check/perf output can show the timing.
- Added selectable Scatterbug pattern entries using the existing `EXTRA_FORM_ENTRIES` model.
- Exported list images now draw a small pattern label on Scatterbug form sprites so same-looking Scatterbug sprites are distinguishable without making normal UI messy.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new flags.
- `MULTI_COMMUNITY_ENABLED` and owner preview flags are unchanged.

### Firebase paths added/changed
- No new Firebase paths.
- Existing Scatterbug entries remain valid; new form names are stored exactly like other form entries, e.g. `wishlist/{username}/Scatterbug (Garden)`.

### Security rules changes needed
- None.
- This uses existing list/inventory write paths and existing global read/subscription behavior.

### Manual test checklist
- Inventory -> Browse community -> By Trainer:
  - Search for a trainer and a Pokemon name; verify the results update after a short debounce.
  - Expand a trainer and verify item cards, sprites, offer badges, match badges, and "General offer message" still work.
  - Toggle "Only matches" and verify trainer counts/results still make sense.
- Inventory -> Browse community -> By Pokemon:
  - Search by Pokemon and trainer name; verify cards and pending offer sections still render.
  - Open an offer modal from a trainer chip.
- Performance:
  - On a phone, type into Inventory browse search and confirm the page no longer visibly locks on each keystroke.
  - In Health Check/perf panel, inspect `render:inventory-browse` after using Community Browse.
- Scatterbug:
  - Add `Scatterbug (Garden)` and another pattern to My List.
  - Verify normal list rows display the full form name but do not add extra visual clutter.
  - Verify matching/trade behavior uses exact form names, consistent with other forms.
  - Export a list image and confirm Scatterbug form labels are visible on the sprites.
  - Existing plain `Scatterbug` entries should still display and export as plain Scatterbug with no pattern label.

### Known risks / TODOs
- By Pokemon view still renders all Pokemon cards in one pass. The new caches help, but a future low-risk pass could add a "show more" or windowed rendering if large communities still report slowness there.
- By Trainer view still computes per-trainer item summaries for counts and search matching, but no longer creates all hidden item DOM/sprite tags up front.
- Scatterbug pattern matching is exact-name based. Plain `Scatterbug` is intentionally left as a generic legacy entry and does not automatically match every pattern.

### Instructions for the next contributor
- Do not revert the lazy trainer hydration unless replacing it with real virtualization/windowing.
- If reports continue, compare `render:inventory-browse` timings between By Trainer and By Pokemon before changing Firebase subscriptions.
- Keep future Scatterbug changes consistent with the existing form-name model unless the app gets a broader form-normalization layer.

## 2026-05-26 - Codex - Inventory browse trainer-first collapsed layout

### Summary
- Confirmed the prior Inventory browse performance pass already supported the core mechanics for a trainer-first model: collapsed trainer cards, lazy item-grid hydration, and search filtering that works while cards are collapsed.
- Added the second pass needed for the requested default UX:
  - Inventory -> Browse now opens on `By Trainer` instead of the heavier `By Pokemon` grid.
  - Trainer cards show compact summary chips for wanted-match count, visible item count, mirror-only, don't-need-back, and giveaway counts.
  - Trainers are sorted with current-user want-list matches first, then offered quantity/item count, then recent activity/name fallback.
  - Expanding a trainer still lazily renders only that trainer's matching items.
  - Pokemon search still filters collapsed trainer cards and expansion shows the matching inventory items.
- Kept `By Pokemon` available as a secondary tab for users who prefer the old grouped view.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new feature flags.
- Existing community owner-preview flags are unchanged.

### Firebase paths added/changed
- No Firebase paths changed.
- No data migration required.

### Security rules changes needed
- None.
- This is a client-side rendering and sorting change only.

### Manual test checklist
- Inventory -> Browse community defaults to `By Trainer` after loading the tab.
- Trainers with Pokemon from the current user's want list appear before trainers with no matches.
- Search a Pokemon name/form; collapsed trainer cards should still filter to trainers offering it.
- Expand a filtered trainer card; only matching/visible items should render.
- Toggle "Only matches" and verify trainer cards and summary counts remain coherent.
- Switch to `By Pokemon` and verify the previous grouped browse still works.
- Mobile: summary chips should wrap under the trainer name without forcing hidden grids/sprites to render before expansion.

### Known risks / TODOs
- Trainer summaries still compute item lists to support counts and search matching, but avoid the much heavier DOM/sprite render until expansion.
- `By Pokemon` remains heavier and should be treated as a secondary/legacy browse mode unless future performance work adds windowing there.
- Summary chip labels are intentionally compact; if users find them unclear, add a small legend or tooltip rather than expanding every card.

### Instructions for the next contributor
- Keep `By Trainer` as the Community Browse default unless a measured regression shows otherwise.
- Before changing Firebase subscriptions, compare Health Check `render:inventory-browse` timings for `By Trainer` versus `By Pokemon`.
- If adding more inventory filters, route them through the existing `makeHaveBrowseContext()` / `haveBrowseTrainerSummary()` path so collapsed search stays consistent.

## 2026-05-26 - Codex - Inventory browse icon hints

### Summary
- Added subtle native hover/accessibility hints to the compact Inventory -> Browse trainer summary chips.
- The star, backpack, mirror-only, don't-need-back, and giveaway chips now explain what their counts represent without adding visible UI.
- Added the same hint to the per-Pokemon match star badge and the "Only matches" control.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Inventory -> Browse -> By Trainer: hover the summary chips on desktop and confirm the tooltip text explains each icon.
- Expand a trainer with matching items and hover the small star badge on a Pokemon card.
- Confirm mobile layout is unchanged; hints are additive only.

### Known risks / TODOs
- Native `title` hints are desktop-friendly but not a full mobile long-press tooltip system. If mobile users need the same guidance, add a small legend instead of per-card visible labels.

### Instructions for the next contributor
- Keep compact icon chips paired with either `title`/`aria-label` or a nearby legend when adding new inventory summary symbols.

## 2026-05-26 - Codex - Trade match mirror-only intent

### Summary
- Updated the trade match modal's `Possible mirrors` logic.
- A mirror candidate still requires both trainers to have the exact inventory entry.
- Each side's mirror intent can now come from either:
  - that Pokemon/form being on their want list, or
  - that exact inventory entry being marked `mirror only`.
- This covers the common case where a trainer marks an inventory item as mirror-only but forgets to also add it to their want list.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Open Strings -> trade match with a trainer where both users have the same Pokemon/form and both list it in wants; it should still appear under `Possible mirrors`.
- Remove the other trainer's wishlist entry but keep their inventory item marked mirror-only; it should still appear under `Possible mirrors` if you want or mirror-own the same item.
- Confirm normal inventory overlap with no want-list entry and no mirror-only flag on either side does not appear as a possible mirror.
- Confirm `They have that you want` and `You have that they want` sections are unchanged.

### Known risks / TODOs
- Matching remains exact by stored inventory key, including form and gender where present. If the product should treat mirror-only gender as flexible, adjust this separately and test offer preselection too.

### Instructions for the next contributor
- Keep `Possible mirrors` stricter than plain inventory overlap. Mirror-only can imply "I want the same thing back," but normal inventory alone should not.

## 2026-05-26 - Codex - Inventory return-preference wording pass

### Summary
- Reviewed Inventory return-preference flags against Pokemon GO trading intent.
- Kept the existing Firebase/data fields unchanged for compatibility:
  - `any`
  - `mirrorOnly`
  - `dontNeedBack`
  - `giveaway`
- Renamed the confusing user-facing `Don't need back` / `DNB` language to `Fair trade`.
- Updated labels/tooltips/copy so the mental model is:
  - `Open`: mirror preferred, but anything from the user's want list is okay.
  - `Mirror only`: strictly same Pokemon/form back.
  - `Fair trade`: comparable value from the user's want list; not necessarily a mirror.
  - `Giveaway`: bag-space pressure; wishlist/lucky/size offers preferred, but anything is okay.
- Did not add a What's New entry because this is clarity/polish for an existing feature, not a new capability regular users need to be alerted about.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Inventory add form shows `Open`, `Mirror`, `Fair trade`, and `Giveaway`.
- Bulk edit mode selector uses `Open`, `Mirror only`, `Fair trade`, and `Giveaway`.
- Existing entries with `dontNeedBack: true` still render, but display as `Fair trade`.
- Cycling an inventory row mode still follows `Open -> Mirror -> Fair trade -> Giveaway -> Open`.
- Community Browse cards and offer modal copy explain Fair trade without using "don't need back."

### Known risks / TODOs
- The underlying field is still `dontNeedBack` to avoid data migration. Do not rename it casually.
- If the UI still feels busy, the next pass should consider a small legend or moving some mode badges to hover/detail only, but the labels are now shorter and more player-aligned.

### Instructions for the next contributor
- Treat `dontNeedBack` as the stored legacy field for the visible `Fair trade` mode.
- When adding new inventory surfaces, use player-facing `Fair trade` copy instead of exposing `DNB` or `Don't need back`.

## 2026-05-26 - Codex - Inventory fair-trade wording follow-up

### Summary
- Renamed the visible `Flexible` inventory return preference to `Fair trade` to avoid confusion with `Open`.
- Kept the underlying `dontNeedBack` field unchanged for backward compatibility.
- Updated add controls, bulk selector, badges, tooltips, offer modal copy, tour copy, and the historical What's New text for that mode.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Existing `dontNeedBack` inventory entries display as `Fair trade`.
- Add form return preferences read `Open`, `Mirror`, `Fair trade`, `Giveaway`.
- Cycling an inventory row still moves through the same four stored modes.
- Offer modal and Community Browse use `Fair trade` copy.

### Known risks / TODOs
- Stored data and code variable names still say `dontNeedBack`; this is intentional to avoid migration risk.

### Instructions for the next contributor
- Use `Fair trade` in user-facing UI. Do not reintroduce `Flexible`, `DNB`, or `Don't need back` unless doing a deliberate copy redesign.

## 2026-05-26 - Codex - Inventory return-preference semantics follow-up

### Summary
- Refined the return-preference copy after product clarification:
  - `Open` now means mirror preferred, but anything from the user's want list is okay.
  - `Fair trade` now means comparable value from the user's want list, not necessarily a mirror.
- Updated add-form tooltips, row button tooltips, Community Browse tooltips, offer modal copy, code comments, and historical What's New wording.
- Kept stored fields unchanged (`any`, `mirrorOnly`, `dontNeedBack`, `giveaway`).

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Hover `Open` in the Inventory add form; it should say mirror preferred but want-list offers are okay.
- Hover `Fair trade`; it should not say mirror preferred.
- Existing `dontNeedBack` entries should still display as `Fair trade`.
- Offer modal copy for Fair trade should ask for comparable value from the trainer's want list.

### Known risks / TODOs
- `Open` has no visible badge on inventory cards because it remains the default/no-special-condition stored mode. The add/bulk controls explain its meaning.

### Instructions for the next contributor
- Keep user-facing semantics distinct: `Open` is loose, `Fair trade` is value-sensitive, `Mirror` is strict, `Giveaway` is bag-pressure.

## 2026-05-26 - Codex - Inventory browse mobile icon legend

### Summary
- Added a compact icon legend above Inventory -> Browse community results so mobile users can understand trainer summary chips without hover.
- Legend explains want matches, listed inventory count, mirror-only, fair-trade, and giveaway inventory modes.
- Kept desktop hover titles in place; this is additive and does not change inventory data, community scoping, or matching logic.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Inventory -> Browse community shows the icon legend above trainer cards.
- Legend wraps cleanly on narrow mobile screens.
- Trainer cards still collapse/expand and summary chips remain unchanged.
- Desktop hover titles still explain summary chips.

### Known risks / TODOs
- The legend adds a little vertical space. If mobile feels crowded, make the legend collapsible or show only the mode chips after a small `Icons` disclosure.

### Instructions for the next contributor
- Keep this as a single shared legend near the Browse community controls; avoid repeating labels under every inventory card unless user testing shows it is still unclear.
