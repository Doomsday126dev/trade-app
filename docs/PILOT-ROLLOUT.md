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
| Document version | **v3** — pilot is live; flag flipped, deployed smoke passed, manual owner QA passed |
| Pilot status | **LIVE** (since flag-flip commit `6f22668`) |
| App flag | `MULTI_COMMUNITY_ENABLED=true` |
| Pilot communities | NYC (default) + New Jersey (prepared) |
| Pilot operator | owner |
| Rollback path | revert flag-flip commit `6f22668` (or commit the flag back to `false`) and redeploy; pre-flip baseline SHA is `06c8b52` |

This document is the operator runbook for the trusted multi-community
pilot. The pilot is now **live in production** after a successful flag
flip (commit `6f22668`), a deployed-smoke pass of 18/18, and the
owner's manual post-flip QA. The runbook remains the canonical
reference for live-pilot operations, monitoring, and rollback.

---

## Live pilot record

Captured at pilot go-live to provide a durable audit trail and to
inform the post-pilot review.

- **Flag flip commit:** `6f22668` — flips `const MULTI_COMMUNITY_ENABLED=false;`
  → `true` at `index.html:2431` and updates the matching
  source-invariant guard at `scripts/check-community-membership.js`
  lines 169–170.
- **Pre-flip baseline / rollback SHA:** `06c8b52`. Recorded before
  the flip per the runbook's pre-flight checklist.
- **Deployed verification (against
  `https://doomsday126dev.github.io/trade-app/index.html`):**
  - `const MULTI_COMMUNITY_ENABLED=true;` present (1 occurrence).
  - `const MULTI_COMMUNITY_ENABLED=false;` absent (0 occurrences).
  - `const DEFAULT_COMMUNITY_ID='nyc';` preserved unchanged.
- **Deployed smoke result:** 18 passed, 0 failed, 0 skipped against
  the post-flip build (`PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/`,
  `POGO_TEST_USER=TestUser`, desktop + mobile chromium, 2 workers).
- **Manual owner QA (post-smoke, against the live production app):
  PASSED.** Each item checked:
  - Owner preview works.
  - Owner preview precedence over the public top Community dropdown
    is intentional and verified.
  - A non-owner member who belongs to both NYC and New Jersey can
    use the top Community dropdown normally.
  - NYC and New Jersey scoping work on every checked surface
    (Browse, Strings / Compare / Trade Match, Inventory Community
    Browse, Schedule views, incoming-offer panes).
  - A New Jersey scheduled trade created during QA stamps
    `communityId:'new-jersey'` on the new record.
  - Switching back to NYC hides the New-Jersey-only scheduled trade.
  - Legacy missing-`communityId` records resolve to `'nyc'` via
    `recordCommunityId`.
  - No Pokémon data was moved or duplicated under communities;
    `wishlist/{username}`, `have/{username}`, etc. remain the sole
    data paths.
  - Owner-only approvals remain the pilot operating process per the
    constraint documented in § Known constraints and gaps.

The pre-flight checklist, manual-QA rehearsal checklist, flag-flip
procedure, rollback procedure, live-pilot monitoring guidance, and
post-pilot review template below all remain canonical for the live
pilot.

---

## Pilot scope and trust assumption

- **Pilot is limited to a few dozen invited users known to the
  owner.** All pilot users have been told personally what to expect.
- **Owner is the sole operator and approver during the pilot** unless
  the coordinated rules-plus-client milestone described in § Known
  constraints and gaps is explicitly shipped first.
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
  `allData.users?.[cur]?.isOwner`. Under `MULTI_COMMUNITY_ENABLED=false`
  this is harmless. Under flag-on, a non-owner admin approving a
  request still successfully creates the user (`users/{u}`,
  `loginDirectory/{u}`, `requests/{reqId}/status='approved'`) but
  leaves the new user with no community membership — their
  `memberCommunityOptions()` would be empty, their switcher would not
  render, and read surfaces would be empty.
