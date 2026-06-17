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

## 2026-05-28 - Codex - Autocomplete matching helper extraction

### Summary
- Extracted `AC_RESULT_LIMIT`, `acItemSearchText(e)`, and `acMatchScore(e, rawQuery)` from `index.html` into `js/domain/autocompleteMatching.js`.
- The new classic script depends on `js/domain/autocompleteText.js` and loads immediately after it; `index.html` rebinds the same local names so My List, special trade board, and Inventory autocomplete call sites remain unchanged.
- Added golden domain checks for result cap, normalized autocomplete search text, Unown punctuation aliases, pika alias behavior, dex matching, prefix/includes/token scoring, blank-query handling, and no-match behavior.

### Files touched
- `index.html`
- `js/domain/autocompleteMatching.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/domain/autocompleteMatching.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.

### Known risks / TODOs
- Autocomplete rendering and event handlers remain inline and are not covered by deployed smoke. Add focused autocomplete UI smoke before changing scoring behavior or result rendering.

## 2026-05-28 - Codex - Autocomplete ranking helper extraction

### Summary
- Extracted the repeated autocomplete ranking/filtering pipeline into `js/domain/autocompleteRanking.js`.
- New helpers: `autocompleteDexSortValue(e)`, `compareAutocompleteMatches(a,b,opts)`, and `rankAutocompleteItems(items,rawQuery,opts)`.
- `index.html` now keeps autocomplete builders/rendering/event handlers inline, while My List, special board, and Inventory autocomplete call sites use the shared ranking helper.

### Files touched
- `index.html`
- `js/domain/autocompleteRanking.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/domain/autocompleteRanking.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Deployed GitHub Pages smoke passed after the extraction: 18 passed.

### Known risks / TODOs
- Autocomplete rendering, item builders, and event handlers remain in `index.html`; do not move them without UI smoke/snapshot coverage.
- Special board autocomplete intentionally disables alpha tiebreaking so equal score/dex matches preserve insertion order.

## 2026-05-28 - Codex - String HTML helper extraction

### Summary
- Extracted the markup-only search-string length helpers `strLenHtml(str)` and `strWarnHtml(str)` from `index.html` into `js/ui/stringHtml.js`.
- Added the first `window.PogoUi` classic-script namespace module; it depends on `window.PogoDomain.searchStrings` for `strLenInfo` and `POGO_STR_LIMIT`.
- Added exact snapshot assertions for safe/warn/danger length metadata and warning banners, including the intentional blank class spacing in `class="str-meta "`.

### Files touched
- `index.html`
- `js/ui/stringHtml.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/ui/stringHtml.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Run deployed GitHub Pages smoke because this affects Strings-tab markup.

### Known risks / TODOs
- `strLevelsHtml`, render bodies, and the remaining badge/empty-state HTML helpers stay inline.
- Future UI helper extractions should add exact snapshot assertions before moving markup-sensitive helpers.

## 2026-05-29 - Codex - Badge HTML helper extraction

### Summary
- Extracted the markup-sensitive badge helpers `priBadge(p)` and `diffBadgeHtml(diff)` from `index.html` into `js/ui/badges.js`.
- The new `window.PogoUi.badges` module depends on `window.PogoDomain.priorities` and loads immediately after `js/domain/priorities.js`; `index.html` rebinds the same local helper names so existing render call sites remain unchanged.
- Added exact snapshot assertions for priority labels and string-diff badges, including the intentional real minus character `−` for removed counts.

### Files touched
- `index.html`
- `js/ui/badges.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/ui/badges.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Run deployed GitHub Pages smoke because this affects Strings-tab badge markup.

### Known risks / TODOs
- `emptyHtml`, `EMPTY_SVGS`, `userBadge`, `sparklineHtml`, and `eventBadgeForPokemon` remain inline.
- Continue requiring exact snapshot assertions before extracting additional markup helpers.

## 2026-05-29 - Claude - String panels HTML helper extraction

