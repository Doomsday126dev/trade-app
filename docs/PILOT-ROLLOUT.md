# Trusted Multi-Community Pilot — Rollout Checklist

> **Maintenance convention**: This is a living plan. Anyone executing
> or revising the pilot should update the relevant section before
> shipping, and append a new row to the Update log at the bottom.
> Format mirrors `SCALING-NOTES.md`, `SECURITY-RULES.md`, and
> `AUTH-PLAN.md`: status banner at top, history-preserving update log
> at the bottom so future contributors (Claude / Codex / human) can
> reconstruct what changed when.

---

## Current status

| Item | Status |
|---|---|
| Document version | **v1** — initial trusted multi-community pilot rollout checklist captured |
| Pilot status | **not started** |
| App flag | `MULTI_COMMUNITY_ENABLED=false` |
| Pilot communities | NYC (default) + New Jersey (prepared) |
| Pilot operator | owner |
| Rollback path | revert the flag-flip commit and redeploy |

This document is the operator runbook the owner walks through before
flipping `MULTI_COMMUNITY_ENABLED` to `true` for the trusted pilot.
The doc landing does not flip the flag, change any app code, change
any tests, or change Firebase rules.

---

## Pilot scope and trust assumption

- **Pilot is limited to a few dozen invited users known to the
  owner.** All pilot users have been told personally what to expect.
- **Owner is the sole operator and approver during the pilot** unless
  a future one-line fix to `createMemberNow` (see § Known constraints
  and gaps) is shipped first.
- **Current Firebase rules allow any signed-in user to read broad app
  data.** Specifically, `".read": "auth != null"` at the root of the
  canonical ruleset means every authenticated user can read every
  subtree (wishlist, have, offers, trades, communities, etc.).
- **UI filtering is not security.** All read-scope work to date —
  Browse, Strings/Compare/Trade Match, Inventory Community Browse,
  Schedule views, and offer read filtering via `offerInReadScope` —
  scopes what the UI shows, not what the database returns to a
  determined user with DevTools.
- **This trust assumption is acceptable only for a trusted pilot, not
  for public launch.** Pilot users have been informed that other
  pilot members can technically read their data, in exchange for the
  community filtering convenience.
- **Reference**: see `SECURITY-RULES.md` for the canonical ruleset
  and the deferred rule-tightening plan. Public launch will require
  per-subtree read narrowing and write-time community-membership
  preconditions before it can be considered.

---

## Known constraints and gaps

### Owner-only approvals during pilot

- `createMemberNow` writes the default NYC community membership
  indexes only when `ownerCanUseCommunityTools()` is true (see
  `index.html` around the `shouldWriteDefaultCommunity` block in the
  function body).
- `ownerCanUseCommunityTools()` requires `cur===OWNER` or
  `allData.users?.[cur]?.isOwner`. **A non-owner admin who approves a
  request leaves the new user with no community membership.** Under
  `MULTI_COMMUNITY_ENABLED=false` this is harmless. Under flag-on,
  the new user's `memberCommunityOptions()` would be empty, their
  switcher would not render, and read surfaces would be empty.
- **Acceptable mitigations:**
  1. **Owner handles all approvals during the pilot.** This runbook
     assumes this mitigation unless option 2 is shipped first.
  2. **Future one-line fix:** drop the `ownerCanUseCommunityTools()`
     gate on the NYC default enrollment block in `createMemberNow`,
     so every newly approved user is auto-enrolled in NYC regardless
     of which admin approved them. NYC is the default; this is the
     right long-term behavior. This fix is intentionally out of
     scope for this docs commit (see § Deferrals).

### Other known constraints

- **100/day trade quota remains global per real account, not per
  community.** A pilot user scheduling trades across both NYC and NJ
  shares the same quota; the counter card shows the global figure.
  Pilot volumes are not expected to reach the quota; document and
  accept.
- **`loginDirectory` remains public-readable** at the rules layer.
  Usernames are enumerable by any authenticated user. Acceptable for
  closed pilot; would be reconsidered before public launch.
- **No flag-on Playwright browser smoke yet.** Flag-on logic is
  covered by `scripts/check-community-membership.js` at the
  function/sandbox level. Browser-level flag-on coverage is a
  pre-public-launch milestone, not a pilot blocker.
- **Current rules are acceptable only under the trusted-pilot
  assumption.** Any widening (more users, public requests,
  unsupervised invites) requires rule tightening first.

---

## Pre-flight checklist

All items must be confirmed in order before flipping
`MULTI_COMMUNITY_ENABLED` to `true` in production.

- [ ] Working tree clean (`git status --porcelain` empty).
- [ ] HEAD matches upstream (`git rev-parse HEAD` equals
      `git rev-parse @{u}`).
- [ ] `npm run check:community` → "Community membership indexing
      checks passed."
- [ ] `npm run check:domain` → "Domain helper checks passed."
- [ ] Latest deployed smoke is 18/18 against current HEAD
      (`PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`).
- [ ] `MULTI_COMMUNITY_ENABLED=false` is still the literal in
      `index.html` immediately before the flag flip.