- **The client gate is not a footgun; it mirrors Firebase rules.**
  The canonical ruleset (see `SECURITY-RULES.md`) gates `communities/`,
  `userCommunities/`, and `communityRequests/` writes to the owner —
  `auth.uid` must resolve to `OWNER` or to a user with `isOwner:true`.
  There is no admin exception on any of those three subtrees. The
  client-side `ownerCanUseCommunityTools()` gate exists to keep the
  approval write batch within what the rules will accept, not as a
  UI choice independent of rules.
- **Do not remove the client gate alone.** `createMemberNow`'s
  approval is a single atomic `update(ref(db), updates)` batch. If the
  client gate is dropped without a matching rules change, the batch
  will include `communities/nyc/...` and `userCommunities/{uid}/nyc`
  paths that the rules reject — and Firebase rejects the **whole**
  batch atomically. The result is that the new user is not created
  at all and the admin sees `db/write-rejected-silently` after the
  verification step. That is a regression, not a fix.
- **Pilot mitigation:** owner handles all approvals during the
  pilot. This is the supported path; the runbook assumes it. It
  remains the pilot assumption unless the coordinated rules-plus-client
  milestone described below is explicitly shipped.
- **Deferred future alternative (not part of pilot):** a coordinated
  rules + client change scoped to NYC default-only. Rules would gain
  a narrow admin-write permission on `communities/nyc/memberUsernames/$username`,
  `communities/nyc/members/$uid`, and `userCommunities/$uid/nyc`,
  ideally with add-only constraints such as `!data.exists()` to
  prevent admins from removing or rewriting existing NYC memberships.
  The client would drop the `ownerCanUseCommunityTools()` gate inside
  `createMemberNow` (only — community prep, member assignment, and
  owner-preview tools stay owner-only). This belongs in the
  public-launch rules-tightening track, alongside the broader
  per-subtree read narrowing and write-time community precondition
  on offers/trades. It is **not** part of this pilot runbook and is
  intentionally out of scope for any pilot commit.

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
- **Coordinated rules + client change to allow non-owner admin
  enrollment into NYC default during approval.** Would pair a narrow
  rules update (admin write on `communities/nyc/memberUsernames/$username`,
  `communities/nyc/members/$uid`, and `userCommunities/$uid/nyc`,
  ideally with add-only constraints such as `!data.exists()`) with a
  client change that drops the `ownerCanUseCommunityTools()` gate
  inside `createMemberNow` only. Belongs in the public-launch
  rules-tightening track, not the pilot. A client-only "drop the
  gate" change without the matching rules update would atomically
  break approval at the Firebase layer and is explicitly rejected.
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
| 2026-05-30 | v2 | Clarified that the owner-only approvals constraint mirrors current Firebase rules (not just a client/UI preference) and rejected the previously suggested client-only one-line fix because it would atomically break the approval write batch at the rules layer. Future alternative is a coordinated rules + client change scoped to NYC default-only, deferred to the public-launch rules-tightening track. No app or test code changed. |
| 2026-05-30 | v3 | Trusted multi-community pilot is now live. Flag-flip commit `6f22668` flipped `MULTI_COMMUNITY_ENABLED` to `true`; pre-flip baseline SHA `06c8b52` recorded for rollback. Deployed verification confirmed the production build serves the flag as `true` with `DEFAULT_COMMUNITY_ID='nyc'` unchanged. Deployed smoke passed 18/18 against the post-flip build. Owner-led manual QA against the live production app passed every item, including owner-preview precedence, the public top Community dropdown for a non-owner NYC+NJ member, all four read-scope surfaces, `communityId` stamping on a new New Jersey scheduled trade, NYC hiding NJ-only records, legacy missing-`communityId` defaulting to nyc, no Pokémon data nesting, and the owner-only-approvals operating process. No app code, test code, or Firebase rules changed by this docs update. |
