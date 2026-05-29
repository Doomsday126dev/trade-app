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
- Legend explains wants matches, distinct inventory entries, mirror-only, fair-trade, and giveaway inventory modes.
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

## 2026-05-26 - Codex - Row sprite slot containment

### Summary
- Fixed Pokémon sprite alignment/overflow in row-style UI by adding shared fixed sprite-slot CSS for Browse, My List, Inventory, compare/share cards, and offer modal sprite wrappers.
- Row images now fill their reserved slot with `object-fit: contain`, centered positioning, and inline sprite-normalization transforms disabled inside those fixed slots.
- This specifically prevents large sprites such as Wailmer, Dialga, Latias, and Mewtwo from bleeding into names, tags, quantities, or row boundaries while keeping small sprites centered.

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
- Inventory -> Browse community: expand a trainer with large Pokémon such as Wailmer, Dialga, Latias, Mewtwo, Heracross, and Pikachu; sprites should stay inside the left sprite column.
- Inventory -> Browse community on mobile width: large sprites should not overlap names, mode badges, notes, quantities, or offer buttons.
- My List rows: costumes/forms with crowns or max chips still render inside the sprite column and row controls still align.
- Browse tab rows and compare/trade-match cards: sprite thumbnails stay centered and do not shift text.
- Desktop and mobile dark theme should preserve existing badges and row spacing.

### Known risks / TODOs
- Row surfaces intentionally disable the sprite helper's transform-based normalization to protect layout. If very small sprites feel too small later, add a contained per-slot scaling pass that respects the slot bounds instead of re-enabling unrestricted transform bleed.

### Instructions for the next contributor
- Prefer wrapping new row thumbnails in `.pokemon-sprite-slot` or an existing fixed wrapper such as `.have-row-sprite`; avoid placing raw `spriteImg()` output directly next to text without a fixed-size slot.

## 2026-05-26 - Codex - Inventory summary chip sorting and Fair trade copy

### Summary
- Clarified `Fair trade` copy so it means comparable rarity from the trainer's wishlist, without implying it may still be a mirror trade.
- Renamed the Inventory Browse match legend to `Wishlist match`.
- Made trainer summary chips in Inventory -> Browse community clickable: clicking ⭐/🎒/🪞/🤝/📤 expands that trainer and sorts their visible inventory by that category.

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
- Inventory -> Browse community: hover or tap Fair trade surfaces; copy should say comparable rarity from the trainer's wishlist and should not mention mirrors.
- Inventory -> Browse community: the legend should read `⭐ Wishlist match`.
- Click a trainer's ⭐ chip; the trainer card should expand and wishlist matches should appear first.
- Click a trainer's 🪞, 🤝, or 📤 chip; that trainer's visible inventory should sort by mirror-only, fair-trade, or giveaway entries.
- Click a trainer's 🎒 chip; that trainer's visible inventory should sort with larger quantities first, then wishlist matches and dex order.
- Summary chip clicks should not collapse the trainer card accidentally.

### Known risks / TODOs
- The chip sort is per expanded trainer card and is intentionally not persisted across full re-renders.
- Historical maintenance-log entries may still describe earlier Fair trade wording for context; current UI semantics should follow this entry.

### Instructions for the next contributor
- Keep `Fair trade` distinct from `Mirror only`: fair trade means comparable rarity/value from the other trainer's wishlist, while mirror means same Pokemon/form only.

## 2026-05-26 - Codex - Sprite normalization restored inside fixed slots

### Summary
- Restored the app's existing per-sprite visual scaling inside fixed sprite slots so padded sprites no longer render as tiny dots.
- Kept overflow containment on Inventory/compare/share/offer row slots so large sprites cannot bleed into row text or quantities.
- Wrapped the Browse costume/other-list branch in `.pc-sprite-wrap` so Browse rows use the same fixed sprite-slot behavior as the main trade list branch.

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
- Browse tab on mobile: small species such as Bulbasaur, Pidgey, Rattata, and Pikachu should be visibly larger than before while staying in the sprite column.
- Inventory -> Browse community expanded trainer cards: Heracross, Mewtwo, Latias, Dialga, Wailmer, and baby Pokemon should stay inside their row/card and not overlap names, badges, notes, or quantities.
- Costume/Others Browse rows should use the same alignment behavior as regular Trades Browse rows.
- Max crowns/chips in Browse/My List should still render near the sprite and not affect row text.

### Known risks / TODOs
- Some sprite scale values are cached in browser localStorage. A hard refresh or health-check cache clear may be needed to see corrected scaling immediately on devices with stale sprite-scale cache entries.

### Instructions for the next contributor
- Do not globally disable `transform` on row sprite images again; that prevents overflow but also disables transparent-padding normalization. Prefer fixed wrappers plus selective `overflow:hidden` on row surfaces that need hard containment.

## 2026-05-26 - Codex - Browse sprite readability threshold

### Summary
- Increased Browse row sprite slots from 28px to 42px and render-requested Browse sprites at 42px so small species are readable instead of technically visible but tiny.
- Tightened the visual smoke test for Browse rows so it now checks fixed slot size and rendered image size, not just whether `.pc-sprite-wrap` exists.
- This is a targeted follow-up to the sprite overflow fix: the previous test guarded against clipping/overlap but did not fail on micro-sized Browse sprites.

### Files touched
- `index.html`
- `tests/visual-smoke.spec.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Browse tab on desktop: Bulbasaur, Charmander, Squirtle, Caterpie, Weedle, Pidgey, Rattata, Pikachu, and Alolan Raichu should be visibly larger than before.
- Browse tab on mobile: those same rows should keep a fixed sprite column and names/trainer chips should not overlap the sprite.
- Dynamax/Gigantamax/Others Browse rows should still show sprites and max/crown indicators without pushing text around.
- Inventory -> Browse community expanded trainer cards should still keep large sprites contained after this Browse-only sizing change.

### Known risks / TODOs
- Local authenticated Playwright runs may fail unless Firebase API key referrer settings allow localhost; deployed authenticated runs test the current GitHub Pages build, not unpushed local edits.
- The Browse visual test intentionally checks slot/readability. It does not measure actual opaque sprite pixels because many sprite sources are cross-origin.
- Control run on 2026-05-26 against the currently deployed GitHub Pages build failed as expected with 28px Browse slots (`Bulbasaur`, `Charmander`, `Squirtle`, etc.), confirming the stricter test catches the regression the old wrapper-only test missed.

### Instructions for the next contributor
- Do not weaken the Browse sprite test back to wrapper-only checks. If sprite sizing changes, keep a test assertion that would fail for 28px Browse slots.

## 2026-05-26 - Codex - Playwright visual smoke harness

### Summary
- Installed Playwright test tooling for repeatable desktop/mobile Chromium visual checks.
- Added a local static-server Playwright config and smoke tests for authenticated sprite/layout checks in Browse and Inventory -> Browse community.
- Added `PLAYWRIGHT_BASE_URL` support so the same smoke tests can run against deployed GitHub Pages when Firebase API-key referrer restrictions block local authenticated runs.
- Added `.gitignore` entries for generated dependency and Playwright artifact folders.

### Files touched
- `package.json`
- `package-lock.json`
- `playwright.config.js`
- `tests/visual-smoke.spec.js`
- `.gitignore`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None for the harness itself.

### Manual test checklist
- Run `npm run visual` without credentials; it should start the local server and skip authenticated tests cleanly.
- Run `POGO_TEST_USER=<username> POGO_TEST_PIN=<pin> npm run visual` with a confirmed working test account; desktop and mobile Chromium projects should verify Inventory community sprites and Browse sprite wrappers.
- To test the deployed site instead of local files, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=<username> POGO_TEST_PIN=<pin> npm run visual`.
- Verified on 2026-05-26 before the stricter Browse readability assertion: deployed smoke test passed with `TestUser` across desktop and mobile Chromium (`4 passed`).
- If login fails, inspect the test failure message first; it reports the login-screen error text.