- [ ] New Jersey community has been prepared in production via the
      owner-only community prep tool. `communities/new-jersey/preparedAt`
      exists.
- [ ] At least two users have been assigned to New Jersey via the
      owner-only assignment tool, including the owner.
      `communities/new-jersey/memberUsernames/{u}`,
      `communities/new-jersey/members/{uid}`, and
      `userCommunities/{uid}/new-jersey` all exist for each assigned
      user.
- [ ] Owner preview NYC and New Jersey have been verified manually:
      switching the owner preview narrows Browse, Strings, Inventory,
      Schedule, and incoming-offer panes to the selected community's
      members, with no flag flip required.
- [ ] Rollback commit/SHA recorded before the flag-flip commit. This
      is the SHA of the immediately-prior commit, the one that
      represents the known-good `MULTI_COMMUNITY_ENABLED=false`
      state.

---

## Manual QA before flipping production

Walk through each of these in a controlled environment (local
file:// build or fixture with the flag manually flipped for one
browser session). Mark pass/fail before committing the production
flag flip.

- [ ] **Owner can preview NYC and New Jersey** — the owner preview
      switcher toggles between the two prepared communities and the
      banners update on Browse, Strings, Inventory, and Schedule.
- [ ] **Browse scopes correctly** — with the flag on locally and
      "new-jersey" selected, Browse lists only New Jersey members'
      entries.
- [ ] **Strings / Compare / Trade Match scope correctly** — Strings
      tab lists only New Jersey members' strings; Compare and Trade
      Match modals refuse to open against a non-New Jersey trainer
      with a clear toast.
- [ ] **Inventory Community Browse scopes correctly** — only New
      Jersey members' inventories appear.
- [ ] **Offers read views scope correctly** — incoming offers modal,
      per-item offer lists, and offer-count badges all hide offers
      whose `communityId` does not match the selected community.
      Legacy missing-`communityId` offers default to NYC and are
      hidden under New Jersey selection.
- [ ] **Schedule views / partner picker scope correctly** — Schedule
      tab shows only New Jersey trades; the schedule modal's partner
      picker offers only New Jersey members; cross-community partner
      selection toasts the friendly "outside community" error.
- [ ] **New scheduled trades stamp the selected community in the
      local/manual flag-on rehearsal.** Creating a new scheduled
      trade while "new-jersey" is selected writes a record with
      `communityId: 'new-jersey'`. Verify via DevTools.
- [ ] **Offer accept auto-log stamps the selected community in the
      local/manual flag-on rehearsal.** Accepting an incoming offer
      while "new-jersey" is selected writes the `accept_…` trade
      record with `communityId: 'new-jersey'`. Verify via DevTools.
- [ ] **Legacy missing `communityId` records resolve to NYC.** Pull
      an older offer or trade with no `communityId` field; confirm
      `recordCommunityId({...})` returns `'nyc'` and the record is
      visible only under NYC selection.
- [ ] **No Pokémon data is moved, copied, or nested under
      communities.** Database spot-check: no
      `communities/{cid}/wishlist`, `communities/{cid}/dynamax`,
      `communities/{cid}/gmax`, `communities/{cid}/costumes`, or
      `communities/{cid}/have` paths exist. `wishlist/{username}`,
      `have/{username}`, etc. remain the sole data paths.

---

## Flag-flip procedure (do not perform yet)

These steps are documented for the eventual flag-flip commit. They
are not performed by landing this doc.

1. Edit `index.html` only: change the literal
   `const MULTI_COMMUNITY_ENABLED=false;` to
   `const MULTI_COMMUNITY_ENABLED=true;`. No other edits.
2. Run `npm run check:community`. Expect "Community membership
   indexing checks passed." (Note: the sandbox guard
   `MULTI_COMMUNITY_ENABLED must remain false` will fail. Update
   that single guard in the same commit, since the pilot is now
   intentionally flag-on. Do not relax any other invariant.)
3. Run `npm run check:domain`. Expect "Domain helper checks passed."
4. Run the inline `index.html` parse check. Expect 2 inline scripts,
   0 failed.
5. Run `git diff --check`. Expect no whitespace errors.
6. Commit and push. Suggested GitHub Desktop summary:
   "Enable multi-community for trusted pilot."
7. Wait for Pages rebuild (typically 30–90 seconds).
8. Verify the deployed build serves the new literal:
   `curl -s https://doomsday126dev.github.io/trade-app/index.html | grep 'MULTI_COMMUNITY_ENABLED'`
   should show `true`.
9. Run the deployed smoke:
   `PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/ POGO_TEST_USER=TestUser POGO_TEST_PIN=123456 npm run visual`.
   Expect 18 passed, 0 failed, 0 skipped.
10. Notify pilot users that the switcher is live and that the pilot
    is officially in progress. Link them to a short summary of what
    they should expect to see different (switcher, scoped panes).

---

## Live-pilot monitoring

Watch for these signals during the first 24/72 hours and ongoing:

