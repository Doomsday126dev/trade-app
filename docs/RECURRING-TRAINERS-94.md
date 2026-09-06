# Recurring trainer wants (.94)

Starts from accepted .93. Groups/Favorites remain private organization, not shared
membership. The heading is now simply Groups, with the existing privacy label.
All Favorites is a read scope, not a synthetic stored group.

## Comparison contract

Select All Favorites or a group. Refresh permitted public wants; use All wants,
Top wants, New since last checked, or New Top wants. Every current variant retains
trainer attribution. Status shows first check, no changes, or updated with counts
of added wants and newly Top wants. Removed wants trigger Updated but are not
searchable. New scope includes additions and changed current declarations; Top
promotions are included. First checks are not misrepresented as entirely new lists.

Mark checked advances the exact displayed available trainer snapshots, either one
trainer or all available trainers. It acknowledges all their current wants, not
only the filtered search subset. Refresh and ordinary Favorite opening do not
advance baselines. Private/revoked/failed/expired reads cannot advance or expose
old wants. Current membership, target UID, session and render signatures fence
acknowledgement and copy. Stored history is never an authorization fallback.

## Existing storage reused

Uses the existing UID-partitioned trainerHistoryStore snapshots, not a new history
model or backend. Existing public-snapshot content and seenAt are reused; optional
targetUid metadata binds a baseline to the saved trainer. Unbound historical
snapshots are not compared against UID-bound Favorites. Favorite baselines can
survive outside the six recent trainers. Retention is bounded at 512 KiB per
snapshot and 2 MiB total, newest first, only Favorites and recents. Evicted or
oversized baselines produce first-check/no-comparison behavior, not invented deltas.
Quota failures are reported. Baselines are local to this device, not cloud synced.
Group membership keeps the already accepted preference persistence behavior.

## Publication age versus access

The .93 hard 30-day publication-age exclusion is retired. Currently accessible
public wants stay in search regardless of publication age; older/uncertain age is
flagged. The five-minute access-check boundary remains. Unavailable/private/revoked
projections never contribute, even if this device has an old history snapshot.
Queries reuse the existing localized serializer, splitting and manual verification.
No ownership or ability-to-trade claim is made.

## Boundaries and qualification

No new remote reads, synced history schema, backend, provider activation, identity,
PIN-reset, recovery66, Events or PR63 changes. Groups store references only; history
snapshots remain in the preexisting separate viewer-local history store.
Focused tests cover diff semantics, Top promotion, exact variants, older public
wants, first check, no changes, explicit acknowledgement, unavailable baseline
preservation, bounded retention, target/account binding, copy and responsive UI.

No demonstrated need for true shared groups yet. Cross-device history would be a
separate preference/history synchronization question, not justification for shared
group membership or another trainer's list ownership.