### Known risks / TODOs
- The current Firebase rules require auth for most live reads, so visual tests need a confirmed working account/PIN. A stale or non-member test account will fail before reaching layout checks.
- The Firebase Web API key is intentionally HTTP-referrer restricted to the GitHub Pages origin. Authenticated Playwright runs should target `https://doomsday126dev.github.io/trade-app/`; local `localhost`, `127.0.0.1`, and `file://` runs should skip auth-backed flows or use a future explicit mock mode.
- The mobile project uses Chromium device emulation rather than WebKit/iOS Safari; this keeps setup lightweight but does not replace real iPhone Safari spot checks.

### Instructions for the next contributor
- Do not commit `node_modules/`, `test-results/`, or `playwright-report/`.
- Keep test credentials in environment variables only; do not hardcode real trainer PINs in test files.
- Prefer adding focused smoke tests for high-risk UI regressions instead of broad brittle screenshot snapshots.

## 2026-05-26 - Codex - Inventory tag toggle responsiveness

### Summary
- Investigated user feedback that toggling Inventory return-preference categories felt sluggish.
- Root cause: each Inventory row edit wrote the local/Firebase-backed inventory object and then called the global `syncFromLocal()` path, which re-rendered Browse, My List, Strings, Inventory, Schedule, admin panels, and notifications. That is unnecessary for rapid row-level edits such as cycling Open/Mirror/Fair trade/Giveaway.
- Added a scoped refresh path for Inventory writes. Current-user Inventory edits now update local data, queue Firebase sync exactly as before, and debounce a My Inventory-only render instead of forcing a whole-app refresh.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None. Writes still target the same `have/{username}` and `users/{username}/lastUpdated|lastSeen` paths.

### Security rules changes needed
- None.

### Manual test checklist
- My Inventory: click the return-preference button repeatedly on several rows; the UI should feel more responsive and should still cycle Open -> Mirror -> Fair trade -> Giveaway -> Open.
- My Inventory: change quantity, gender, giveaway note, bulk mode, bulk quantity, bulk delete, and single delete; rows/counts should update and persist after refresh.
- Inventory -> Browse community: after refresh or Firebase sync, other users should still see the updated return preferences.
- Offers and accepted-trade inventory decrements should still trigger the broader refresh path; do not scope those unless tested separately.

### Known risks / TODOs
- The row still re-renders the full My Inventory list after a short debounce; if users grow into hundreds of inventory rows, row-level DOM patching or list virtualization may be worth adding.
- Firebase snapshot echoes may still cause a broader refresh after the server accepts the queued write, but the immediate tap response no longer blocks on that full redraw.

### Instructions for the next contributor
- Keep row-level Inventory edits on the scoped `writeHave(...,{refresh:'mine'})` path unless the edit affects other tabs immediately.
- Do not change the `have/` data shape for this responsiveness issue; it is a render-scope problem, not a schema problem.

## 2026-05-26 - Codex - Approval enrollment and Trade Match placement

### Summary
- Fixed the new-member approval path so owner-approved users are added to the default NYC community membership index at the same time as their `users/` and `loginDirectory/` records.
- Added the same owner-only community-membership repair hook when repairing an existing account, so `communities/nyc/memberUsernames`, UID membership, and `userCommunities` can catch up when the owner repairs a user.
- Moved the Trade Match entry point out of Strings and into Inventory -> Browse community trainer rows, where the feature has the right inventory context.
- Updated app version and What's New copy for the Trade Match move.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None. This keeps using the existing owner-preview/community foundation flags:
  - `MULTI_COMMUNITY_ENABLED=false`
  - `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true`

### Firebase paths added/changed
- New owner approval/repair writes may touch:
  - `communities/nyc/memberUsernames/{username}: true`
  - `communities/nyc/members/{authUid}: true` when the account has an Auth UID
  - `communities/nyc/admins/{authUid}: true` for owner/admin users
  - `userCommunities/{authUid}/nyc`
- Existing approval writes still touch:
  - `users/{username}`
  - `loginDirectory/{username}`
  - `requests/{requestId}/status`

### Security rules changes needed
- No new rules beyond the existing community-foundation rules in `SECURITY-RULES.md`.
- Important: current community writes are owner-only. If non-owner admins should approve members directly into communities later, update rules intentionally instead of relying on the owner-only path.

### Manual test checklist
- Owner approves a pending request; verify Firebase contains both `users/{username}` and `communities/nyc/memberUsernames/{username}: true`.
- Owner repairs an existing user; if the user has `authUid`, verify `communities/nyc/members/{authUid}` and `userCommunities/{authUid}/nyc` are written.
- With owner Community preview on, newly approved users should appear in community-scoped Browse/Strings/Inventory/Schedule surfaces without clicking Prepare/Refresh NYC again.
- Strings tab: trainer rows should still show Compare/scale, but no longer show the Trade Match handshake button.
- Inventory -> Browse community: each trainer row should show a handshake button that opens the Trade Match modal for that trainer without expanding/collapsing the card.
- What's New should show v4.6.27 once per user/device sync state.

### Known risks / TODOs
- If a non-owner admin approves a member, the current owner-only community rules mean the approval can still succeed without a community enrollment write. Decide whether community membership management should be owner-only or admin-capable before Phase 3.
- This is still default-NYC only. Future community-specific approvals need a selected/requested community ID instead of always writing `nyc`.
- Trade Match still computes from global Pokemon list data; community preview only limits which trainer rows can open it.

### Instructions for the next contributor
- Keep approval and community enrollment coupled for owner actions; otherwise Phase 2 preview can silently hide newly approved users.
- Do not duplicate Pokemon list data under communities. Membership remains the scoping layer; wishlist/inventory data stays global for now.
- If adding a public community join flow, replace the hardcoded default-NYC approval path with a community-aware helper and update Firebase rules in the same change.

## 2026-05-26 - Codex - Phase 2 owner-preview offer scoping

### Summary
- Scoped public-offer side channels to the selected community membership set when owner Community preview is enabled.
- Offer badges, total incoming-offer counts, incoming-offer modal rows, and per-item offer lists now ignore offers from trainers outside `communities/nyc/memberUsernames` during owner preview.
- Opening an offer modal for an out-of-community trainer is now guarded in the same style as Compare/Trade Match.
- New public offers now include `communityId` metadata so later multi-community passes can filter by record metadata instead of only inferring from sender/recipient membership.

