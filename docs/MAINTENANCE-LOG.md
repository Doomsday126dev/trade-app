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