### Summary
- Extracted the markup-sensitive `strLevelsHtml(strs)` helper from `index.html` into a new `js/ui/stringPanels.js` (`window.PogoUi.stringPanels`).
- The function body was moved byte-exact (sliced, not re-indented) to preserve load-bearing whitespace inside its template literals; `diff` confirmed the moved body is byte-identical to the former inline definition.
- The module wires five dependencies at load with fail-fast guards: `PogoDomain.searchStrings` (`combinedStringOptions`), `PogoDomain.priorities` (`priLabel`), `PogoUi.badges` (`priBadge`), `PogoUi.stringHtml` (`strLenHtml`, `strWarnHtml`), and `PogoUtils.textSafety` (`escHtml`, `escAttr`). The script loads after all of those modules.
- `index.html` rebinds the same local `strLevelsHtml` name immediately after its dependency rebinds, so all three call sites (`renderMyStrings`, `_renderStringsInner`, `renderShareView`) are unchanged.
- The inline `onclick="copyStr(...)"` / `onclick="toggleComboStrings(this)"` handlers stay as string literals pointing at the still-inline globals.
- Added a `// --- stringPanels ---` golden block to `scripts/check-domain-helpers.js`: eight full-string snapshot assertions across priority mixes, Lucky/XXL/XXS flags, combined options, and HTML-escaping fixtures, plus two targeted escaping asserts.

### Files touched
- `index.html`
- `js/ui/stringPanels.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/ui/stringPanels.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Run deployed GitHub Pages smoke because this affects Strings-tab markup (and the public share view, which is not smoke-covered — golden snapshots are the primary guard there).

### Known risks / TODOs
- `renderShareView` (the public share page) is not covered by the deployed smoke; rely on the golden snapshots for that call site.
- `copyStr` and `toggleComboStrings` globals remain inline; `strLevelsHtml` emits them as string literals only.
- Render bodies and the remaining badge/empty-state HTML helpers stay inline.

## 2026-05-29 - Claude - Empty-state HTML helper extraction

### Summary
- Extracted the empty-state markup helper `emptyHtml(t,s='',icon='🔍')` and its `EMPTY_SVGS` icon map from `index.html` into a new `js/ui/emptyState.js` (`window.PogoUi.emptyState`). Both symbols were moved byte-exact.
- In the module, `EMPTY_SVGS` is now defined *before* `emptyHtml`, removing the former ~1,900-line forward reference in `index.html` (the inline `emptyHtml` at the old line 7135 read `EMPTY_SVGS`, which wasn't defined until ~9036). The defensive `typeof EMPTY_SVGS!=='undefined'` guard is intentionally preserved to keep output byte-identical.
- Deleted the dead `const _origEmptyHtml=…` line (and its "Override emptyHtml to use SVGs" comment) at the old line 9042: it was never referenced and `emptyHtml` was never reassigned, so the historical override had been folded into the live definition and abandoned.
- The module has **no dependencies** — no cross-module wiring. `index.html` rebinds `const {emptyHtml,EMPTY_SVGS}=emptyStateUi;` with a fail-fast guard near the other UI rebinds; all 9 `emptyHtml(...)` call-site lines (Browse, MyList, Strings, Inventory empty states) are unchanged.
- `emptyHtml` interpolates `t`/`s`/`icon` raw — no escaping is applied, and that behavior is preserved. Known icons render their inline `<svg>`; unknown icons fall back to `<div class="empty-i">icon</div>`.
- Added a `// --- emptyState ---` golden block to `scripts/check-domain-helpers.js`: full-string snapshots for the three known SVG icons (🔍/📋/⚙️), the unknown-icon fallback, with/without subtitle, and a raw/unescaped fixture, plus two targeted asserts confirming no HTML-escaping and raw fallback-icon rendering.

