# Trusted Multi-Community Pilot — Monitoring & Incident Runbook

> **Maintenance convention**: This is a living plan. Anyone updating
> the pilot or responding to a pilot incident should update the
> relevant section before pushing, and append a new row to the Update
> log at the bottom. Format mirrors `SCALING-NOTES.md`,
> `SECURITY-RULES.md`, `AUTH-PLAN.md`, and `PILOT-ROLLOUT.md`: status
> banner at top, history-preserving update log at the bottom.

This doc is the **live-operation companion** to `PILOT-ROLLOUT.md`.
The runbook owns *how the pilot was launched*; this doc owns *how the
pilot is watched, triaged, and (if needed) rolled back* while live.

---

## Current status

| Item | Status |
|---|---|
| Document version | **v1** — initial monitoring and incident runbook |
| Pilot status | **LIVE** (since flag-flip commit `6f22668`) |
| App flag | `MULTI_COMMUNITY_ENABLED=true` |
| Pilot communities | NYC (default) + New Jersey |
| Pilot operator | owner |
| Rollback target | revert flag-flip commit `6f22668`, or commit the flag back to `false`; pre-flip baseline SHA `06c8b52` |
| Rollback procedure (detailed) | `PILOT-ROLLOUT.md` § "Rollback procedure" |

---

## Standing security reminder

These two facts shape every monitoring decision below. Re-read them
before acting on any incident:

- **Current Firebase reads are still broad.** The canonical ruleset
  uses `".read": "auth != null"` at the root, so every authenticated
  user can read every subtree (wishlist, have, offers, trades,
  communities, etc.) at the database layer.
- **UI filtering is not security.** Everything the multi-community
  read scope does — Browse, Strings/Compare/Trade Match, Inventory
  Community Browse, Schedule views, and `offerInReadScope` — narrows
  what the **UI shows**, not what the **database returns** to a
  determined user with DevTools.

Pilot users have been informed of this trust assumption (see
`PILOT-ROLLOUT.md` § "Pilot scope and trust assumption"). Anyone
ex­filtrating data via DevTools is violating pilot trust, not
defeating a defense. Rules tightening is deferred to the
public-launch rules-tightening track; this monitoring doc does not
attempt to plug rule-layer gaps.

---

## Daily check (≤ 5 minutes)

Run through this every day during the pilot. The goal is "is anything
obviously wrong?", not deep auditing.

- [ ] **Deployed flag still serves true.**
      `curl -s https://doomsday126dev.github.io/trade-app/index.html | grep MULTI_COMMUNITY_ENABLED`
      should show `const MULTI_COMMUNITY_ENABLED=true;`. If it
      doesn't, something has un-rolled the pilot — investigate before
      doing anything else.
- [ ] **Local repo state.** `git fetch && git status` — confirm no
      surprise upstream changes. Note current HEAD; compare with the
      live commit (currently `6f22668`).
- [ ] **Sanity checks green.**
      `npm run check:community` and `npm run check:domain` both pass.
      Flag-on source invariant still asserts `=true`.