### Files touched
- `index.html`
- `SCALING-NOTES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- No new flags.
- Behavior is still gated by the existing owner-only preview path:
  - `MULTI_COMMUNITY_ENABLED=false`
  - `MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=true`
  - local owner toggle `pogo_owner_community_preview`

### Firebase paths added/changed
- Existing path remains `offers/{recipient}/{offerId}`.
- New offer records may include:
  - `communityId: "nyc"`
- No migration was applied to existing offers. Existing offers without `communityId` remain visible when both sender and recipient are in the selected community.

### Security rules changes needed
- None for this pass. Existing `offers` rules already allow the added child field.
- Future community-specific offer rules should validate `communityId` against sender/recipient membership before exposing this outside owner preview.

### Manual test checklist
- Owner removes `TestUser` from `communities/nyc/memberUsernames`, enables Community preview, and verifies TestUser is hidden from Inventory -> Browse and Strings as before.
- With owner preview on, stale/direct offer entry points for TestUser should show the owner-preview guard toast instead of opening the offer modal.
- If an offer exists from a removed trainer, incoming offer counts and per-item badges should not count it while owner preview is on.
- Create a new public offer while preview is on/off; verify Firebase writes `offers/{recipient}/{offerId}/communityId: "nyc"`.
- Disable owner preview and verify normal offer counts/lists still behave as before.

### Known risks / TODOs
- This is still preview-only and membership-inferred for old offers. Phase 3 should make offer creation explicitly community-aware for public multi-community use.
- Existing offers from a user who later leaves NYC are hidden in owner preview but not deleted. That is intentional for this pass.
- No user-facing What's New entry was added because this is an owner-only internal scoping pass.

### Instructions for the next contributor
- Do not duplicate offers under community nodes unless a later data model review decides it is necessary.
- Keep offer filtering centralized through `ownerPreviewAllowsOffer()` while Phase 2 remains preview-gated.
- When public community switching is enabled, evolve `ownerPreviewAllowsOffer()` into a general `offerBelongsToSelectedCommunity()` helper and update Firebase rules at the same time.

## 2026-05-26 - Codex - Admin repair permission fix

### Summary
- Fixed the Admin -> Repair account flow that was failing with `PERMISSION_DENIED`.
- Root cause: `repairMemberAccount()` wrote `authIndex/{targetAuthUid}` for another user, but the canonical Firebase rules intentionally allow only the signed-in user to write their own `authIndex` row.
- Repair now writes the target `users/{username}`, `loginDirectory/{username}`, and default NYC community membership paths, but leaves `authIndex` to be created by the repaired user on their next successful sign-in.
- Bumped `APP_VERSION` to `4.6.28` for health-check/debug visibility.

### Files touched
- `index.html`
- `SECURITY-RULES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- No new paths.
- Admin Repair no longer writes:
  - `authIndex/{targetAuthUid}`
- Admin Repair still writes, when applicable:
  - `users/{username}`
  - `loginDirectory/{username}`
  - `communities/nyc/memberUsernames/{username}`
  - `communities/nyc/members/{authUid}`
  - `communities/nyc/admins/{authUid}` for admin/owner users
  - `userCommunities/{authUid}/nyc`

### Security rules changes needed
- None. This fix preserves the current canonical rules.
- `SECURITY-RULES.md` now documents that `authIndex` is self-published by the signed-in user and should not be written during admin repair.

### Manual test checklist
- As Doomsday126, click Repair on a user marked `Needs repair`.
- If prompted, enter/generate a 6-digit PIN and verify the success toast copies login details.
- Verify Firebase has updated `users/{username}` and `loginDirectory/{username}`.
- If the user has/gets an Auth UID, verify NYC membership paths are written.
- Ask the repaired user to sign in once; after that, verify `authIndex/{theirUid}` appears/updates.

### Known risks / TODOs
- Immediately after repair and before the user signs in, their `authIndex` row may still be missing. That is expected and should not block login.
- If a user still cannot log in after repair, check `users/{username}/authUid`, `users/{username}/authEmail`, `loginDirectory/{username}/authReady`, and Firebase Authentication for the generated email row.

### Instructions for the next contributor
- Do not re-add target-user `authIndex` writes to admin repair unless Firebase rules are intentionally changed and documented.
- Keep the repair flow aligned with the security model: admins prepare login records; users publish their own Auth UID index when they actually authenticate.

## 2026-05-26 - Codex - PIN reset auth hardening and offer message refresh

### Summary
- Fixed a recurring existing-user login failure where Admin Reset/Repair could point Realtime Database at a new PIN/hash even when Firebase Auth did not actually create a matching login row.
- Root cause: `provisionFirebaseAuthForTrainer()` returned `EMAIL_EXISTS` as a non-fatal result, and Reset/Create paths could still write `authUid: null` or a stale `authVersion`. Users like `djentaprize` could then appear present in `/users`, Firebase Auth, and NYC membership, while fresh-browser login still returned "Wrong PIN".
- Added bounded auth-version provisioning: Reset/Create/Repair now require a fresh Firebase Auth UID and automatically advance generated auth email versions when an older generated email already exists.
- Added bounded auth-version login scanning so a stale `loginDirectory/{username}/authVersion` can still recover if the correct PIN exists at a nearby newer auth version, then self-heal on successful login.
- Updated the offer modal so selecting/deselecting offered inventory chips refreshes the generated message until the user manually edits the message textarea.
- Bumped `APP_VERSION` to `4.6.29` for health-check/debug visibility.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- No new paths.
- Existing writes remain:
  - `users/{username}`
  - `loginDirectory/{username}`
  - default NYC community membership paths during admin create/repair
- Successful sign-in may self-heal `users/{username}/authVersion`, `authEmail`, and `authUid` if the public login directory was stale.

### Security rules changes needed
- None. This pass works with the current rules model.
- Admin repair still does not write another user's `authIndex/{uid}`; the user publishes that row on their own next successful sign-in.

### Manual test checklist
- As Doomsday126, Reset `djentaprize` to a fresh six-digit PIN after this patch is deployed.
- Verify Firebase after reset:
  - `users/djentaprize/authUid` is non-empty
  - `users/djentaprize/authVersion` increased
  - `loginDirectory/djentaprize/authVersion` matches the user record
  - `loginDirectory/djentaprize/authReady` is `true`
- Have `djentaprize` sign in from a fresh browser/incognito with the new PIN.
- If a browser had stale login directory data, verify login still succeeds when the correct auth version is within the bounded scan window.
- In Inventory -> Browse Community, open an offer modal, select/deselect offered chips, and verify the message text updates.
- Type into the offer message manually, then select another chip; verify the app does not overwrite the manual edit.

### Known risks / TODOs
- If a username has more than `AUTH_VERSION_SCAN_LIMIT` stale generated auth rows, Reset/Repair may still fail until old Firebase Auth rows for that username are deleted or the scan limit is intentionally raised.
- Existing bad resets already written before this patch need one new Reset or Repair after deployment so the app can create a real fresh Auth UID.
- Auth-version scanning adds a few extra Firebase Auth attempts only when the login directory is stale; normal current users still sign in on the first attempt.