- **Health Check / support reports.** Ask pilot users to use the
  "Copy troubleshooting report" affordance if anything looks wrong;
  reports are sanitized and do not leak PII.
- **Missing community membership reports.** A pilot user who says
  "the switcher is empty" or "I see nobody" almost always lacks the
  expected `userCommunities/{uid}/{communityId}` entry or
  `communities/{communityId}/memberUsernames/{u}` row. The owner
  uses the owner-only assignment tool to repair.
- **Users not seeing expected trainers.** Usually a community
  mismatch — confirm the expected trainer is in the same community
  as the viewer.
- **Offer / schedule visibility complaints.** Likely a
  `communityId` mismatch on a legacy record (missing field →
  defaults to NYC). Decide case-by-case whether to migrate the
  record or accept the default.
- **Console errors.** Especially during initial load (read-scope
  helpers throwing on missing data) and during community switch.
- **Support load.** Track time spent diagnosing pilot issues vs.
  shipping new work. If load exceeds an acceptable threshold,
  pause or roll back.
- **Cross-community confusion.** Users who do not understand which
  community they are currently viewing. May indicate the switcher
  label needs to be more prominent.
- **Owner uses the assignment tool to repair membership gaps**
  rather than asking pilot users to re-request access.

---

## Rollback procedure

If the pilot must be rolled back at any time, the owner executes the
following — these steps are documented for completeness but not
performed by landing this doc.

1. Revert the flag-flip commit, **or** commit
   `MULTI_COMMUNITY_ENABLED=false` as a new commit. Either approach
   restores the production default; the new-commit approach is
   simpler if multiple commits have landed since the flag flip.
2. Run `npm run check:community` and `npm run check:domain`. The
   sandbox guard for `MULTI_COMMUNITY_ENABLED=false` should now pass
   again. If the guard was relaxed during the flip, restore it.
3. Run the inline `index.html` parse check. Expect 0 failures.
4. Run `git diff --check`. Expect no whitespace errors.
5. Push. Wait for Pages rebuild.
6. Verify the deployed build serves
   `const MULTI_COMMUNITY_ENABLED=false;`:
   `curl -s https://doomsday126dev.github.io/trade-app/index.html | grep 'MULTI_COMMUNITY_ENABLED'`.
7. Run the deployed smoke. Expect 18 passed, 0 failed, 0 skipped.
8. Notify pilot users that the switcher is off and that everyone is
   back on the global NYC view. Pokémon, offers, and schedule data
   are unchanged; only the visibility filter is reverted.

---

## Post-pilot review template

After the pilot concludes (or pauses), capture findings under each of
these headings so the next iteration has data to plan against:

- **Support load.** Owner hours spent on pilot triage, repair,
  re-assignment, and user questions. Compare to expected baseline.
- **Bugs.** Concrete defects surfaced by pilot use, with reproduction
  notes. Triage into "fix before widening", "fix when convenient",
  and "accept".
- **Missing features.** What pilot users asked for that the current
  flag-on UX does not provide. Especially: anything that motivated
  pilot users to switch back to flag-off-style behavior.
- **Whether rules tightening is needed before widening.** Any
  evidence of accidental or deliberate cross-community data reads
  beyond the trust assumption. If yes, the Firebase rule tightening
  milestone becomes a hard prerequisite for widening.
- **Whether Google sign-in should move to Phase 1.** Any evidence
  that PIN management has become the dominant support cost during
  pilot. If yes, accelerate `AUTH-PLAN.md` Phase 1 (owner-only
  Google linking prototype).
- **Whether a public join/request flow is needed.** Whether
  owner-driven approval has become a bottleneck.
- **Whether the pilot should widen, pause, or roll back.** A single
  recommendation based on the above signals.

---

## Deferrals

Explicitly out of scope of this doc and of the Phase 0 docs commit:

- **The actual flag-flip commit.** Belongs in a separate commit
  after this runbook is reviewed and the pre-flight checklist is
  fully ticked.
- **One-line `createMemberNow` default NYC enrollment fix** (drop
  the `ownerCanUseCommunityTools()` gate). Should be its own narrow
  commit if mitigation option 2 in § Known constraints and gaps is
  chosen over the owner-only-approvals constraint.
- **Firebase rule tightening** — separate pre-public-launch
  milestone with its own design doc.
- **Google auth Phase 1 prototype** — already deferred to
  `AUTH-PLAN.md` Phase 1; not a pilot blocker.
- **Flag-on Playwright browser smoke** — deferred per the
  multi-community testing audit; not a pilot blocker.
- **Public join/request flow** — not relevant during the trusted
  pilot since the owner approves manually.
- **Public launch.** Not yet acceptable.
- **PIN sunset.** Deferred to `AUTH-PLAN.md` Phase 4 (optional).
- **Anti-abuse / rate limiting** on the public request form —
  separate track.

---

## Update log

| Date | Version | Change |
|---|---|---|
| 2026-05-30 | v1 | Initial trusted multi-community pilot rollout checklist captured; no app or test code changed. |