### Files touched
- `index.html`
- `js/ui/emptyState.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/ui/emptyState.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Run deployed GitHub Pages smoke because this affects empty-state markup across multiple tabs.

### Known risks / TODOs
- `EMPTY_SVGS` is rebound in `index.html` but currently has no consumer there other than `emptyHtml` (kept in the rebind per spec / to preserve the global name).
- Clean pure-logic helpers are nearly exhausted; remaining candidates (`entrySearchFilters`, `diffDetailsHtml`/`listSource`, large sprite/costume data tables) are smaller, impure, or guardrailed. Modularization should pause after at most one more small extraction.

## 2026-05-29 - Claude - Entry search filters extraction

### Summary
- Extracted `entrySearchFilters(entry,mod)` from `index.html` into the existing `js/domain/pokemonEntryRules.js` (`window.PogoDomain.pokemonEntryRules`), co-located with `maxTypeForEntry` which it already depended on. Body is functionally identical (pure logic returning an array — re-indented to module style, no template literals, so output is whitespace-independent).
- Co-moved the `MAX_TYPE_SEARCH` map (`{dynamax:'dynamax',gmax:'gigantamax'}`) into the same module because `entrySearchFilters` consumes it. It is exported and rebound in `index.html` under the same local name, so the other consumer (the import-parsing `maxType` filter near the bottom of the inline script) still resolves it unchanged.
- This introduces the **first cross-module dependency** for `pokemonEntryRules`: it now wires `window.PogoDomain.pokemonSearchTerms` at load (fail-fast guard) to destructure `modSearchFilters`, `castformTypeFilter`, `formVariantFilter`. Load order is safe — `pokemonSearchTerms.js` loads immediately before `pokemonEntryRules.js` — and there is **no circular dependency** (`pokemonSearchTerms` never references `pokemonEntryRules`).
- Output and ordering preserved exactly: mod filters first, max-type `unshift` to the front, castform `unshift` to the front, form-variant `push` to the end (the form-variant branch currently adds nothing since no form cases are enabled). The single caller (the search-string item builder) is unchanged.
- Added a golden block to `scripts/check-domain-helpers.js` (under the existing `// --- pokemonEntryRules ---` section): the `MAX_TYPE_SEARCH` map, plain/mod-only/dynamax/gmax/castform/form-variant cases, an explicit ordering snapshot (`['ice','dynamax','shiny','xxl']`), and an empty-entry case.

### Files touched
- `index.html`
- `js/domain/pokemonEntryRules.js`
- `scripts/check-domain-helpers.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- Run `node --check js/domain/pokemonEntryRules.js`.
- Run `node --check scripts/check-domain-helpers.js`.
- Run `npm run check:domain`.
- Run the inline `index.html` parse check.
- Run `git diff --check`.
- Run deployed GitHub Pages smoke because this feeds Strings-tab search-string generation.

### Known risks / TODOs
- `pokemonEntryRules` now depends on `pokemonSearchTerms`; any future re-ordering of the module `<script>` tags must keep `pokemonSearchTerms.js` loading first.
- This is the planned final small modularization pass — remaining candidates are tiny, impure (`diffDetailsHtml`/`listSource`), or guardrailed data tables. Pause and reassess before further extraction.

## 2026-05-29 - Codex - Backup/restore safety hardening

### Summary
- Added function-level admin guards to `exportData()`, `triggerRestore()`, and `restoreData(file)` so direct console calls by non-admin users return before local mutation or Firebase restore attempts.
- `restoreData(file)` now validates the parsed backup before `saveLocal(data)` or `allData=data`: the payload must be a plain object, include the required top-level sections, and contain at least one user.
- Strengthened the restore confirmation copy to make clear that restore replaces local app data and may attempt a full Firebase sync.
- Reset the hidden restore file input before opening and after restore/cancel/error paths so selecting the same backup file again still fires the `change` event.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase paths or security rules changed.
- Root Firebase restore remains best-effort/admin-only. Current rules may block `set(ref(db,'/'),data)`, preserving the existing “restored locally, Firebase sync was blocked by rules” path.

### Manual test checklist
- Admin export still downloads the same backup JSON format and updates the backup reminder.
- Admin restore with invalid JSON, missing required sections, or zero users fails before local state mutation.
- Admin restore cancel leaves local data unchanged and allows selecting the same file again.
- Non-admin console calls to `exportData()`, `triggerRestore()`, and `restoreData(file)` show an admin-only message and do not mutate local state or attempt Firebase writes.

### Known risks / TODOs
- Full root restore is still a blunt recovery tool. A future safer restore flow should restore selected sections or use a server-side/admin-only tool instead of attempting a root client write.

## 2026-05-29 - Codex - Login Health Check support report

### Summary
- Added a "Copy report" action to the existing Login Health Check modal. The copied text is designed for Discord/DM support debugging and uses only explicit allowlisted fields.
- The support report intentionally avoids serializing app state, Firebase snapshots, localStorage contents, user records, auth identifiers, Pokémon lists, offers, friend codes, Discord IDs, PINs, or raw private paths.
- Added copy success/failure feedback in the Health Check modal and reused the existing clipboard helper/fallback path.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase paths or security rules changed.

### Manual test checklist
- Logged-out Health Check copy includes only app/build/connectivity/cache/auth-status-category details and no PIN, UID, email, friend code, Discord ID, Pokémon list, offer, or Firebase token data.
- Logged-in Health Check copy includes only the same allowlisted diagnostics; auth is reported as a category only, never a raw UID or email.
- Copy feedback appears after success or failure.

### Known risks / TODOs
- Keep future support-report fields allowlist-only. If a diagnostic value might reveal app data or identity data, leave it out unless there is an explicit privacy review.

## 2026-05-29 - Codex - Owner-only non-NYC community preparation

### Summary
- Added an owner-only admin maintenance tool to prepare a non-NYC community record ahead of future multi-community work.
- The tool validates lowercase path-safe community IDs, rejects `nyc`, and writes only the community metadata plus owner member/admin/reverse-index entries.
- `MULTI_COMMUNITY_ENABLED` remains `false`; normal users still see the current NYC/global behavior and no public community switcher or join flow was added.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- New owner-only preparation can write:
  - `communities/{communityId}`
  - `userCommunities/{ownerUid}/{communityId}`
- No Firebase rules changed. Current owner-only community rules must still be present in production before using the tool.

### Manual test checklist
- Owner can prepare a lowercase non-NYC community ID such as `chicago-go-fest`.
- Invalid IDs are rejected before any Firebase write attempt: blank, `nyc`, uppercase, underscores, and `. # $ [ ] /`.
- Re-running the same community preparation updates metadata and preserves owner membership/admin indexes.
- Normal Browse, Strings, Inventory, Schedule, requests, offers, and login behavior remain unchanged while `MULTI_COMMUNITY_ENABLED=false`.