### Instructions for the next contributor
- Keep the invariant that Reset/Create/Repair must not update a user's PIN/hash unless Firebase Auth returned a real `uid` for the generated email/version.
- If future auth work adds Google sign-in or passwordless flows, keep `loginDirectory` as the pre-auth public lookup surface and avoid reading private `/users` before authentication.
- Do not treat `EMAIL_EXISTS` as success unless the code also verifies that the existing Auth row can sign in with the same PIN.

## 2026-05-26 - Codex - Tab INP render-scheduling pass

### Summary
- Investigated an early Cloudflare Web Analytics INP report pointing at `#app>div.tabs>button.tab.active`.
- Cloudflare's sample was tiny, but the app still had a real performance risk: `showApp()` and `refreshAll()` eagerly rendered Browse, My List, Strings, Inventory, Schedule, and Admin even when only one tab was visible.
- Added a small active-tab render scheduler so tab clicks update the selected tab immediately and only the visible surface renders.
- Changed data refreshes to update the active tab plus lightweight badges instead of rebuilding hidden tabs.
- Background event refresh now rerenders Browse or Schedule only when one of those tabs is currently visible.
- Bumped `APP_VERSION` to `4.6.30` for health-check/debug visibility.

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
- Sign in as a normal user and switch between Browse, My List, Strings, Inventory, and Schedule; each tab should populate after it opens.
- Sign in as Doomsday126 and open Admin; admin rows, pending requests, and repair controls should still render.
- Make an Inventory change and verify the current tab updates without visibly refreshing unrelated tabs.
- Open Schedule after event data loads and verify event banners/counters still appear.
- In Cloudflare Web Analytics, re-check INP after more real interactions; treat the first few samples as directional, not conclusive.
- Automated attempt: `POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual -- --project=desktop tests/visual-smoke.spec.js` could start locally with approval, but failed before app assertions because the local test login returned `User not found`. This needs a separate test-harness/auth-directory follow-up and does not validate or invalidate the render-scheduling patch.

### Known risks / TODOs
- Hidden tabs no longer rerender on every Firebase sync; if a hidden view ever looks stale, switching away/back should refresh it. If users report stale hidden data after this pass, add targeted dirty flags rather than restoring full `refreshAll()` rendering.
- The active tab can still be heavy if that tab itself renders many DOM nodes; Inventory Community Browse already moved toward trainer-first lazy rendering, but Browse/Strings can still be optimized further.

### Instructions for the next contributor
- Keep `switchTab()` lightweight. Do not reintroduce "render every screen" work directly into tab clicks.
- Prefer `renderActiveTab()` or `queueRenderActiveTab()` for future refresh paths.
- If adding another top-level tab, update `renderActiveTab()` so the tab participates in the lazy render model.

## 2026-05-26 - Codex - Schedule outside-app trades

### Summary
- Added support for scheduling trades with people who are not app members.
- Schedule modal still supports selecting app trainers, but now also has an "Outside app" text field for trainer names or Discord handles.
- Scheduled external-only trades are owned by the organizer and still count against daily regular/special/remote availability.
- External people are displayed as small "Outside app" pills on schedule cards instead of creating fake user/member records.
- Bumped `APP_VERSION` to `4.6.31` and added a user-facing What's New entry.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- No new top-level paths.
- `trades/{tradeId}` may now include optional fields:
  - `externalPartners`: string array of non-app trainer labels
  - `externalPartner`: first label for backward/simple display compatibility

### Security rules changes needed
- None. External-only schedule records still satisfy the existing `trades/{tradeId}` rule because `organizer` is the signed-in username.

### Manual test checklist
- Schedule a regular trade with no app trainer selected but with an outside-app name; verify it saves and regular-left decreases by the chosen count.
- Schedule a special trade with only an outside-app name; verify special-left decreases.
- Schedule a remote trade with only an outside-app name; verify remote-open increases.
- Edit the external scheduled trade; verify the outside-app field is prefilled and can be changed/cleared.
- Try saving with no app trainer and no outside-app name; verify the app blocks it with a helpful toast.
- Confirm the trade does not create a fake user, `authIndex`, or community member.

### Known risks / TODOs
- External partner labels are display-only. They do not receive notifications, offers, inventory restoration, or app-visible trade records.
- Multiple outside-app names are accepted as comma-separated labels, but there is no structured identity model for them yet.

### Instructions for the next contributor
- Keep external scheduled trades organizer-owned unless/until a real "guest contact" model is intentionally designed.
- Do not add non-app people to `users`, `authIndex`, or community membership just to make Schedule counters work.

## 2026-05-27 - Codex - Playwright auth test target clarification

### Summary
- Updated the authenticated visual smoke helper so local `localhost`, `127.0.0.1`, and `file://` runs skip auth-backed flows instead of failing against production Firebase restrictions.
- Added `docs/TESTING.md` with the required deployed GitHub Pages command for auth-backed Playwright smoke tests.
- Kept Firebase restrictions and production auth logic unchanged.

### Files touched
- `tests/visual-smoke.spec.js`
- `docs/TESTING.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Local: run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8878 npm run visual -- --project=desktop tests/visual-smoke.spec.js`; authenticated tests should skip rather than attempt Firebase login.
- Deployed auth-backed: run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.
- Confirm no localhost or 127.0.0.1 referrers were added to Firebase/API-key restrictions.

### Known risks / TODOs
- There is no local mock/test mode yet, so current local Playwright coverage is limited for authenticated flows.
- Deployed auth-backed tests validate the published app, not unpushed local edits.

### Instructions for the next contributor
- Keep production Firebase origin restrictions intact.
- Add a deliberate mock/test mode before attempting local authenticated Playwright coverage.

## 2026-05-27 - Codex - Priority helper modularization

### Summary
- Started the first low-risk modularization pass by extracting pure priority/list label helpers out of the monolithic `index.html`.
- Added a classic browser script at `js/domain/priorities.js` that exposes `window.PogoDomain.priorities`.
- Kept the existing inline app identifiers bound in `index.html` so callers still use `PRI`, `PRI_ORDER`, `LIST_LABELS`, `priLabel`, `priName`, and `listLabel` unchanged.
- Left `priBadge` in `index.html` because it returns UI-facing markup/text and belongs with a later UI badge extraction.

