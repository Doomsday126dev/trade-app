# Authentication Plan — Google sign-in / stronger auth

> **Maintenance convention**: This is a living plan. Anyone shipping
> auth-related work should update the relevant section before pushing,
> and append a new row to the Update log at the bottom. Format mirrors
> `SCALING-NOTES.md` and `SECURITY-RULES.md`: status banner at top,
> history-preserving update log at the bottom so any future contributor
> (Claude / Codex / human) can reconstruct what changed when.

---

## Current status

| Item | Status |
|---|---|
| Document version | **v1** — initial Google auth design captured |
| Current auth model | username + synthetic Firebase email + 6-digit PIN |
| Google sign-in | **designed, not yet implemented** |
| Phase | **0 of 5** — docs-only plan |
| Active flag | **none yet**; proposed future flag `GOOGLE_AUTH_ENABLED`, default `false` |
| Production behavior | **unchanged** |

This document captures the model and roadmap before any auth code is
written, so future commits have a stable contract to be checked
against. No app code, test code, Firebase rules, login behavior,
approval flow, repair flow, PIN handling, or data paths are changed by
this plan landing.

> **2026-08-03 architecture checkpoint:** implementation of this roadmap is
> paused while the trainer-first global application proposal in
> `docs/GLOBAL-APP-PLAN.md` is evaluated. Its initial Phase 0 direction adopts
> Firebase Auth UID as durable account identity and Pokemon GO trainer name as
> a unique-at-claim, mutable public handle. This document's original invariant
> that username remains a permanently stable primary app identity reflects the
> community-pilot design and is no longer the proposed global target. Do not
> implement an auth phase until this plan is rewritten around provider linking,
> normalized handle claims, collision prevention, and legacy-account migration.
> The approved Phase 0 direction allows a new account to build privately before
> verification, requires verified email or Google before searchable publishing,
> preserves existing migrated handle claims, and uses provider recovery as the
> routine path. Google/email migration must link to the existing Firebase UID
> rather than silently creating a duplicate trainer account. Exceptional handle
> disputes use a private frozen-review state and cannot be resolved from public
> profile evidence alone. See `docs/GLOBAL-APP-PLAN.md` for the current policy
> and implementation sequence.

---

## Current model snapshot

The current authentication model decouples **app identity** (username)
from **auth identity** (Firebase Auth UID). Pokémon data, offers,
trades, schedules, and community membership are all keyed by one of
these two, consistently. The components below are descriptive only —
this section makes no recommendations.

- **`username`** — the user's stable, human-readable app identity.
  Keys every Pokémon-data path (`wishlist/{username}`,
  `dynamax/{username}`, `gmax/{username}`, `costumes/{username}`,
  `have/{username}`), `offers/{recipient}/...`, `users/{username}`,
  `loginDirectory/{username}`, and the community
  `memberUsernames/{username}` indexes.
- **`authUid`** — the Firebase Auth UID for the user's current sign-in
  account. Stored at `users/{username}/authUid` and used by Firebase
  rules to authorize writes. Keys
  `communities/{cid}/members/{uid}` and
  `userCommunities/{uid}/{cid}`.
- **`authVersion`** — integer ≥1. Lets the admin repair flow rotate
  the underlying Firebase Auth account (new email, new password, new
  `authUid`) without changing the **username** that keys all data.
  Each repair increments the version.
- **`authEmail`** — the synthetic email
  `<sanitized-username>[ _v{n} ]@pogotrades.nyc` used as the Firebase
  Auth email/password account identifier. The `@pogotrades.nyc`
  domain is **not** a deliverable mailbox; it exists only as a
  Firebase Auth address. Mirrored at `users/{username}/authEmail`.
- **`authIndex/{uid}`** — the rules-side mapping from
  `auth.uid → {username, isAdmin, isOwner, lastSeen}`. Written by the
  user on first sign-in (rules forbid writing another user's
  `authIndex` row). Firebase rules use this to translate the
  signed-in uid back into a username for write authorization on
  offers, trades, and community paths.
- **`loginDirectory/{username}`** — the public, read-by-all index of
  `{authVersion, authReady, approvedAt}` that drives the login-form
  dropdown. Read-by-all is acceptable for the closed-community pilot;
  it would be reconsidered before public scale.
- **`users/{username}`** — single source of truth for a user's
  profile and auth metadata (`pin` hash, `pinHashed`, `authVersion`,
  `authEmail`, `authUid`, `friendCode`, `isAdmin`, `isOwner`, etc.).

### Key function references (current `index.html`)

| Function | Line | Role |
|---|---|---|
| `authEmail(username, version)` | 4183 | Derives the synthetic Firebase Auth email for a (username, version) pair. |
| `signInWithAuthVersionScan(username, pin, startVersion)` | 4100 | Tries `signInWithEmailAndPassword` against each candidate version's synthetic email until one succeeds. |
| `createMemberNow(username, pin, isAdmin, reqId)` | 3966 | Owner/admin onboarding: provisions a Firebase Auth account at version 1, writes `users/{u}`, `loginDirectory/{u}`, and the default community membership. |
| `repairMemberAccount(username, opts)` | 3923 | Admin-only legacy recovery: provisions a fresh Firebase Auth account at the next `authVersion`, rotates `authUid`. The previous Firebase Auth user and its `authIndex/{old-uid}` row are left orphaned. |
| `authIndex/{currentAuthUid}` write | 4347 | Each user publishes their own `authIndex` row on sign-in success; rules forbid writing another user's row. |

