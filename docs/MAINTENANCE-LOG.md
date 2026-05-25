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