### Files touched
- `index.html`
- `js/domain/priorities.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Load the app and confirm the main script starts without "Priority helpers failed to load".
- Confirm H/M/L labels still render as High/Medium/Low in My List, Browse, Strings, and Inventory.
- Confirm list tab labels still render as Trades, Dynamax, Gigantamax, and Others.
- Run the available local visual smoke command; auth-backed flows may skip locally per `docs/TESTING.md`.

### Known risks / TODOs
- `index.html` still owns most app globals. Keep future extractions similarly small and behavior-preserving.
- Do not extract Firebase/auth/schedule/inventory write paths until they have narrower tests.

### Instructions for the next contributor
- Prefer extracting pure domain helpers before UI or service code.
- Do not move `priBadge` until a dedicated UI badge/helper module exists.

## 2026-05-27 - Codex - Username sort helper modularization

### Summary
- Extracted the pure `alphaCompare` sort helper from `index.html` into `js/domain/username.js`.
- Added a classic browser script that exposes `window.PogoDomain.username.alphaCompare`.
- Bound `alphaCompare` back into the main inline script so existing sort call sites remain unchanged.
- Left login/auth-shaped username helpers in `index.html` because they read app state and should be extracted later with stronger tests.

### Files touched
- `index.html`
- `js/domain/username.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Load the app and confirm the main script starts without "Username helpers failed to load".
- Confirm alphabetic/numeric user and Pokémon sorting still behaves normally in login, Browse, Strings, Admin, and Inventory.
- Run the local visual smoke command; auth-backed flows may skip locally per `docs/TESTING.md`.

### Known risks / TODOs
- `knownLoginUsernames`, `canonicalUsernameInput`, `normalizedUserRecord`, and `lastLoginTime` remain in `index.html` because they are coupled to auth/login state.

### Instructions for the next contributor
- Continue extracting only pure helpers until the app has enough tests around auth, Firebase writes, and rendering-heavy paths.

## 2026-05-27 - Codex - Behavior smoke coverage expansion

### Summary
- Expanded Playwright smoke coverage before further `index.html` modularization.
- Added auth-backed checks for Browse render/search/filter, Strings trainer sections, Inventory My Inventory and Community Browse expansion, Schedule render/modal open-close, and main tab switching.
- Kept localhost behavior unchanged: auth-backed flows still skip locally because Firebase/Auth is restricted to the GitHub Pages origin.

### Files touched
- `tests/visual-smoke.spec.js`
- `docs/TESTING.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Local: run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8878 npm run visual -- --project=desktop tests/visual-smoke.spec.js`; auth-backed cases should skip on localhost.
- Deployed auth-backed: run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.
- Confirm Browse, Strings, Inventory, and Schedule still render normally after login.

### Known risks / TODOs
- These tests validate current visible UI behavior, not Firebase write edge cases.
- Deployed auth-backed tests validate the published app, so run them after pushing when checking production.

### Instructions for the next contributor
- Keep adding smoke coverage before extracting rendering-heavy modules.
- Do not loosen Firebase origin restrictions for local tests; add an explicit mock/test mode first if local authenticated testing becomes necessary.

## 2026-05-27 - Codex - Deployed smoke verification for sprite containment

### Summary
- Verified the deployed GitHub Pages auth-backed Playwright smoke suite passed after the sprite containment fix.
- The previous 4 sprite-slot failures are cleared.
- Current smoke coverage includes Browse, Strings, Inventory, Schedule, tab switching, and sprite slot invariants.
- No production behavior changes were made in this docs-only update.

### Files touched
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Deployed auth-backed smoke passed with: `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.
- Result: 14 passed.

### Known risks / TODOs
- None for this docs-only verification entry.

### Instructions for the next contributor
- Keep the sprite-slot invariants intact; do not weaken those tests when adjusting sprite rendering.

## 2026-05-27 - Codex - Priority value helper extraction

### Summary
- Extracted pure priority value parsing/serialization helpers from `index.html` into `js/domain/priorityValues.js`.
- The new classic browser script exposes `window.PogoDomain.priorityValues` and `index.html` binds `entryGender`, `parsePri`, and `priValue` back to the same local names used by existing call sites.
- No behavior, Firebase paths, schemas, auth, persistence, rendering, schedule, inventory write, admin, backup, import, or export logic was changed.

### Files touched
- `index.html`
- `js/domain/priorityValues.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/priorityValues.js`.
- Run the inline script parse check for `index.html`.
- Assert `parsePri('H[lucky][shiny][xxl](female)')`, `parsePri('M(shiny f)')`, `priValue('L','m',false,false,true,false)`, and `entryGender('female')`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- `parsePri` remains a broad behavior dependency across lists, matching, strings, and exports, so keep deployed smoke coverage green before further extraction.

### Instructions for the next contributor
- Continue with cohesive pure domain helper clusters before moving UI markup helpers like `priBadge` or search-string/import helpers.

## 2026-05-27 - Codex - Text safety helper extraction

### Summary
- Extracted pure text safety helpers from `index.html` into `js/utils/textSafety.js`.
- The new classic browser script exposes `window.PogoUtils.textSafety` and `index.html` binds `safeFilePart`, `escHtml`, and `escAttr` back to the same local names used by existing call sites.
- No behavior, Firebase paths, schemas, auth, persistence, rendering, schedule, inventory write, admin, backup, import, or export logic was changed.

### Files touched
- `index.html`
- `js/utils/textSafety.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/utils/textSafety.js`.
- Run the inline script parse check for `index.html`.
- Assert `safeFilePart("Mazer's Trades List 2026!")`, `safeFilePart("")`, `escHtml('<div class="x">Tom & \\'Jerry\\'</div>')`, and `escAttr('"onmouseover=1"')`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- These helpers are used by both generated HTML and exported filenames, so keep direct escaping/filename assertions alongside smoke tests before further utility extraction.

### Instructions for the next contributor
- Keep UI markup helpers, sprite helpers, search-string helpers, and formatting helpers in `index.html` until they can be extracted as cohesive behavior-tested clusters.

## 2026-05-27 - Codex - Public security rules doc sanitization

### Summary
- Sanitized `SECURITY-RULES.md` for public-repo safety.
- Replaced private owner/deployment specifics with placeholders or generic guidance.
- Removed the copy-pasteable loose `have/` write variant and replaced it with a warning to preserve ownership checks.
- No deployed Firebase rules or application behavior changed.

### Files touched
- `SECURITY-RULES.md`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None for this docs-only sanitization.
- Future hardening: move production community-owner rules away from username literals and toward verified UID/owner-role checks.

### Manual test checklist
- Confirm `SECURITY-RULES.md` contains no real owner username, exact production referrer allow-list, or copy-pasteable loose write variant.
- Confirm the canonical block is clearly labeled as a sanitized public template requiring placeholder replacement before publishing.

### Known risks / TODOs
- The public template is no longer paste-verbatim until `OWNER_USERNAME_PLACEHOLDER` is replaced privately.
- Keep private deployment status and exact owner identifiers out of the public repo.

### Instructions for the next contributor
- Do not publish the public placeholder literally.
- If changing actual Firebase rules, update both this public reference and private operational notes deliberately.

## 2026-05-27 - Codex - Schedule date helper extraction

### Summary
- Extracted pure local-date schedule helpers from `index.html` into `js/domain/scheduleDates.js`.
- The new classic browser script exposes `window.PogoDomain.scheduleDates` and `index.html` binds `isoDate`, `parseIsoDate`, `todayIso`, `startOfWeek`, `addDays`, `fmtWeekRange`, and `WKDS` back to the same local names used by existing call sites.
- No behavior, Firebase paths, schemas, auth, persistence, rendering, schedule writes, inventory write, admin, backup, import, or export logic was changed.

### Files touched
- `index.html`
- `js/domain/scheduleDates.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/scheduleDates.js`.
- Run the inline script parse check for `index.html`.
- Assert `isoDate(new Date(2026, 4, 7))`, `parseIsoDate('2026-05-07')`, `startOfWeek(new Date(2026, 4, 27))`, `addDays(new Date(2026, 4, 24), 6)`, and `WKDS.length`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- These helpers intentionally preserve local-time behavior. Do not convert them to UTC helpers without a schedule behavior review.

### Instructions for the next contributor
- Keep event bonus parsing, schedule trade quota logic, and schedule persistence in `index.html` until they can be extracted as separate behavior-tested clusters.

## 2026-05-27 - Codex - Pokemon search term helper extraction

### Summary
- Extracted pure Pokemon search qualifier constants and helpers from `index.html` into `js/domain/pokemonSearchTerms.js`.
- The new classic browser script exposes `window.PogoDomain.pokemonSearchTerms` and `index.html` binds the same helper names back locally so existing call sites remain unchanged.
- No search-token behavior, import/export parsing, sprite logic, Firebase, auth, persistence, inventory writes, schedule writes, admin, backup, or rendering logic was changed.

### Files touched
- `index.html`
- `js/domain/pokemonSearchTerms.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/pokemonSearchTerms.js`.
- Run the inline script parse check for `index.html`.
- Assert regional form, dex region, Castform type, modifier filter, and form-variant helper outputs directly.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- This is a medium-risk pure extraction because these helpers feed generated search strings and import matching. Keep direct assertions around these helpers before any future search-token behavior changes.
- `entrySearchFilters`, `dexStringFromNumbers`, and import/export parsing intentionally remain in `index.html` for later, separately tested extractions.

### Instructions for the next contributor
- Do not change regional qualifier behavior as part of extraction work. Treat any Niantic search-token changes as product behavior changes with separate review and tests.

## 2026-05-27 - Codex - Repeatable domain helper checks

### Summary
- Added a Node-based domain helper check harness for the extracted classic browser helper modules.
- The script evaluates the helper files in a controlled `vm` context with a fake `window`, asserts exported namespaces, and verifies behavior for priorities, username sorting, priority value parsing, schedule dates, Pokemon search terms, and text escaping.
- No production app code, Firebase paths, auth, persistence, rendering, schedule, inventory, admin, backup, import, or export behavior was changed.

### Files touched
- `package.json`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `npm run check:domain`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run local visual smoke when app files change; auth-backed flows may skip locally per `docs/TESTING.md`.

### Known risks / TODOs
- `modSearchFilters('shiny male xxl')` currently returns `['male','xxl']`; shiny is handled elsewhere in current app behavior. Changing that expectation would be a product behavior change, not a test-harness change.

### Instructions for the next contributor
- Run `npm run check:domain` before and after future helper extractions.
- Add new direct assertions here when extracting additional pure helper modules so behavior drift is caught before deployed smoke tests.

## 2026-05-27 - Codex - Shiny modifier search helper check

### Summary
- Updated the pure Pokemon search-term helper so raw modifier parsing keeps `shiny` alongside gender/size filters.
- Updated the repeatable domain helper check to assert `modSearchFilters('shiny male xxl')` returns `['shiny','male','xxl']`.
- Generated H/M/L search strings remain dex-only; stored shiny list entries still use `parsePri`/`priValue` shiny flags. No Firebase, auth, persistence, rendering, schedule, inventory write, admin, backup, import, or export logic was changed.

### Files touched
- `js/domain/pokemonSearchTerms.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `npm run check:domain`.
- Run `node --check js/domain/pokemonSearchTerms.js`.
- Run the inline script parse check for `index.html`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- Import parsing still uses `modFromSearchFilters`; converting imported `shiny&25` strings into stored shiny flags would be a separate product behavior change.

