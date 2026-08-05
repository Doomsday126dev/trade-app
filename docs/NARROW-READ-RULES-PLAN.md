# Narrow Production Read Rules Candidate

> **Status:** Deployed and production-validated on 2026-08-05 at 10:05:15 EDT.
> This ruleset does not enable trainer-share visibility, synced preferences, or
> global identity writes.

## Candidate and rollback artifacts

- Candidate: `tests/firebase/database.rules.narrow-read.json`
- Candidate SHA-256: `e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf`
- Private rollback copy: verified local, mode `0600`, and git-ignored
- Rollback SHA-256:
  `bc54eec92875d1d544cc59b92c05b9dec2308340577bd66be22a032efa491926`

The rollback copy is byte-identical to the reviewed hardened fixture, parses as
JSON, is mode `0600`, and is git-ignored. Recalculate both hashes immediately
before any future publication.

## Authority model

The candidate replaces root `".read": "auth != null"` with root
`".read": false`. Access is granted only at registered paths:

- `loginDirectory` remains publicly enumerable for login and lightweight
  trainer-name suggestions.
- `publicShares/{username}` remains publicly readable by exact username. The
  `publicShares` parent remains non-enumerable.
- Signed-in users may read their exact profile and owned-list nodes only when
  `users/{username}/authUid` equals `auth.uid`.
- Signed-in users may read only `authIndex/{auth.uid}` and
  `userCommunities/{auth.uid}`.
- Protected Admin authority comes only from `admins/{auth.uid} === true`.
- Profile `isOwner`/`isAdmin`, username text, and community membership never
  grant access to another trainer's records.

All `.write` expressions are byte-for-byte equivalent after read rules are
removed from both the deployed hardened fixture and this candidate. Root
backup/restore writes remain denied.

## Registered read surfaces

The machine-readable contract is
`tests/firebase/narrow-read-surface-map.json`; the static checker requires an
exact match with all 34 entries in `firebaseReadRegistry`.

| Registry ID | Workflow | Path/query | Access | Candidate rule | Emulator coverage | State |
|---|---|---|---|---|---|---|
| `login_directory_live` | Login and Find Trainer suggestions | `loginDirectory` live | Anonymous | `loginDirectory/.read` | Anonymous directory and exact shares | Active |
| `users_live` | Admin users, audit, repair, backup | `users` live | Admin | `users/.read` | Protected Admin collections and revocation | Admin on demand |
| `auth_index_live` | Admin identity freshness | `authIndex` live | Admin | `authIndex/.read` | Protected Admin collections and revocation | Admin on demand |
| `requests_live` | Admin access requests | `requests` live | Admin | `requests/.read` | Protected Admin collections and revocation | Admin on demand |
| `communities_live` | Legacy community maintenance | `communities` live | Admin | `communities/.read` | Protected Admin collections and revocation | Admin on demand |
| `user_communities_live` | Legacy reverse-membership maintenance | `userCommunities` live | Admin | `userCommunities/.read` | Protected Admin collections and revocation | Admin on demand |
| `community_requests_live` | Legacy community requests | `communityRequests` live | Admin | `communityRequests/.read` | Protected Admin collections and revocation | Admin on demand |
| `wishlist_live` | Admin counts, maintenance, backup | `wishlist` live | Admin | `wishlist/.read` | Protected Admin collections and revocation | Admin on demand |
| `dynamax_live` | Admin maintenance and backup | `dynamax` live | Admin | `dynamax/.read` | Protected Admin collections and revocation | Admin on demand |
| `gmax_live` | Admin maintenance and backup | `gmax` live | Admin | `gmax/.read` | Protected Admin collections and revocation | Admin on demand |
| `costumes_live` | Admin maintenance and backup | `costumes` live | Admin | `costumes/.read` | Protected Admin collections and revocation | Admin on demand |
| `inventory_live` | Admin Legacy Inventory backup | `have` live | Admin | `have/.read` | Protected Admin collections and revocation | Admin on demand |
| `offers_live` | Legacy Offers backup compatibility | `offers` live | Admin | `offers/.read` | Protected Admin collections and revocation | Admin on demand |
| `trades_live` | Legacy Trades backup compatibility | `trades` live | Admin | `trades/.read` | Protected Admin collections and revocation | Admin on demand |
| `pending_decrements_live` | Own Inventory reconciliation queue | `pendingDecrements/{username}` live | Owner/Admin | `pendingDecrements/$username/.read` | Exact queue reads and writes | Active |
| `owned_profile_live` | Own profile and Settings | `users/{currentUsername}` live | Owner | `users/$username/.read` | Exact username-owned records | Active |
| `owned_wishlist_live` | My List wishlist | `wishlist/{currentUsername}` live | Owner | `wishlist/$username/.read` | Exact username-owned records | Active |
| `owned_dynamax_live` | My List Dynamax | `dynamax/{currentUsername}` live | Owner | `dynamax/$username/.read` | Exact username-owned records | Active |
| `owned_gmax_live` | My List Gigantamax | `gmax/{currentUsername}` live | Owner | `gmax/$username/.read` | Exact username-owned records | Active |
| `owned_costumes_live` | My List Others | `costumes/{currentUsername}` live | Owner | `costumes/$username/.read` | Exact username-owned records | Active |
| `owned_inventory_live` | Own Legacy Inventory/export | `have/{currentUsername}` live | Owner | `have/$username/.read` | Exact username-owned records | Active |
| `owned_auth_index_live` | Login identity freshness | `authIndex/{currentUid}` live | Owner | `authIndex/$uid/.read` | Exact UID and no enumeration | Active |
| `owned_memberships_live` | Own legacy membership state | `userCommunities/{currentUid}` live | Owner | `userCommunities/$uid/.read` | Exact membership, no list authority | Active |
| `public_share_read` | Initial selected/anonymous share | `publicShares/{username}` get | Anonymous | `publicShares/$username/.read` | Anonymous exact share/no parent | Active |
| `public_share_live` | Realtime selected/anonymous share | `publicShares/{username}` live | Anonymous | `publicShares/$username/.read` | Missing/incomplete/realtime compatibility | Active |
| `candidate_share_directory_read` | Future normalized lookup | `shareDirectory/{handle}` | Denied | None | Disabled future paths denied | Disabled |
| `candidate_share_mode_read` | Future visibility mode | `shareVisibility/{uid}/mode` | Denied | None | Disabled future paths denied | Disabled |
| `candidate_trainer_share_read` | Future UID share get | `trainerShares/{uid}` | Denied | None | Disabled future paths denied | Disabled |
| `candidate_trainer_share_live` | Future UID share live | `trainerShares/{uid}` | Denied | None | Disabled future paths denied | Disabled |
| `login_identity_reads` | Login/account binding | `users/{username}` + `authIndex/{uid}` | Owner/Admin | Exact user/index rules | Missing, spoofed, inconsistent bindings | Active |
| `admin_verification_reads` | Admin repair verification | Exact user + public directory | Admin | Exact user + directory rules | Admin collection access/revocation | Admin on demand |
| `community_verification_reads` | Community preparation verification | `communities/{id}` | Admin | `communities/.read` | Admin community access | Admin on demand |
| `health_check_read` | Public directory or own/Admin health | Directory or users | Public/Owner/Admin | Directory + exact/Admin users | Health access by audience | Active |
| `legacy_seed_probe` | Configured-owner legacy setup probe | `users` | Admin | `users/.read` | Protected Admin collections | Disabled legacy setup |