### Known risks / TODOs
- This is metadata/owner-prep only. Member assignment, public switching, request/join flows, and per-community offers/schedule scoping remain deferred.

## 2026-05-29 - Codex - Owner-only non-NYC member assignment

### Summary
- Added owner-only maintenance UI for assigning or removing existing users from already prepared non-NYC communities.
- The tool remains private while `MULTI_COMMUNITY_ENABLED=false`; normal users still see current NYC/global behavior and no public community switcher, join flow, or request flow was added.
- Assignment/removal is member-only, rejects `nyc`, rejects unprepared community IDs, rejects unknown usernames, and refuses to remove a community owner.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- Assignment can write:
  - `communities/{communityId}/memberUsernames/{username}`
  - `communities/{communityId}/members/{uid}` when the user has `authUid`
  - `userCommunities/{uid}/{communityId}` when the user has `authUid`
  - `communities/{communityId}/updatedAt`
- Removal can delete the corresponding membership/reverse-index paths and any stale `communities/{communityId}/admins/{uid}` entry for that user, then updates `communities/{communityId}/updatedAt`.
- Username-only users are indexed by `memberUsernames` only; no fake UID paths are written.
- No Firebase rules changed.

### Manual test checklist
- Owner can select a prepared non-NYC community, add an existing auth-linked user, and see membership/reverse-index paths created.
- Owner can add a username-only existing user and see only the username index plus `updatedAt` written.
- Owner can remove a non-owner member from a prepared non-NYC community and see membership/reverse-index paths deleted.
- Attempts to remove from `nyc`, remove a community owner, assign to an unprepared/missing community, or assign an unknown username are rejected before writes.
- Browse, Strings, Inventory, Schedule, requests, offers, login, and NYC preparation/preview behavior remain unchanged while `MULTI_COMMUNITY_ENABLED=false`.

### Known risks / TODOs
- This is owner-only setup tooling. Public community switching, user-facing join/request flows, per-community roles beyond owner/member, and per-community offers/schedule behavior remain deferred.

## 2026-05-30 - Codex - Owner-only community preview switcher

### Summary
- Added an owner-only preview community selector in the existing community maintenance panel. The selection is stored in localStorage only and is separate from the future public selected-community state.
- Owner preview can now scope already-previewed read surfaces to a prepared community's `memberUsernames`, including non-NYC communities. This changes visible trainer sets for the owner preview only; normal users remain on current NYC/global behavior while `MULTI_COMMUNITY_ENABLED=false`.
- Reaffirmed the data-model invariant that Pokémon wishlist, Dynamax, Gigantamax, costume, inventory, and profile data remain user-global. Community preview filters users, not Pokémon records.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase writes, paths, or security rules changed.
- Preview selection uses localStorage key `pogoOwnerCommunityPreviewCommunity_v1` only.