---

## Legacy community-pilot identity invariants

These were the contract for the original community-pilot Google-auth roadmap.
They remain useful as a description of compatibility requirements during
migration, but they are superseded as the global target by
`docs/GLOBAL-APP-PLAN.md`. Do not implement this section literally without the
UID/handle migration design and explicit approval.

- **Username remains the primary app identity.** Adding Google
  sign-in does not change how Pokémon, offer, schedule, or community
  data are keyed. Usernames are stable, semantic, and what users see;
  no migration to UID-keyed data is planned.
- **`authUid` is the auth identity only.** It is used by Firebase
  rules (via `authIndex/{uid}`) to authorize writes. It is not used
  for any path that a human ever types or shares.
- **Pokémon, offer, schedule, and community data paths remain
  unchanged.** Specifically: `wishlist/{username}`,
  `dynamax/{username}`, `gmax/{username}`, `costumes/{username}`,
  `have/{username}`, `offers/{recipient}/{id}`, `trades/{id}`,
  `users/{username}`, `loginDirectory/{username}`,
  `communities/{cid}/memberUsernames/{username}`,
  `communities/{cid}/members/{uid}`, and
  `userCommunities/{uid}/{cid}`.
- **Linking Google to an existing Firebase Auth user is preferred
  over replacing `authUid`.** When an existing PIN user opts in to
  Google sign-in, the chosen mechanism is
  `linkWithPopup(auth.currentUser, new GoogleAuthProvider())`, which
  attaches the Google credential to the **same** Firebase Auth user
  and leaves `authUid` unchanged. This preserves every `authIndex/{uid}`
  row, every `communities/{cid}/members/{uid}` entry, and every
  `userCommunities/{uid}/{cid}` entry without rewrites.
- **Before attaching a Google credential to a username, check
  `authIndex/{cred.user.uid}` for an existing username binding and
  refuse conflicts.** If the same Google account is already linked to
  a different username, the new link must be rejected with a clear
  error rather than silently overwriting either side. This is the
  single most important new invariant introduced by Google sign-in.
- **`authVersion` repair flow remains the legacy recovery path.**
  PIN users who lose access without having linked Google continue to
  recover via the existing admin repair flow. Google linking does not
  replace repair; it supplements it.
- **Existing PIN login remains valid until a separately approved
  migration/sunset plan exists.** No phase below removes PIN sign-in.
  Sunsetting PIN (Phase 4) is **optional** and gated on explicit
  approval plus a documented grace period.

---

## Roadmap

Five phases, each independently shippable and independently
reversible. Phases 4 and 5 are explicitly optional.

### Phase 0 — Docs-only design plan

- **Goal:** capture the model, identity invariants, and roadmap so
  future commits have a stable contract.
- **Files likely touched:** `docs/AUTH-PLAN.md` (this file),
  `docs/MAINTENANCE-LOG.md` (pointer entry).
- **Primary test surface:** none — sanity-only (`check:community`,
  `check:domain`).
- **Deployed smoke required:** **no.**
- **Reversibility:** trivial — delete the file.

### Phase 1 — Owner-only Google linking prototype behind disabled `GOOGLE_AUTH_ENABLED`

- **Goal:** validate the end-to-end Google OAuth flow against the
  production Firebase project with no exposure to other users.
  Adds a new flag `GOOGLE_AUTH_ENABLED=false` and an owner-only
  "Link Google" affordance on Profile that is gated by both the flag
  AND `cur===OWNER`. With the flag false, no user (including the
  owner) sees the affordance; the owner can flip the flag locally to
  exercise the flow.
- **Files likely touched:** `index.html` (new flag literal, new
  Profile button gated by flag + owner check, new linking helper
  function), `scripts/check-community-membership.js` (or a new
  `scripts/check-auth.js`; decide at design time) for the invariant
  guards (flag stays false in source, linking helper checks
  `authIndex/{uid}` before binding, no path is moved/copied).
- **Primary test surface:** unit/sandbox tests for the linking
  helper's guards (conflict-refusal, no-`authUid`-replacement,
  flag-false short-circuit).
- **Deployed smoke required:** **yes** — Profile UI changes.
- **Reversibility:** flip the flag false (default) or revert the
  commit; no schema change.

### Phase 2 — Self-service Google linking for existing users

- **Goal:** flip `GOOGLE_AUTH_ENABLED=true` so every signed-in user
  can link Google from Profile. PIN sign-in still works as before.
- **Files likely touched:** `index.html` (flag literal change, copy
  updates), tests (`check-auth` covering both flag states).
- **Primary test surface:** behavior under flag-on (linking succeeds
  for a fresh Google account; linking refuses on conflict; signing
  out and back in via Google works against the linked account).