- [ ] **Owner skim of pilot users.** Sign in to the live app as the
      owner. Confirm the top Community dropdown lists NYC + New
      Jersey (or just one + passive label if you're only in one).
      Switch to New Jersey: Browse, Strings, Inventory Community
      Browse, and Schedule all render without console errors.
- [ ] **Spot-check live data shape.** In DevTools, run
      `JSON.stringify(Object.keys(allData.communities||{}))` —
      confirm `nyc` and `new-jersey` are present and no Pokémon
      paths (`wishlist`, `dynamax`, `gmax`, `costumes`, `have`)
      appear inside any community object. The source-level invariant
      check in `scripts/check-community-membership.js` enforces this
      for source code; this is the runtime mirror.
- [ ] **Inbox / DM / Discord.** Has any pilot user reported anything?
      Logged here under § "Daily log".

If anything in the daily check fails, escalate per § "Severity
classification" below.

---

## Severity classification

Group incoming pilot reports and observed symptoms into one of these
buckets before deciding what to do.

### Sev-1 — Rollback candidate (production behavior is broken)

Symptoms in this bucket strongly suggest the flag flip itself is the
cause and rollback should be considered immediately. Examples:

- Multiple pilot users cannot reach the main app at all (blank
  screen, infinite spinner, login completes but `#app` never
  becomes visible).
- The community switcher renders for a user who has zero community
  memberships (defeats the gating).
- Pokémon data (wishlist / have / dynamax / gmax / costumes /
  offers / trades) is missing or corrupted for any pilot user as a
  consequence of the flag flip.
- Any UI surface throws an uncaught JS error during initial render
  that prevents the rest of the page from loading (and the deployed
  smoke would now fail 18/18).
- Owner cannot sign in, repair a member account, or use the
  owner-only community tools.

**Response:** execute § "Rollback decision" below. **Do not** try to
patch forward under Sev-1 unless the fix is genuinely one-line and
the owner is confident it is the right call.

### Sev-2 — Serious bug, do not rollback yet

Pilot still works for most users, but a real correctness or
visibility defect needs same-day attention.

- A specific pilot user reports they cannot see another pilot
  member who is supposed to be in the same community. Triage per §
  "Data-path investigation".
- A new scheduled trade created under New Jersey selection appears
  on NYC views, or vice versa (the `communityId` stamp didn't take
  or `schedulePreviewAllowsTrade` is misreading).
- Offer counts or per-item offer lists are visibly mismatched
  between two pilot users in the same community.
- Owner preview no longer takes precedence over the public top
  Community dropdown.
- A pilot user's switcher options don't match their actual
  `userCommunities/{uid}` memberships.

**Response:** investigate per § "Data-path investigation" or §
"Symptom playbook". Do not rollback unless triage finds the cause
is structural to the flag flip rather than a data state issue the
owner can repair.

### Sev-3 — Minor UX issue, log and defer

Pilot users can keep operating; the issue is polish or a small
confusion.

- Switcher label is unclear or cramped on a particular device.
- The "outside community" toast is too aggressive in tone.
- A pilot user is briefly confused about which community they're
  viewing.
- Cosmetic banner misalignment.
- Owner-preview banner copy needs a small word change.
- Inventory Community Browse takes a beat longer to render after a
  switch.

**Response:** log here under § "Daily log" with date + user
attribution and decide later. Don't rush a fix; bundle into a
post-pilot iteration.

---

## Data-path investigation

When a pilot user reports a visibility complaint ("I can't see X" /
"Y can't see me" / "I'm missing a trade"), inspect these paths **in
this order**. Most reports resolve at step 2 or 3.

All commands assume you are signed in as the owner in a DevTools
console; `allData` is the live in-memory cache.

1. **Confirm the affected user's username and authUid.**
   ```js
   allData.users?.['<username>']
   ```
   Note the `authUid` value. If missing or wrong, the user is in an
   un-repaired state — use the owner-only repair tool, not a
   monitoring action.

2. **Confirm community memberships for that user.**
   ```js
   ({
     username_idx: allData.communities?.nyc?.memberUsernames?.['<username>'],
     uid_idx_nyc: allData.communities?.nyc?.members?.['<uid>'],
     uid_idx_nj:  allData.communities?.['new-jersey']?.members?.['<uid>'],
     reverse:     allData.userCommunities?.['<uid>']
   })
   ```
   - If `username_idx` or `uid_idx_nyc` is missing for a user who
     should be in NYC, run § "Symptom playbook → missing NYC
     enrollment" below.
   - If `userCommunities/{uid}/{cid}` is missing for a community
     they're supposed to be in, the owner-only assignment tool can
     repair it without a flag flip.

3. **Confirm the active read scope at the reporter's session.**
   Have the reporter open DevTools and run:
   ```js
   ({
     flag: MULTI_COMMUNITY_ENABLED,
     selected: getCurrentCommunityId(),
     scope: readScopeMemberUsernames() && Array.from(readScopeMemberUsernames()).sort(),
     ownerPreviewOn: ownerCommunityPreviewOn()
   })
   ```
   The `scope` set is exactly what the reporter's UI will allow.
   Confirm the user they "can't see" is in that set.

4. **For an offer visibility complaint**, inspect:
   ```js
   Object.entries(allData.offers?.['<recipient>']||{}).map(([id,o]) => ({id, from:o.from, communityId:o.communityId||'(missing -> nyc)'}))
   ```
   - Offers with `communityId === '<currently-selected community>'`
     should be visible.
   - Offers with `communityId` mismatched (or missing → defaults to
     `nyc`) are correctly hidden under the other community.

5. **For a scheduled-trade visibility complaint**, inspect:
   ```js
   Object.entries(allData.trades||{})
     .filter(([id,t]) => Object.keys(t.participants||{}).includes('<username>'))
     .map(([id,t]) => ({id, communityId:t.communityId||'(missing -> nyc)', status:t.status, participants:Object.keys(t.participants||{})}))
   ```
   - Trades created post-flip should carry an explicit `communityId`.
   - Trades created pre-flip have no `communityId` and resolve to
     `nyc` via `recordCommunityId` — intentional, not a bug.

6. **For a Pokémon-data visibility complaint** (wishlist / have /
   dynamax / gmax / costumes):
   - **These paths are user-global**, not community-scoped. If a
     pilot user is "missing their wishlist", the multi-community
     read scope is **not** the cause — investigate the underlying
     user record / sync state separately.

---

## Symptom playbook

Short-form responses to the most likely reports.

### "I just logged in and the app is blank"

1. Ask which browser / device.
2. Ask them to open DevTools console and screenshot any errors.
3. If multiple pilot users report this within ~10 minutes, treat as
   **Sev-1** and proceed to § "Rollback decision".
4. If only one pilot user, ask them to (a) hard-refresh, (b) sign
   out and back in, (c) clear local storage. Most blank-app reports
   resolve here; treat as Sev-3 if so.

### "I can't see <other pilot user> anymore"

1. Triage per § "Data-path investigation" steps 1–3.
2. Most common cause: the reporter is on a different community than
   the user they expect to see. Have them switch communities or
   confirm both belong to the same one.
3. Second most common cause: the missing user lacks
   `userCommunities/{uid}/{cid}` for the community both should be
   in. **Owner uses the owner-only assignment tool to repair**, no
   rollback needed.

### "My new scheduled trade isn't showing up"

1. Confirm via DevTools that the trade record exists in
   `allData.trades` with the expected `participants` and
   `communityId`.
2. If `communityId` does not match the reporter's selected
   community, that's the (visible) bug. Treat as **Sev-2** and check
   whether the user was switching communities mid-write — if so,
   document and decide whether to ship a "freeze selected community
   while the modal is open" fix.
3. If `communityId` is missing on a post-flip record, that is a
   real bug — escalate to Sev-1 because it implies the
   `submitScheduledTrade` stamp regressed.

### "Missing NYC enrollment for newly approved user"

A non-owner admin approved during the pilot (against the runbook
constraint). Symptoms: new user logs in, switcher is empty, read
surfaces show nothing.

1. Confirm via DevTools that `allData.users?.[<u>]` exists and has
   an `authUid`.
2. Confirm
   `allData.communities?.nyc?.memberUsernames?.[<u>] === undefined`.
3. Owner uses the owner-only assignment tool to add them to NYC.
   This succeeds under current rules because the **owner** is doing
   the write.
4. Log under § "Daily log" and remind admins of the constraint.

### "I see somebody from the other community"

1. Confirm whether owner preview is on for the reporter (sometimes
   they don't realize they're previewing).
2. If owner preview is off, ask which user shows incorrectly,
   inspect that user's `userCommunities/{uid}` — most likely they
   are a legitimate cross-community member (e.g. owner is in both
   NYC and NJ; that user will show on both).
3. If the user has no membership in the reporter's selected
   community and is still visible, that's a real bug. Treat as
   **Sev-2** and inspect `browseAllowedUsers()` /
   `stringsAllowedUsers()` / etc. for the failing case.

---

## Rollback decision

Trigger rollback if **any** of these holds:

- Sev-1 from § "Severity classification" is confirmed and is
  attributable to the flag flip (not unrelated infrastructure).
- Multiple pilot users (≥2) independently report the live app is
  unusable within a short window.
- Deployed smoke against current HEAD fails on a flag-on-sensitive
  scenario (Browse, Strings, Schedule modal, Tab switching) and the
  failure is not transiently flaky.
- The owner finds clear evidence of data corruption traceable to a
  flag-on code path (e.g. a write that should have been gated by
  community membership escaped that gating).
- Support load exceeds the pilot's intended ceiling and the owner
  decides to pause regardless of correctness.

**Do not** rollback for:

- A single Sev-2 or Sev-3 report that the owner can repair via the
  assignment tool.
- A cosmetic complaint.
- A pilot user violating the documented trust assumption (e.g.
  reading another user's data via DevTools) — that's a trust
  violation, not a code defect. Document and address out-of-band.

---

## Rollback procedure (high-level)

The detailed steps live in **`PILOT-ROLLOUT.md` § "Rollback
procedure"**. The high-level sequence is:

1. Either revert flag-flip commit `6f22668`, or land a new commit
   that flips the flag back to `false`. Either approach is
   acceptable; new-commit is simpler if other commits have landed
   since.
2. Update the source-invariant guard in
   `scripts/check-community-membership.js` back to expect
   `=\s*false`.
3. Run `npm run check:community`, `npm run check:domain`, the
   inline `index.html` parse check, and `git diff --check`. All
   must pass.
4. Push. Wait for Pages rebuild.
5. `curl -s https://doomsday126dev.github.io/trade-app/index.html | grep MULTI_COMMUNITY_ENABLED`
   to confirm the deployed build serves `=false`.
6. Run the deployed smoke. Expect **18 passed, 0 failed, 0 skipped**
   back at the pre-flip baseline.
7. Notify pilot users that the switcher is off and global NYC
   behavior is restored.
8. After rollback, append a new row to `PILOT-ROLLOUT.md` § "Update
   log" and a new row here capturing what triggered the rollback,
   the rollback commit SHA, and the planned next step (fix-and-flip
   again? pause? re-design?).

**Baseline SHA to roll back to (logically):** `06c8b52` — the
immediately-prior `MULTI_COMMUNITY_ENABLED=false` state. Note this
is a baseline reference, not a `git reset` target; rollback ships
new commits rather than rewriting history.

---

## Daily log

Use this section to capture daily-check outcomes, incident reports,
and triage decisions. Newest at the bottom. Format suggestion:

```
### YYYY-MM-DD
- Daily check: pass / fail (notes)
- Reports: <user> — <symptom> — <severity> — <resolution>
- Actions taken: <repair / patch / rollback / none>
```

> _(No entries yet — capture the first daily check here when
>  monitoring begins.)_

---

## Update log

| Date | Version | Change |
|---|---|---|
| 2026-05-30 | v1 | Initial pilot monitoring and incident runbook captured; no app or test code changed. |