### Instructions for the next contributor
- Do not reintroduce combined generated PoGo strings like `shiny&25,26` without reviewing Pokémon GO operator precedence. The current app intentionally keeps exported combined strings dex-only.

## 2026-05-27 - Codex - Search string domain helper extraction

### Summary
- Extracted pure Pokémon GO search-string constants and helper functions from `index.html` into a classic browser helper module.
- Bound the exported helpers back to the original local names in `index.html`, so existing call sites and generated string behavior remain unchanged.
- Added repeatable `check:domain` coverage for exact prefilter text, dex-only string generation, string splitting, combined priority strings, and string length classification.

### Files touched
- `index.html`
- `js/domain/searchStrings.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/searchStrings.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- `stringFromSearchItems` intentionally keeps the existing dex-only extraction behavior from `{term}` objects. It does not preserve region-qualified terms in generated combined strings.
- `buildStrings`, `entrySearchFilters`, import/export parsing, and string UI markup remain in `index.html` for later, separately tested extractions.

### Instructions for the next contributor
- Treat changes to `PREFILTER`, PoGo operator precedence, or region-qualified generated strings as product behavior changes, not modularization cleanup.

## 2026-05-28 - Codex - Schedule event rule helper extraction

### Summary
- Extracted pure schedule event bonus parsing/classification helpers from `index.html` into `js/domain/scheduleEventRules.js`.
- Bound the exported helpers back to the original local names in `index.html`, so schedule calculations continue to call the same function names.
- Added repeatable `check:domain` coverage for word/number parsing, current additional-vs-total special trade bonus behavior, event classification, and event ID fallback behavior.

### Files touched
- `index.html`
- `js/domain/scheduleEventRules.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/scheduleEventRules.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- Event wording detection was intentionally not changed. Any improvement to ambiguous event handling or scraped bonus wording should be a separate product behavior change.
- `dailyEventBonuses`, manual bonus controls, trade count calculations, and schedule write/render helpers remain in `index.html`.

### Instructions for the next contributor
- Keep event parsing behavior pinned with `npm run check:domain` before moving more schedule helpers.
- Do not merge `dailyEventBonuses` or schedule persistence into this pure domain helper without adding broader schedule behavior coverage first.

## 2026-05-28 - Codex - Schedule trade rule helper extraction

### Summary
- Extracted pure schedule trade rule helpers from `index.html` into `js/domain/scheduleTradeRules.js`.
- Bound the exported helpers back to their original local names in `index.html`, so schedule calculations continue to use the same call sites.
- Added repeatable `check:domain` coverage for external partner parsing, regular trade quantity clamping, and current scheduled-trade summary behavior.

### Files touched
- `index.html`
- `js/domain/scheduleTradeRules.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/scheduleTradeRules.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run local visual smoke; auth-backed flows may skip locally per `docs/TESTING.md`.
- After deploy, run `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.

### Known risks / TODOs
- `summarizeScheduledTrades` behavior was preserved exactly, including counting `scheduled`/`completed` as row counts while `regular`, `special`, `remote`, and `byStatus` use quantities.
- `tradesOnDate`, `visibleTradesOnDate`, `tradeCountsForDay`, preview filtering, schedule writes, and schedule rendering remain in `index.html`.