- **Deployed smoke required:** **yes.**
- **Reversibility:** flip the flag false; any previously linked
  Google credential remains on the Firebase Auth user but the UI
  affordance hides.

### Phase 3 — Google onboarding for new users while PIN remains supported

- **Goal:** add a Google-credential branch to the new-user approval
  flow so admins can approve a request without issuing a PIN. The
  PIN branch remains for any new user who prefers it.
- **Files likely touched:** `index.html` (new branch in
  `approveRequest` / `createMemberNow`, request-form copy updates),
  tests for the new branch including the
  `authIndex/{cred.user.uid}` duplicate-account guard.
- **Primary test surface:** approval-flow unit tests for both
  branches; manual QA of a real Google-onboarded new user.
- **Deployed smoke required:** **yes.**
- **Reversibility:** restrict the Google branch behind the flag (or
  a sub-flag) and roll back if support load increases unexpectedly.

### Phase 4 (optional) — PIN sunset only after a grace period and support evidence

- **Goal:** retire PIN sign-in after explicit owner approval and a
  documented grace period (suggested: ≥ 3 months of dual-mode
  operation, plus user communication). Only pursued if Phases 1–3
  produce clear support-cost evidence that PIN management is the
  dominant overhead.
- **Files likely touched:** `index.html` (remove PIN branches in
  sign-in / repair / onboarding), `SECURITY-RULES.md` (optionally
  tighten to require `auth.token.firebase.sign_in_provider === 'google.com'`),
  tests.
- **Primary test surface:** migration audit ensuring every existing
  user has linked Google before PIN removal; admin fallback for any
  exception cases.
- **Deployed smoke required:** **yes.**
- **Reversibility:** non-trivial; the grace period and explicit
  approval are the safety net.

### Phase 5 (optional) — Firebase Emulator Suite / rule testing

- **Goal:** stand up a Firebase Emulator Suite harness so Firebase
  rules can be unit-tested independently of the auth provider. Useful
  before the rule-tightening step in Phase 4 (or before any public
  rule narrowing for multi-community).
- **Files likely touched:** new `scripts/` harness, possibly a
  `firebase.json` config and `package.json` dev script. No
  `index.html` changes.
- **Primary test surface:** rule unit tests.
- **Deployed smoke required:** **no.**
- **Reversibility:** trivial — emulator harness is dev-only.

---

## Rejected approaches

These were considered and explicitly rejected. Future implementation
prompts should not revisit them without surfacing new evidence.

- **Do not force Google sign-in for everyone as the first
  implementation step.** Phase 1 (owner-only behind a disabled flag)
  is the correct starting point; jumping to forced migration risks
  locking out users who do not link in time.
- **Do not replace `authUid` when linking; prefer `linkWithPopup`.**
  Replacing `authUid` would break every `authIndex/{old-uid}` row,
  every `communities/{cid}/members/{old-uid}` entry, and every
  `userCommunities/{old-uid}/{cid}` entry, forcing a migration that
  the link approach avoids entirely.
- **Do not loosen `authIndex/{uid}` so admins can write other users'
  uid rows.** The current self-write-only rule is a safety feature
  that prevents an admin (or compromised admin) from impersonating
  another user by hijacking the uid → username mapping. The repair
  flow is intentionally designed around this.
- **Do not silently sunset PINs.** Any deprecation of PIN sign-in
  requires an explicit owner-approved migration plan, a grace
  period, user communication, and an admin fallback.
- **Do not move username-keyed Pokémon data to UID-keyed paths.**
  All `wishlist/{username}`, `dynamax/{username}`,
  `gmax/{username}`, `costumes/{username}`, `have/{username}`, and
  `offers/{recipient}/...` paths must remain username-keyed. Google
  sign-in is an auth-provider addition, not a data-model change.

---

## Deferrals

The following are intentionally **not** within the scope of this plan
or the Phase 0 docs commit. Each gets its own design pass when
prioritized.

- **Firebase rule tightening for Google-only auth** (e.g. requiring
  `auth.token.firebase.sign_in_provider === 'google.com'`). Only
  meaningful after Phase 4 at the earliest.
- **Public join/request flow rewrite.** Current request form is
  owner-driven and adequate for the trusted pilot.
- **Firebase Emulator Suite tests.** Tracked as optional Phase 5.
- **Public multi-community flag enablement.** Separate track
  (`docs/MAINTENANCE-LOG.md` history). This auth plan neither blocks
  nor unblocks it.
- **2FA, passkeys, device session management.** Out of scope for
  this roadmap as drafted.
- **PIN sunset / forced migration.** Phase 4 only, optional.
- **`authIndex` orphan-row cleanup tools.** Useful but not required
  for Google sign-in itself; tracked separately.
- **Switching away from Firebase Auth** (e.g. to Auth0, Clerk,
  Supabase). Not considered. Firebase Auth supports both Google and
  PIN paths.

---

## Update log

| Date | Version | Change |
|---|---|---|
| 2026-05-30 | v1 | Initial Google auth design captured; no app or test code changed. |