## Admin-wide path audit

Thirteen collection-wide reads remain, all gated by
`admins/{auth.uid} === true` and started only when protected Admin opens:

| Path | Current Admin consumer |
|---|---|
| `users` | User table, account maintenance, backup, login audit |
| `authIndex` | UID/username binding freshness audit |
| `requests` | Pending access requests |
| `communities` | Legacy community preparation and maintenance |
| `userCommunities` | Legacy reverse-membership maintenance |
| `communityRequests` | Legacy join-request maintenance |
| `wishlist`, `dynamax`, `gmax`, `costumes` | Counts, maintenance, and backup |
| `have` | Legacy Inventory maintenance and backup |
| `offers`, `trades` | Preserved legacy-data backup compatibility |

These listeners remain owned by the `legacyAdmin` lifecycle scope and must stop
when Admin closes, logout occurs, or Firebase auth is lost. Ordinary users have
neither parent nor query access to these paths.

## Community and retired-feature audit

Ordinary users retain only their exact `userCommunities/{uid}` record for
current account state. They cannot read `communities`, `communityRequests`,
another UID's memberships, or use membership as list authorization. Protected
Admin retains temporary on-demand community reads and existing maintenance
writes while archived community tooling remains available.

Old Browse, community-wide Strings, Community Inventory Browse, Trade Match,
Offers UI, personal Schedule, and member community switching receive no
ordinary collection reads. Their records are preserved. The Events view uses
an external HTTPS event feed and requires no RTDB permission.

## Denial and compatibility matrix

The emulator suite explicitly covers root, direct parent, shallow, ordered,
and limited-query denial; cross-owner exact denial; stale/spoofed/missing/case-
variant identity bindings; legacy role flags; Admin removal; memberships;
pending decrements; public share exact access without enumeration; disabled
visibility/preferences/global identity/group paths; and retained writes.

Write compatibility covers own profile/list/share writes, auth-index metadata
refresh, anonymous request creation, pending-decrement creation/consumption,
protected Admin community maintenance, and preserved Offers/Trades writes. It
also confirms foreign writes, privileged profile escalation, auth-index
reassignment, and root restore remain denied.

## Staged cutover and rollback

1. Run `npm run check:narrow-read-contract` and all existing static suites.
2. Run `npm run check:narrow-read-rules` in normal Terminal; require every test
   to pass with zero failures.
3. Read-only audit the active client registry and confirm no unregistered
   production read was added after this candidate hash was recorded.
4. Smoke the current deployed client while the existing hardened rules remain
   live.
5. Recopy the Console rules, verify the rollback hash, verify the candidate
   hash, compare the candidate to this plan, then publish the full candidate in
   Firebase Console as a rules-only change.
6. Immediately test anonymous directory/share, TestUser login and owned views,
   same-browser TestUser-to-owner isolation, Admin open/close/reopen, and final
   anonymous share access.
7. Record the Firebase rules version, publication timestamp, hashes, results,
   and any console errors in the maintenance log.

Rollback immediately for any permission regression in a critical active
screen, owner exact-read failure, Admin authority failure, anonymous directory
or share failure, unexpected cross-user access, or unregistered required read.
In Firebase Console, replace the complete editor contents with the verified
private rollback artifact, compare its SHA-256 to the value above, publish, and
repeat the minimal anonymous/login/Admin smoke. Target detection-to-rollback is
under 10 minutes; stop testing and restore immediately rather than debugging
against broken production rules.

Only after narrow rules have remained stable and private-path denial has been
verified may a separately approved milestone seed global identity, visibility,
or synced-preference records.