### Manual test checklist
- Owner can choose NYC or another prepared community in the owner maintenance panel and enable community preview.
- Browse, Strings/Compare/Trade Match, Inventory Community Browse, Offers read views, and Schedule preview surfaces show only trainers allowed by the selected prepared community.
- Normal users and admins without owner privileges do not see the owner preview controls.
- Changing the preview community does not write Firebase and does not create, move, copy, or delete any Pokémon data.

### Known risks / TODOs
- This is still owner-only preview tooling, not a public switcher. Public member-facing community switching, join/request flows, and per-community offers/schedule write semantics remain deferred.

## 2026-05-30 - Codex - Owner preview label polish

### Summary
- Clarified the owner-only community preview controls so the community selector reads as a preview target and the checkbox reads as the action that enables preview mode.

### Files touched
- `index.html`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase paths or security rules changed.

### Manual test checklist
- Owner maintenance panel labels are clear: select the preview community, then enable owner preview.
- Normal users still do not see owner preview controls.

### Known risks / TODOs
- Copy-only polish; public community switching remains deferred.

## 2026-05-30 - Codex - Flagged member community switcher

### Summary
- Added a member-facing community selector shell behind `MULTI_COMMUNITY_ENABLED=false`. It is hidden in current production behavior and uses the future public selected-community key `pogoSelectedCommunityId_v1`.
- The selector lists only communities the signed-in user belongs to, preferring `userCommunities/{uid}` and falling back to `communities/{communityId}/memberUsernames/{username}`.
- Owner preview remains separate on `pogoOwnerCommunityPreviewCommunity_v1`, and Pokémon wishlist/inventory/profile data remains user-global.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase writes, paths, or security rules changed.
- Public member selection is localStorage-only while the feature flag is off.

### Manual test checklist
- With `MULTI_COMMUNITY_ENABLED=false`, normal users do not see the member community selector and existing behavior is unchanged.
- In a future flagged sandbox, multi-community members can select only communities they belong to; invalid selections fall back to NYC.
- Selecting a community changes visible member filtering only and does not create, move, copy, or delete Pokémon list/inventory data.

### Known risks / TODOs
- Public multi-community switching remains disabled. A future launch still needs explicit flag enablement, deployed smoke, and manual QA across Browse, Strings/Compare/Trade Match, Inventory Community Browse, Offers read views, and Schedule read views.

## 2026-05-30 - Codex - Flagged public community read scoping

### Summary
- Added shared read-scope helpers so owner preview remains the highest-priority community filter, and future public selected-community membership can scope read surfaces only when `MULTI_COMMUNITY_ENABLED=true`.
- Wired Browse, Strings/Compare/Trade Match, Inventory Community Browse, and Schedule read/partner views through the shared read scope. With the flag still disabled, current production behavior remains global/NYC as before.
- Pokémon wishlist, Dynamax, Gigantamax, costume, inventory, and profile data remain user-global. Community scoping filters visible users/member sets only.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- No Firebase writes, paths, or security rules changed.
- Owner preview still uses `pogoOwnerCommunityPreviewCommunity_v1`; future public member selection still uses `pogoSelectedCommunityId_v1`.

### Manual test checklist
- With `MULTI_COMMUNITY_ENABLED=false`, normal users see no community read-scope behavior change.
- Owner preview still takes precedence over the public selected-community localStorage key.
- In a future flagged sandbox, Browse, Strings/Compare/Trade Match, Inventory Community Browse, and Schedule read views filter to selected community members without moving or copying Pokémon data.

### Known risks / TODOs
- Public flag enablement remains deferred. Offer read/write semantics, offer creation/submission, schedule write payloads, public join/request flows, and Firebase rules are intentionally unchanged in this step.

## 2026-05-30 - Claude - Offer read-scope parity + schedule communityId stamping

### Summary
- Replaced the offer visibility helper `ownerPreviewAllowsOffer(offer,recipient)` with `offerInReadScope(offer,recipient)`. The new helper routes through the shared `readScopeMemberUsernames()` so it covers (a) owner preview, (b) the future flag-on public-selected-community mode, and (c) the current flag-off global behavior (short-circuits to "allow all" when no read scope is active). Mirrors `schedulePreviewAllowsTrade`'s structure: when a scope is active, it compares `recordCommunityId(offer)` against owner preview's community id (if active) or `getCurrentCommunityId()` (otherwise) and rejects mismatched offers; missing `offer.communityId` continues to default to `DEFAULT_COMMUNITY_ID` via `recordCommunityId`.
- Migrated all three callers to the new name without changing call shape: `openIncomingOffersModal` body, `offersForItem`, and `totalOffersForRecipient`. Deleted the now-unused `ownerPreviewAllowsOffer` definition (verified `grep` reports zero occurrences post-edit).
- Stamped `communityId` on every newly created scheduled-trade record:
  - `submitScheduledTrade`: added `communityId: existing?.communityId || getCurrentCommunityId()` to the trade object literal. New records get the user's current community; edits preserve any explicit `communityId` already on the record; legacy edits without `communityId` fall back to `getCurrentCommunityId()` (which resolves to `'nyc'` under flag-off, matching legacy behavior).
  - `_logAcceptedTrade` (auto-logged reservations from offer-accept): added `communityId: getCurrentCommunityId()` to the trade object literal. Always a new record at this site, so unconditional stamp.