### Instructions for the next contributor
- Treat any quota semantics change as a product behavior change, not modularization cleanup.
- Keep extracting only helpers that receive all needed state as arguments until schedule render/write coverage is broader.

## 2026-05-28 - Codex - Pokemon inventory key helper extraction

### Summary
- Extracted pure inventory/stored Pokemon key helpers from `index.html` into `js/domain/pokemonKeys.js`.
- Bound the exported helpers back to their original local names in `index.html`, so inventory, offer, and trade-match call sites continue to use the same symbols.
- Added repeatable `check:domain` coverage for gender key parsing, inventory quantity aggregation, inventory entry mode precedence, note preservation, and current zero-value behavior.

### Files touched
- `index.html`
- `js/domain/pokemonKeys.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/pokemonKeys.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run `git diff --check`.
- Local visual smoke is optional; auth-backed flows may skip locally per `docs/TESTING.md`.

### Known risks / TODOs
- The extracted helpers preserve the existing `dontNeedBack` stored field for the visible "Fair trade" mode. Do not rename this field without a migration plan.
- `setHaveEntry`, `cycleInventoryGender`, inventory writes, offer writes, and trade-match behavior remain in `index.html`.
- `normalizeSpriteKey`, `costumeBaseName`, `spriteEntryForListItem`, and costume dedupe/source helpers remain in `index.html` because they touch sprite/catalog behavior.

### Instructions for the next contributor
- Treat inventory mode semantics and stored object shape as data-model behavior, not cleanup.
- Keep any future extraction around inventory writes separate from pure key/value normalization and cover it with browser smoke tests.

## 2026-05-28 - Codex - Pokemon entry rule helper extraction

### Summary
- Extracted pure Pokemon entry/tradeability helpers from `index.html` into `js/domain/pokemonEntryRules.js`.
- Bound the exported helpers back to their original local names in `index.html`, so costume dedupe, list-source filtering, and wishlist tradeability call sites continue to use the same symbols.
- Added repeatable `check:domain` coverage for unique entry dedupe, Unown form preservation, costume dedupe keys, untradeable Mythical filtering, and current Meltan/Melmetal/legendary/null behavior.

### Files touched
- `index.html`
- `js/domain/pokemonEntryRules.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/pokemonEntryRules.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run `git diff --check`.
- Local visual smoke is optional; auth-backed flows may skip locally per `docs/TESTING.md`.

### Known risks / TODOs
- Behavior was preserved exactly: `uniqueEntries` still dedupes by `name`, and `isTradeableForWishlist` still only blocks exact names in `UNTRADEABLE_MYTHICAL_NAMES`.
- `allCostumeEntries`, `maxTradeEntries`, `listSource`, sprite normalization, sprite lookup, rendering, and write paths remain in `index.html`.

### Instructions for the next contributor
- Treat any wishlist eligibility change as a product behavior change, not modularization cleanup.
- Do not merge sprite/cache/catalog source helpers into this module without separate visual and domain coverage.

## 2026-05-28 - Codex - Fuzzy text helper extraction

### Summary
- Extracted pure fuzzy text helpers from `index.html` into `js/domain/fuzzyText.js`.
- Bound `_phoneticCode` and `_levenshtein` back to their original local names in `index.html`, so `fuzzyMatchPokemon` and voice/search behavior continue to call the same symbols.
- Added repeatable `check:domain` coverage for current phonetic normalization quirks and Levenshtein edge cases.

### Files touched
- `index.html`
- `js/domain/fuzzyText.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Manual test checklist
- Run `node --check js/domain/fuzzyText.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline script parse check for `index.html`.
- Run `git diff --check`.

### Known risks / TODOs
- `fuzzyMatchPokemon` intentionally remains in `index.html` because it reads mutable autocomplete state (`acItems`) and belongs with voice/search UI behavior.
- The phonetic normalization outputs are preserved exactly, including odd-looking compressed forms such as `Pikachu -> pkch`.

### Instructions for the next contributor
- Treat any voice matching quality change as a behavior change, not modularization cleanup.
- Keep future fuzzy/search UI changes separate from this pure helper module unless they have browser coverage.

## 2026-05-28 - Claude - Sprite slug helper extraction (Cluster B)

### Summary
- Extracted pure sprite slug/key string helpers from `index.html` into `js/domain/spriteSlugs.js`, in two separate commits by risk.
- Low-risk pass (`refactor: extract sprite slug helpers`): moved `padDex`, `normalizeCostumeLookupKey`, `pokemondbGoSpeciesSlug`, and `normalizeSpriteKey`. `normalizeCostumeLookupKey` runs during script evaluation to build `POKEMONDB_GO_COSTUME_ALIAS_LOOKUP`, so its rebind is placed in the grouped rebind block above that const's initialization.
- Higher-risk isolated pass (committed separately): moved `REGIONAL_SLUG_MAP` and `pokemondbSlug` into the same module. `pokemondbSlug` directly determines which PokemonDB HOME sprite URL is built, so it was kept to its own commit for clean bisection.
- All moved bodies were verified byte-identical (whitespace-insensitive diff) against the originals before removal, including the combining-marks accent-strip regex.
- All four low-risk helpers plus `pokemondbSlug`/`REGIONAL_SLUG_MAP` are exported via `window.PogoDomain.spriteSlugs` and rebound to the same local names in `index.html`. Callers continue to call the rebound local names unchanged.

### Behavior preservation
- `pokemondbSlug` was protected with a full golden-test matrix in `check:domain` covering: A/G/H/P regional prefixes; `P-Tauros (Aqua)` reorder; regional punctuation (`G-Farfetch'd`, `G-Mr. Mime` with `dn` precedence); Basculin; Flabébé; Oricorio; Shellos; `Mr. Mime`; `Farfetch'd`; `Vivillon (Garden)`; female suffix (append / non-append / no double-append); `dn || name || ''` precedence and fallback; `Ho-Oh`/`Hitmonlee` no-overmatch; and empty/blank/undefined plus undefined-with-female early-return behavior.
- Pre-existing quirks were preserved exactly, including two that are effectively dead for the current data:
  - The `basculin-(red|blue|white)` -> `-striped` quirk does not fire for real entries, which are `Basculin (Red Stripe)` etc. (normalize to `basculin-red-stripe`, no match). Tests lock both the synthetic trigger (`Basculin (Red)` -> `basculin-red-striped`) and the real-data path (`basculin-red-stripe`).
  - The `oricorio-pa-u` -> `oricorio-pau` quirk does not fire for the real entry `Oricorio (Pa'u)` because the apostrophe is stripped to `oricorio-pau` before the quirk runs. Tests lock both the real apostrophe path and the synthetic `Oricorio (Pa-u)` hyphen path.
- These dead/synthetic quirks were intentionally NOT "fixed" — this was modularization only.