- `writeTrade`, `cancelScheduledTrade`, and the complete/cancel write paths are untouched; they continue to use `{...t, …}` spread so `communityId` is preserved through cancel/complete by the existing code.

### Files touched
- `index.html`
- `scripts/check-community-membership.js`
- `docs/MAINTENANCE-LOG.md`

### Verification
- `node --check scripts/check-community-membership.js` → OK.
- `npm run check:community` → "Community membership indexing checks passed."
- `npm run check:domain` → "Domain helper checks passed."
- Inline `index.html` parse check → 2 scripts, 0 failed.
- `git diff --check` → no whitespace errors.
- Deployed GitHub Pages smoke required after commit/push/Pages rebuild because `index.html` changed (offer read filtering + schedule write objects).

### Known risks / TODOs
- `MULTI_COMMUNITY_ENABLED=false` and `DEFAULT_COMMUNITY_ID='nyc'` remain unchanged. With the flag off, `readScopeMemberUsernames()` returns null and `offerInReadScope` short-circuits to "allow all", so end-user behavior is unchanged. New trade records now explicitly carry `communityId:'nyc'`, which is intentional and backward-compatible with `recordCommunityId`'s default.
- Firebase rules, auth (PIN / Google sign-in), request/join flow, public flag enablement, and the Pokémon data model remain deferred. UI read filtering is still not security at the rules layer; any public launch needs a rules/security review.
- Old trade records without `communityId` continue to resolve to `'nyc'` at read time via `recordCommunityId`; no migration write was issued.
- The 100/day trade quota is intentionally still global (per real account), not per-community.

## 2026-05-30 - Claude - Google auth design plan (docs-only)

Added `docs/AUTH-PLAN.md` capturing the Phase 0 design plan for adding Google sign-in / stronger auth: current model snapshot, identity invariants, a five-phase roadmap (Phase 0 docs → Phase 1 owner-only prototype behind a disabled `GOOGLE_AUTH_ENABLED` flag → Phase 2 self-service linking → Phase 3 Google onboarding → optional Phase 4 PIN sunset → optional Phase 5 Firebase Emulator Suite), rejected approaches, and deferrals. The plan is the living-doc artifact future auth commits will be checked against. No app code, test code, Firebase rules, login behavior, approval flow, repair flow, PIN handling, data paths, or feature flags were changed by this commit.

## 2026-05-30 - Claude - Trusted multi-community pilot rollout checklist (docs-only)