### Files touched
- `index.html`
- `js/domain/spriteSlugs.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Feature flags added/changed
- None.

### Firebase paths added/changed
- None.

### Security rules changes needed
- None.

### Verification
- `node --check js/domain/spriteSlugs.js`, `node --check scripts/check-domain-helpers.js`, `npm run check:domain`, inline `index.html` parse check, and `git diff --check` all passed for both commits.
- Deployed Playwright smoke was run against the actual extraction build (deploy confirmed serving the extracted module before running): `14 passed, 0 failed, 0 skipped`. Browse and Inventory sprite-slot checks passed on both desktop and mobile projects.

### Known risks / TODOs
- No sprite cache/fallback/image-loading/export/avatar/render logic was changed. `pokemondbSpriteUrl`, `spriteUrl`, and `spriteFallbackChain` are untouched and still call the rebound `pokemondbSlug`.
- `check:domain` proves string-output parity but cannot detect a wrong-but-valid sprite URL; the deployed smoke is the rendering gate and is mandatory for any future change to `pokemondbSlug`.
- The next sprite-pipeline candidates (`goCostumeSpriteUrl`, `pokemondbGoCostumeUrls`, `pokemondbSpriteUrl`, `spriteFallbackChain`, `spriteSourceIndex`, `costumeBaseName`, `spriteImg`) read app/sprite-cache state and are NOT pure; do not extract them as part of this modularization track without separate analysis.

### Instructions for the next contributor
- Any change to `pokemondbSlug` output is a behavior change (it picks sprite URLs), not modularization cleanup; pair it with the golden matrix and a deployed smoke run.
- Preserve the dead Basculin/Oricorio quirks unless a deliberate, separately-scoped sprite-correctness task decides to address them.

## 2026-05-28 - Claude - Relative-time helper extraction (Cluster A)

### Summary
- Extracted pure freshness/relative-time helpers from `index.html` into `js/domain/relativeTime.js` (commit `refactor: extract relative time helpers`).
- Moved `freshnessClass`, `freshnessLabel`, `freshnessColor`, `relativeTime`, and the `STALE_WARN`/`STALE_OLD` constants (verified those two constants were referenced nowhere else, so they were co-located into the module).
- Bodies copied byte-exact; all five exported via `window.PogoDomain.relativeTime` and rebound to the same local names in `index.html`.
- `freshnessLabel` and `relativeTime` overlap (two slightly different relative-time formatters); they were intentionally preserved as separate functions, NOT merged — merging would be a behavior change.

### Files touched
- `index.html`
- `js/domain/relativeTime.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- `node --check` on the module and harness, `npm run check:domain`, inline `index.html` parse check, and `git diff --check` all passed. Golden tests use a captured `now` plus mid-bucket offsets so timestamp deltas stay deterministic.

### Known risks / TODOs
- Output is display text only (no sprite/URL/render-shape impact), so a deployed smoke was not required for this one.
- Do not "dedupe" `freshnessLabel`/`relativeTime` without an explicit behavior-change task.

## 2026-05-28 - Claude - Group domain helper checks by module (test-only)

### Summary
- Reorganized `scripts/check-domain-helpers.js` so assertions are grouped under `// --- <module> ---` headers in script/module load order (commit `test: group domain helper checks by module`).
- Pure test organization: added section-header comments and relocated the `textSafety` block to the end so section order matches the actual `loadBrowserScript` array (the only block move).
- Proved no behavior change: the sorted set of `eq`/`deepEq`/`assert` lines is byte-identical before/after (244 == 244), and the non-comment code multiset is identical.

### Files touched
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- `node --check`, `npm run check:domain`, `git diff --check` all passed. No app code touched; no deployed smoke needed (harness-only).

### Known risks / TODOs
- The harness is ~590 lines now. If it keeps growing, consider per-module helper functions, but do not introduce a test framework.

## 2026-05-28 - Claude - Max-type entry helper extraction (Cluster C)

### Summary
- Extracted `maxTypeForEntry(entry, type)` from `index.html` into existing `js/domain/pokemonEntryRules.js` (commit `refactor: extract max type entry helper`) — it is an entry classifier and belongs with `uniqueEntries`/`costumeDedupeKey`/`isTradeableForWishlist`.
- Body copied byte-exact; exported via `window.PogoDomain.pokemonEntryRules` and rebound in `index.html`. All 7 callers (search-string max filter, Browse crown map/render, currentListEntries, maxMarkForEntry, combined/diff entry build, parseImportString) resolve the rebound name.
- `MAX_TYPE_SEARCH` (used by callers, not inside the function) intentionally left in `index.html`.

### Files touched
- `index.html`
- `js/domain/pokemonEntryRules.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- `node --check` (both files), `npm run check:domain` (13 new golden assertions), inline parse check, `git diff --check` all passed.
- Deployed Playwright smoke run against the live build: `14 passed, 0 failed, 0 skipped`; Browse + sprite-slot checks passed (this helper drives Browse crown icons + Dmax/Gmax search qualifiers).

### Known risks / TODOs
- Wide call surface (7 sites) — any future signature change ripples across search/render/import; keep it pure.

## 2026-05-28 - Claude - Sort-entries helper extraction (Cluster C)

### Summary
- Extracted `sortEntries(entries)` from `index.html` into `js/domain/priorities.js` (commit `refactor: extract sort entries helper`), co-located with `PRI_ORDER` so it references the module-local constant with no cross-module dependency.
- Body copied byte-exact; exported via `window.PogoDomain.priorities` and rebound in `index.html`. Both callers (in `renderBrowse`) resolve the rebound name.
- Sorts Browse trainer badges by priority (`H→M→L`, unknown last), then case-insensitive user, then mod.

### Files touched
- `index.html`
- `js/domain/priorities.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- `node --check` (both files), `npm run check:domain` (6 new golden order-tests incl. input-not-mutated), inline parse check, `git diff --check` all passed.
- Affects visible Browse badge ordering; deployed Playwright smoke is the rendering gate (run after deploy and confirm 14/14).

### Cluster C remaining (deferred — NOT yet extracted)
- `normalizeAcText` (autocomplete text normalization) — MEDIUM risk: autocomplete matching depends on its exact substitution chain (`pika→pikachu`, `gmax/dmax` expansions, `?/!` tokenization, accent strip) and the deployed smoke does NOT cover autocomplete, so it needs an exhaustive golden matrix and likely its own small module (e.g. `autocompleteText.js`). Pure, but do not rush.
- `scatterbugPatternLabel` (parses the pattern from a `Scatterbug (X)` label) — LOW risk but niche; feeds only the canvas image-export label and isn't smoke-covered. Best folded into a future export-helper module rather than moved alone.

## 2026-05-28 - Codex - Autocomplete text normalizer extraction

### Summary
- Extracted the pure `normalizeAcText(s)` helper from `index.html` into `js/domain/autocompleteText.js`.
- Body copied behavior-exact; exported via `window.PogoDomain.autocompleteText` and rebound to the same local name in `index.html`.
- Added golden checks for aliases, accents, punctuation, PhD collapsing, marker text, and existing falsy/non-string coercion behavior.

### Files touched
- `index.html`
- `js/domain/autocompleteText.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/domain/autocompleteText.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.

### Known risks / TODOs
- Autocomplete UI behavior is not directly covered by the deployed smoke suite; this extraction is protected by golden helper tests and script-load guards.
- Add an autocomplete-specific smoke test before changing scoring, rendering, or alias behavior.