Added `docs/PILOT-ROLLOUT.md` as the operator runbook for the trusted multi-community pilot: pilot scope and trust assumption, known constraints and gaps (notably the owner-only-approvals constraint stemming from `createMemberNow`'s `ownerCanUseCommunityTools()` gate on NYC default enrollment), pre-flight and manual-QA checklists for NYC + New Jersey, the future flag-flip and rollback procedures, live-pilot monitoring guidance, a post-pilot review template, and explicit deferrals. The runbook does not flip the flag and does not change any app code, tests, or Firebase rules.

## 2026-05-30 - Claude - Pilot rollout owner-only approval clarification (docs-only)

Bumped `docs/PILOT-ROLLOUT.md` to v2 to clarify the owner-only approvals constraint. The previous v1 wording implied a future "one-line client fix" would suffice to let non-owner admins enroll new users into NYC default community membership; that wording was incorrect. The client-side `ownerCanUseCommunityTools()` gate inside `createMemberNow` mirrors the current Firebase rules, which restrict `communities/`, `userCommunities/`, and `communityRequests/` writes to the owner. Because `createMemberNow` submits its approval as a single atomic `update(ref(db), updates)` batch, dropping the client gate alone would cause Firebase to atomically reject the entire batch and the new user would not be created — a regression, not a fix. The runbook now states the future alternative explicitly as a coordinated rules + client change scoped to NYC default-only (ideally with add-only `!data.exists()` constraints), deferred to the public-launch rules-tightening track. The pilot continues to assume owner-only approvals. No app code, test code, Firebase rules, login behavior, approval flow, or runtime behavior was changed by this commit.

## 2026-05-30 - Claude - Trusted multi-community pilot is live (docs-only record)

Bumped `docs/PILOT-ROLLOUT.md` to v3 to record that the trusted multi-community pilot is now live in production. Flag-flip commit `6f22668` flipped `MULTI_COMMUNITY_ENABLED` from `false` to `true` at `index.html:2431` and updated the matching source-invariant guard in `scripts/check-community-membership.js`; pre-flip baseline SHA `06c8b52` is recorded as the rollback target. Deployed verification confirmed the production build serves `MULTI_COMMUNITY_ENABLED=true` (1 occurrence) with no `=false` literal remaining (0 occurrences) and `DEFAULT_COMMUNITY_ID='nyc'` unchanged. Deployed smoke passed 18/18 (desktop + mobile chromium, 2 workers) against the post-flip build. Owner-led manual QA against the live production app passed every item: owner preview works and takes precedence over the public top Community dropdown; a non-owner member belonging to both NYC and New Jersey can use the top dropdown normally; NYC/NJ scoping works on Browse, Strings/Compare/Trade Match, Inventory Community Browse, and Schedule; a new NJ scheduled trade stamps `communityId:'new-jersey'`; switching back to NYC hides the NJ-only trade; legacy missing-`communityId` records resolve to NYC; no Pokémon data is moved or duplicated under communities; owner-only approvals remain the pilot operating process. This docs update touches `docs/PILOT-ROLLOUT.md` and `docs/MAINTENANCE-LOG.md` only — no app code, no test code, no Firebase rules, no `index.html`, no login/approval/repair/PIN/offer/schedule/data-path code, no auth flow, no package scripts, no Playwright tests, and no modularized helpers were changed.

## 2026-05-30 - Claude - Pilot monitoring & incident runbook (docs-only)

Added `docs/PILOT-MONITORING.md` as the day-to-day operational companion to `docs/PILOT-ROLLOUT.md`. The new doc captures the daily-check ritual, a Sev-1/Sev-2/Sev-3 severity classification for incoming pilot reports, data-path investigation recipes for visibility complaints (with DevTools-runnable snippets against `allData.communities`, `allData.userCommunities`, `allData.offers`, and `allData.trades`), a symptom playbook for the most likely reports (blank app, missing peers, missing scheduled trades, missing NYC enrollment for newly approved users, cross-community visibility), explicit rollback decision criteria, a high-level rollback procedure that defers to `PILOT-ROLLOUT.md` § "Rollback procedure" for detailed steps (referencing flag-flip commit `6f22668` and pre-flip baseline SHA `06c8b52`), and a standing reminder that current Firebase reads remain broad (`.read: auth != null`) and UI filtering is not security. A short cross-reference paragraph was added to `docs/PILOT-ROLLOUT.md` § "Live-pilot monitoring" pointing at the new file. No app code, no test code, no Firebase rules, no `index.html`, no login/approval/repair/PIN/offer/schedule/data-path code, no `MULTI_COMMUNITY_ENABLED` flag value (`true`), no `DEFAULT_COMMUNITY_ID` value (`'nyc'`), no package scripts, no Playwright tests, and no modularized helpers were changed by this commit.

## 2026-05-30 - Claude - Owner-selected onboarding community (Phase 1)

Added an owner-only community-target picker to the new-user approval flow so the owner can choose at approval time whether a brand-new pilot user is enrolled into NYC only, New Jersey only, or NYC + New Jersey. Default selection is "NYC only" so the single-click approval rhythm is preserved. Implementation: a new pure helper `targetedCommunityMembershipUpdates(username, userRecord, communityIds, joinedAt)` returns `{ok, error, updates}` for any combination of NYC and prepared non-default communities (NYC always allowed; non-default ids validated via `validatePreparedNonDefaultCommunityId`); a matching local-cache mirror `applyTargetedCommunityMembershipLocal` keeps the in-memory store consistent with the Firebase write; `createMemberNow` now accepts an optional fifth `opts={}` parameter and consults `opts.communityIds` — when absent it falls back to today's behavior (owner approvals default to NYC, non-owner admin approvals skip community writes, matching the rules-gated reality); post-write verification loops over every selected community and throws the same `db/write-rejected-silently` if any membership index did not land; `approveRequest` reads the comma-separated picker value from `#approve-community-${reqId}` and forwards it via `opts.communityIds`; `renderPendingRequests` renders the picker only when `ownerCanUseCommunityTools()` is true AND at least one prepared non-default community exists, with NYC-only selected by default and prepared non-default communities surfacing both "{name} only" and "NYC + {name}" options. Existing `defaultCommunityMembershipUpdates`, `applyDefaultCommunityMembershipLocal`, `repairMemberAccount`, `buildNonDefaultCommunityMemberAssignment`, and `buildNonDefaultCommunityMemberRemoval` are unchanged; the "Add member directly" admin form (`addMemberNow`) is unchanged and still uses today's NYC-only default. Added 14 new sandbox assertions in `scripts/check-community-membership.js` covering key-set equivalence with the default helper for NYC-only, no-NYC-paths invariant for NJ-only, NYC+NJ union, username-only user shape, unprepared/invalid/empty/undefined-communityIds rejection with no partial writes, and duplicate-id dedupe; updated three pre-existing source-wiring guards to reference the new function names and the new verification flag. No Firebase rules changed; no auth, PIN provisioning, loginDirectory shape, repair flow, offer/schedule/inventory/list writes, Pokémon data paths, owner-preview behavior, or public request form changed. `MULTI_COMMUNITY_ENABLED=true` and `DEFAULT_COMMUNITY_ID='nyc'` are unchanged. Deployed smoke required after commit/push/Pages rebuild because `index.html` behavior/UI changed.

## 2026-06-15 - Codex - Public live share links

### Summary
- Added a sanitized `publicShares/{username}` snapshot so anyone with a share link can view the trainer's shared trade list without an app login once Firebase rules are updated.
- Copying a share link publishes the current public snapshot immediately; profile/list edits queue a refreshed snapshot so public links stay current.
- Share view now prefers the realtime `publicShares/{username}` listener and only falls back to protected raw app paths for signed-in viewers when an old/unpublished public snapshot is missing.

### Files touched
- `index.html`
- `SECURITY-RULES.md`
- `docs/MAINTENANCE-LOG.md`

### Firebase paths / rules
- Added a documented rules-template path for `publicShares/{username}` with public read and owner/admin write.
- Raw app data remains protected. The public snapshot is allowlist-only and contains the share-view profile fields plus `wishlist`, `dynamax`, `gmax`, and `costumes`; it does not include PINs, Auth UIDs/emails, Discord IDs, inventory, offers, trades, requests, or private app state.

### Manual test checklist
- Publish the updated Firebase rules template, then copy a share link while signed in as the trainer.
- Open the link in a clean signed-out/private browser; it should show the public share view without app login.
- While the share view is open, edit the shared trainer's list from another signed-in session; the share view should update from `publicShares/{username}`.
- Confirm the public snapshot contains only the allowlisted share data and no inventory/offers/trades/PIN/Auth fields.

### Known risks / TODOs
- Production Firebase rules must be updated before anonymous viewers can read `publicShares/{username}`.

## 2026-06-16 - Codex - Dynamax Electabuzz and special board export sprite fallback

Added Electabuzz to the static Dynamax catalog with no trainer data so it is available in the Dmax list without changing anyone's saved priorities. Audited the current Dmax/Gmax catalog through the app's sprite resolver; all existing Dmax/Gmax entries have sprite fallback chains. Tightened canvas export fallbacks so custom cdn08 costume sprites, such as Armored Mewtwo on the Special Trade Board, try the proxied and direct costume image instead of falling through to regular base-dex art. No auth, Firebase rules, community logic, offers, schedule, inventory writes, public-share rules, or data model shape changed.

## 2026-06-17 - Codex - Strings diff details "See all"

Improved the Strings tab change-diff details so truncated trainer diffs now show a "See all changes" action with the complete added/removed/changed list for the current render. Changed entries now include a compact before → after priority/flag summary, making `~ changed` rows less opaque. The existing local snapshot key and mark-seen behavior are unchanged; this is a UI-only diff-detail improvement with no Firebase rules, auth, list writes, inventory, offers, schedule, import/export, community scoping, or data model changes.
