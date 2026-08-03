# Global App Phase 0 Architecture Plan

> **Status:** Phase 0 policy direction recorded; implementation is not yet
> approved. This document changes no application code, Firebase data,
> authentication flow, security rule, or production behavior. The existing
> multi-community pilot remains live until a separately approved, tested
> migration replaces it.

## Product decision under review

PoGo Trades would move from a community-scoped application to a global,
trainer-first trade-list directory. A trainer's Pokemon GO lists remain owned
by that trainer. Communities would no longer determine who can discover or
view a public list.

The initial global release should be intentionally narrow:

1. Search for a trainer by Pokemon GO trainer name.
2. Open that trainer's public profile and public trade list.
3. Compare that one public list with the signed-in user's list.
4. Highlight both directions of the comparison and mutual opportunities.
5. Generate relevant Pokemon GO search strings from that pairwise comparison.

The current Pokemon-first Browse screen is not part of the proposed global
release. It works for a small community, but its Pokemon cards with inline
trainer names would become crowded and would encourage loading or indexing far
more public-list data than trainer-first discovery requires.

## Proposed navigation

- **My List** - edit the signed-in trainer's lists and export/share them.
- **Find Trainer** - search the public trainer directory, open one profile, and
  compare lists in that profile.
- **Strings** - generate strings for the signed-in trainer or the currently
  selected pairwise comparison.
- **Events** - current and upcoming Pokemon GO events without personal trade
  scheduling.
- **Settings** - profile visibility, linked sign-in methods, contact privacy,
  exports, and legacy-data access.
- **Admin** - visible only to authorized administrators.

Trade Match should not remain a separate tab. It becomes a capability inside
the selected trainer's profile/list view.

## Discovery modes are separate products

These operations must not be conflated in UI, implementation, or security
design.

| Operation | Initial global release | Data needed | Expected implementation |
|---|---|---|---|
| Search for a trainer by name | **Include** | Minimal public trainer directory | Exact and prefix search over normalized trainer handles |
| View one trainer's public list | **Include** | One sanitized public profile/list snapshot | Fetch and subscribe only to the selected trainer |
| Compare two users' lists | **Include** | Signed-in user's local/owned lists plus one selected public list | Pairwise client-side comparison |
| Find trainers who have one Pokemon | **Defer** | A Pokemon-to-trainer index or bounded server query | Dedicated indexed feature; never scan every public list in the browser |
| Automatically find all matches globally | **Defer** | Materialized match/search indexes and ranking | Server-maintained/indexed feature with limits, privacy rules, and abuse controls |

### Trainer-name search

Trainer search should query a small directory containing only public identity
metadata. It must not download profiles or Pokemon lists for every user.
Initial search can support normalized exact and prefix matching. Fuzzy search,
recommendations, and broad discovery are later product decisions.

### Individual public profile/list

Selecting a result loads exactly one trainer's public projection. The view may
show their public profile, wanted lists, available/for-trade list if that list
is introduced, list freshness, and explicitly public contact fields.

The browser may attach a real-time listener while that profile is open. It
should detach the listener when the user leaves the profile.

### Pairwise comparison

For signed-in viewer A opening trainer B:

- **They have what I want:** intersection of B's public available list and A's
  wanted list.
- **I have what they want:** intersection of A's available list and B's public
  wanted list.
- **Mutual opportunities:** both directions have at least one candidate and
  can be shown together as a possible trade conversation.
- **Search strings:** generated from the relevant subset of A or B's list,
  using the app's existing Pokemon GO string-generation rules.

This comparison is deterministic and pairwise. It does not require access to
any third trainer and does not require a global match scan.

Unauthenticated viewers may view public/unlisted lists and share links, but a
personalized comparison requires a signed-in account with a saved My List in
the initial release. Anonymous browser-local comparison is deferred.

### Pokemon-based global discovery

“Show everyone who has Bouffalant” is explicitly deferred. If added later, it
requires a bounded, purpose-built reverse index such as:

```text
publicPokemonIndex/{pokemonKey}/{uid}: compact public-list metadata
```

That index would be maintained when a trainer publishes a list, queried with
pagination/limits, and protected by visibility and abuse controls. The client
must never implement this by downloading all public lists or rendering an
unbounded username collection beside a Pokemon.

### Automatic global matching

Automatic “best matches for me” is a separate later service. It needs an
explicit ranking definition, server-maintained indexes or jobs, privacy
controls, pagination, stale-index handling, and operational monitoring. It is
not required to prove the global trainer-directory product.

## Identity model

Pokemon GO trainer names are useful public handles, but they are not permanent
account identifiers: Niantic allows a limited number of trainer-name changes.
The global architecture therefore uses:

- **Firebase Auth UID:** immutable internal account identity and rule subject.
- **Trainer name:** unique-at-claim-time, mutable public handle and display
  identity.
- **Normalized trainer handle:** separately stored lookup key for exact/prefix
  search and uniqueness enforcement inside this app. Store both `trainerName`
  (display spelling) and `normalizedTrainerName` (comparison/reservation key).
- **Stable share ID:** durable link target that survives trainer-name changes.

Google or Discord authentication proves control of the provider account, not
ownership of a Pokemon GO trainer name. Trainer-name claim, conflict, rename,
recovery, and impersonation-reporting policies must be defined before
self-service global registration.

Existing users should link a new provider to their existing Firebase Auth user
where possible so their UID and data ownership remain intact. A Google-first
sign-in must not silently create a second app account for an existing trainer.

### Trainer-name claim policy

The initial global release may use self-service trainer-name claims; it does
not require owner approval for every registration. Existing migrated users
retain priority over the trainer names already associated with their accounts
and do not need additional Pokemon GO ownership verification. Self-service
claims need the following protections:

- The candidate normalization policy trims leading/trailing whitespace,
  applies Unicode normalization, and compares case-insensitively while
  preserving the user's original capitalization in `trainerName`. It must not
  silently remove, collapse, or transform internal characters unless the final
  policy is required by actual Pokemon GO trainer-name rules. The exact
  normalization algorithm remains provisional until fixture testing is
  complete.
- Reserve exactly one normalized trainer handle per active account and exactly
  one active account per normalized handle.
- Claim or rename the handle through one atomic transaction/trusted operation
  that fails if another UID owns the normalized key. Do not rely on a
  read-then-write sequence from the browser.
- Seed existing users into the handle index before opening self-service claims.
  Existing valid username-to-UID associations have priority. Produce a
  collision report for any current names that normalize to the same key and
  resolve those exceptions before launch.
- New accounts may build a private list before verification. A verified email
  address or verified Google account is required before the profile can become
  searchable/public. Do not add an account-age delay unless observed abuse
  justifies one.
- During Google/email migration, link the new credential to the currently
  signed-in Firebase user whenever possible. Before creating a new account,
  check for an existing provider credential, UID binding, legacy username
  binding, and normalized-handle claim. Never merge or overwrite automatically
  when those signals disagree.
- Permit trainer-name changes, but use a cooldown (initial recommendation: 30
  days) and retain an internal audit history. Keep the old public handle as a
  redirect/reservation during an anti-impersonation window (initial
  recommendation: 90 days) rather than making it immediately claimable.
- Treat inaccessible accounts as account-recovery cases, not abandoned-name
  opportunities. Routine recovery relies primarily on the linked
  authentication provider. Exceptional review may consider access to a
  previously linked provider, former username/PIN credentials for migrated
  accounts, account creation/migration records, previously generated recovery
  information, prior list/profile history, and other non-public account
  metadata. A screenshot or public Pokemon GO profile alone is never enough to
  transfer a handle.
- Provide an impersonation-report path and a private manual-review state. A
  review may freeze handle changes without exposing or deleting either account
  and must leave an admin audit trail; it must not automatically transfer the
  handle to the reporter.
- Rate-limit claim, rename, recovery, and report attempts. Firebase rules can
  enforce ownership and uniqueness but cannot provide a complete abuse-review
  workflow; a trusted backend may eventually be required.

The exact allowed trainer-name character set and internal-character behavior
must be confirmed against Pokemon GO rules and legacy fixtures before
implementation. Normalization must be tested with case, outer spacing,
Unicode, punctuation, and legacy names so it does not collapse distinct
accounts silently.

### Current trainer-name normalization audit

A read-only audit of the production `loginDirectory` on 2026-08-03 found 35
current trainer names. Under the candidate comparison transform
`trim -> NFKC -> toLowerCase`:

- **0 normalized collisions** were found.
- **0 names** contained leading or trailing whitespace.
- **0 names** changed under NFKC normalization.

This clears the current dataset for continued design work, but it does not
finalize the algorithm. The implementation must preserve the current names only
in a git-ignored local audit report and use synthetic tracked fixtures for
punctuation, Unicode, case, spacing, and provider-migration collision tests.
Tracked documentation records counts/results rather than publishing the private
directory.

The Commit 3 audit helper now makes that provisional transform executable and
testable without using it in the application. `toLowerCase()` means ECMAScript's
locale-independent Unicode lowercase mapping; it is deterministic across app
and Node usage but is not the Unicode Default Case Folding algorithm. The helper
does not strip punctuation, collapse internal whitespace, transliterate, or
merge visually similar characters from different scripts. The original input,
trimmed display value, NFKC value, and normalized comparison key are retained as
separate audit fields so later migration review can detect every transformation.

`npm run audit:trainer-names` defaults to the tracked synthetic fixture and
writes a detailed, machine-readable JSON report under the git-ignored
`.local/trainer-name-audits/` directory. Emulator reads require an explicit
loopback database URL and project ID. A production read additionally requires
all of the following: `--source production`, `--allow-production-read`, an HTTPS
Firebase database URL, matching `--project-id`/`--confirm-project` and
`--database-id`/`--confirm-database` values, and the name of a non-empty auth
token environment variable via `--auth-token-env`. The command performs only a
GET of `loginDirectory.json`; it has no Firebase migration or reservation write
path. Console output contains aggregates and hashed collision IDs only. The
local report contains trainer names and must not be committed or pasted into
tracked documentation.

Example fixture audit:

```sh
npm run audit:trainer-names
```

Example production shape (values intentionally illustrative):

```sh
TRAINER_AUDIT_TOKEN='<short-lived Firebase ID token>' npm run audit:trainer-names -- \
  --source production \
  --allow-production-read \
  --database-url https://PROJECT-default-rtdb.firebaseio.com \
  --project-id PROJECT \
  --database-id PROJECT-default-rtdb \
  --confirm-project PROJECT \
  --confirm-database PROJECT-default-rtdb \
  --auth-token-env TRAINER_AUDIT_TOKEN
```

The later migration commit may consume a reviewed local JSON report as dry-run
input, but that consumer and every handle-reservation write remain separately
scoped and separately approved.

## Conceptual Firebase model

This is a target model for design discussion, not an approved migration or
literal schema commitment.

```text
accounts/{uid}
  trainerName
  normalizedTrainerName
  status
  createdAt

trainerHandles/{normalizedTrainerName}
  uid
  displayName
  shareId

privateProfiles/{uid}
  private settings and recovery metadata

publicProfiles/{uid}
  trainerName
  avatarPokemon
  bio
  explicitly public contact fields
  visibility
  updatedAt

publicLists/{uid}
  wishlist
  dynamax
  gmax
  costumes
  forTrade/{pokemonKey}
    variant and attributes
    public note
    optional publishedQuantity
  updatedAt

publicShares/{shareId}
  allowlisted public profile/list projection
  updatedAt

legacyUsernameIndex/{username}
  uid

handleReviews/{normalizedTrainerName}
  private recovery/impersonation review state and audit metadata
```

### Profile and contact visibility policy

New profiles default to **Private** until setup is complete and the user
explicitly publishes them. Available profile modes are:

- **Public:** present in trainer search and viewable by anyone.
- **Unlisted:** omitted from trainer search but accessible through a stable
  share link.
- **Private:** owner-only.

Profile visibility does not automatically publish account or contact fields.
Friend code, Discord username, email address, and any future contact field each
have their own visibility value:

- **Private:** owner-only and the default.
- **Unlisted:** included only in the user's unlisted share projection.
- **Public:** included in public profile and public share projections.

Authentication email addresses are private account credentials. They must
never enter public or unlisted profile projections automatically. If the app
later lets a user publish a contact email, it should be a separately entered or
separately consented contact field, not an implicit copy of the Firebase Auth
email.

Public projections must be built from explicit allowlists. Directory entries,
public profiles, and unlisted share snapshots are separate projections so an
unlisted contact choice cannot leak through trainer search.

The initial public `forTrade` projection may expose Pokemon variants,
attributes, and user-entered trade notes. Inventory quantities remain private
by default. A future explicit quantity-sharing preference may populate a
separate `publishedQuantity`; it must never expose or alias the raw legacy
Inventory record.

Existing username-keyed data remains authoritative during migration. No
destructive root rewrite is part of Phase 0.

## Read and subscription model

The global application must not preserve the current broad-subscription shape.
Initial reads should be limited to:

1. The signed-in user's private account and owned lists.
2. A bounded trainer-directory search result.
3. The one selected trainer's public projection.
4. Public event data.

Opening another profile replaces or adds one bounded public-list listener.
Closing the profile detaches it. Strings and pairwise matching operate on the
two already-loaded list snapshots.

Anonymous visitors may open public profiles, unlisted share links, and the
published trade lists available through those views. They do not receive a
personalized pairwise comparison because they have no saved My List. Pairwise
comparison is initially a signed-in feature and reads only the viewer's owned
lists plus the selected trainer's public projection; neither user's private
records are exposed to the other.

Anonymous browser-local list comparison is deferred from the initial release.
It can be reconsidered later if real demand justifies the added persistence,
privacy, and UX surface.

This model is a prerequisite for removing the current root authenticated-read
rule safely. UI filtering is not database security.

## Existing feature disposition

### Keep and adapt

- My List editing, priorities, modifiers, notes, bulk add, exports, and public
  share links.
- Strings generation.
- Pairwise Compare/Trade Match, moved into a selected trainer profile.
- Public profile and trainer-list view.
- Special Trade Board if its public/private fields are explicitly defined.
- Event fetching, event classification, and event display.

### Replace

- Current Pokemon-first Browse becomes trainer-first **Find Trainer**.
- Current Schedule tab becomes read-only **Events**.
- Community switcher and community-scoped discovery become unnecessary in the
  target global UI after a separately approved migration and rollback period.
- Existing community records become archived legacy metadata during that
  period. Community membership is not part of global-list authorization.
  Optional groups/clubs may be designed later as an independent feature.

### Preserve but remove from primary navigation

- Existing inventory (`have`) records.
- Offers, pending decrements, reservations, and personal scheduled trades.
- Existing community and membership records.

These records must not be deleted as part of a navigation change.

## Inventory preservation strategy

The current `have` path is the Inventory system; there is not yet a separate
lightweight public “Have” list. Inventory also drives offers, accepted-trade
reservations, pending quantity reconciliation, and parts of Schedule.

Recommended retirement sequence:

1. Export and verify an owner backup.
2. Stop new inventory/offer/schedule onboarding before hiding the tabs.
3. Remove Inventory and personal Schedule from primary navigation.
4. Preserve existing records unchanged during a documented retention window.
5. Provide affected users with a read-only Legacy Inventory view and export.
6. Offer an explicit, previewable conversion into a future public `forTrade`
   list; never publish quantities or modes automatically.
7. Stop broad `have`, `offers`, and `trades` subscriptions only after all UI
   dependencies are disabled or replaced.
8. Archive or delete legacy data only through a separately approved process
   after user communication, export verification, and rollback planning.

### Recommended retention timeline

- **Retirement date through day 90:** rollback window. Keep Inventory, Offers,
  Trades, Schedule-related records, communities, and existing share records in
  their current live paths without destructive migration. Legacy features may
  be hidden only after dependent subscriptions are stopped safely.
- **Day 91 through month 12:** read-only legacy-access period. Existing
  inventory users retain Legacy Inventory access and export. No automatic
  conversion occurs. Existing share links remain supported or redirect to the
  new stable share identity where practical.
- **Month 9:** notify affected users of the planned active-database archive and
  provide a fresh export reminder.
- **Month 12:** generate and verify an owner backup plus per-user legacy
  exports, record counts/checksums, then remove retired records from active
  subscriptions and only later from active database paths through a separately
  approved migration.
- **Months 12 through 15 (approximately 90 days):** retain the verified owner
  backup outside active Firebase paths only for migration verification. Do not
  expose it through the app.
- **Around month 15:** delete that backup unless an unresolved support request
  or documented requirement justifies a specific extension. Record aggregate
  migration counts/checksums, not private record contents, in the permanent
  maintenance log.

Users must receive clear retirement notices and an easy export before active
records are removed. No removal occurs without a separately approved runbook,
verified owner backup, per-user exports, record counts/checksums, and rollback
criteria.

Public share data is different from retired operational data: preserve working
links where reasonably possible, migrate them to stable share IDs, and use
redirect/lookup compatibility rather than deleting them on the Inventory
retention schedule.

## Security implications and sequencing

The product pivot changes which rule investments are worthwhile:

1. Close concrete authorization weaknesses in the current live system even if
   the affected community feature may later be retired.
2. Audit the existing public-share allowlist and add explicit contact-field
   consent before global search exposes profiles broadly.
3. Make UID the rules identity; do not authorize writes by mutable trainer
   names or client-writable role/profile fields.
4. Replace broad top-level subscriptions with owned and selected-public reads.
5. Test the new rule model with anonymous, owner, ordinary authenticated, and
   admin identities before removing the root read grant.
6. Keep only deliberate directory and public-list projections anonymously
   readable.

Do not perform a large community-rule redesign solely to support a system the
target product may retire. Do not postpone concrete current privilege fixes
while the product design is being decided.

## Firebase free-tier viability

### Confirmed Firebase limits

The following are platform limits documented by Firebase as of the date of
this plan. They must be rechecked before launch because pricing and quotas can
change.

| Product / quota | Confirmed no-cost limit relevant here |
|---|---|
| Realtime Database Spark simultaneous connections | 100; one browser tab/device connection generally counts as one connection |
| Realtime Database Spark stored data | 1 GB |
| Realtime Database Spark downloads | 10 GB/month |
| Realtime Database single response | 256 MB maximum (not a sensible app payload target) |
| Firebase Hosting storage | 10 GB no-cost |
| Firebase Hosting transfer | 10 GB/month no-cost |
| Firebase Authentication with Identity Platform, Spark, common email/social/custom providers | 3,000 daily active users |
| Firebase Authentication with Identity Platform, Spark, SAML/OIDC | 2 daily active users |
| Firebase Authentication Spark email-link sign-in messages | 5 emails/day |
| Firebase Authentication Spark password-reset messages | 150 emails/day |

The app is currently served by GitHub Pages, so Firebase Hosting quotas do not
apply unless hosting is moved to Firebase. Realtime Database and Authentication
limits still apply.

Base Firebase Authentication and upgraded Firebase Authentication with
Identity Platform have different quotas. Google and standard email sign-in can
be evaluated without choosing Discord. A straightforward Discord/OIDC route
would require Identity Platform, where the Spark OIDC allowance is not viable
for a public app; Discord therefore needs a separately costed Identity Platform
or custom-auth/backend decision and is deferred from the first provider phase.

Official references used for this checkpoint:

- [Realtime Database limits](https://firebase.google.com/docs/database/usage/limits)
- [Realtime Database usage and billing](https://firebase.google.com/docs/database/usage/billing)
- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)
- [Firebase Authentication and Identity Platform usage](https://firebase.google.com/docs/auth)
- [Firebase Hosting usage, quotas, and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)

### Workload comparison

| Flow | Free-tier characteristics | Likely bottleneck |
|---|---|---|
| Current broad/root subscriptions | Every signed-in client downloads multiple whole top-level trees; edits can rebroadcast large snapshots to every connected client | Download bandwidth and client work grow rapidly with users/activity; 100 concurrent connections remains a hard Spark ceiling |
| Trainer-name search | One small, bounded directory query; normalized key search needs no list downloads | Abuse/query volume if blank or unbounded searches are allowed |
| One public profile/list | One compact snapshot fetched on selection | Payload size and repeated profile opens; manageable with strict targets |
| Pairwise comparison | Computed locally from My List plus the selected public list | CPU is minor; normally no additional database read |
| Real-time selected-profile listener | Keeps one connection open and redownloads the changed listened-at snapshot when it changes | 100 simultaneous Spark connections first; bandwidth if listeners attach too high in the tree or remain alive |
| Future Pokemon-wide index | Bounded reads can be efficient, but every published list change may update many reverse-index entries | Write amplification, index storage, integrity, pagination, and likely trusted server maintenance |

### Rough app-specific estimates

These are planning estimates, not Firebase guarantees:

- Target a complete public profile plus published lists at **25-75 KB** for a
  typical trainer and enforce an initial hard review threshold at **100 KB**.
- At 50 KB per selected profile, 1,000 daily users opening five uncached
  profiles each would download roughly 250 MB/day before protocol overhead,
  or roughly 7.5 GB over 30 days. Directory reads, repeat real-time updates,
  and the signed-in user's own data could push that near the 10 GB/month Spark
  allowance. Caching and lower average use may extend the range; active profile
  editing and repeated uncached views reduce it.
- One gigabyte of database storage could hold many thousands of compact public
  profiles/lists at these targets. Active operational history, duplicated
  indexes, and legacy archives should not be allowed to accumulate in the same
  client-readable tree indefinitely.
- The **100 simultaneous connection** limit is likely to arrive before storage.
  Total registered users or monthly visitors can be much larger than 100, but
  a successful global app can cross 100 concurrent open tabs surprisingly
  early. Concurrency must be monitored, not inferred from registrations.
- The current root-subscription model can exhaust bandwidth at a much smaller
  audience because each session downloads broad shared state and each edit may
  fan out. The trainer-first model changes cost toward roughly “my data plus
  profiles I deliberately open,” which is the key free-tier improvement.

### Required safeguards

- Require at least 2-3 normalized characters before trainer search; never load
  a blank global directory.
- Debounce search input (initial target: 250-350 ms), use normalized prefix
  queries, return at most 20 results initially, and paginate with a cursor.
- Keep directory rows minimal: normalized/display handle, UID or opaque stable
  public ID, small avatar reference, visibility, and freshness only.
- Never include Pokemon lists in trainer-directory results.
- Fetch one selected public profile/list at a time. Maintain at most one remote
  profile listener per view and detach it on navigation, logout, visibility
  change, or timeout.
- Listen at the narrowest stable path. Do not attach `onValue` to all
  `publicLists`, all users, or the database root.
- Cache public snapshots by stable share ID plus `updatedAt`; use a short
  freshness policy and avoid refetching an unchanged profile during one
  session.
- Enforce payload budgets in tests and Health Check. Warn at 75 KB and block or
  redesign fields that push a public projection beyond 100 KB without an
  explicit decision.
- Add App Check where compatible, input validation, claim/rename cooldowns,
  bounded queries, and report throttling. Public data remains scrapeable by
  definition; App Check and obscurity do not replace a privacy decision.
- Monitor Realtime Database connections, storage, downloads, authentication
  quotas, and database load in Firebase/Google Cloud. Initial warning triggers:
  investigate sustained or repeatedly spiking connections near 50, prepare a
  plan by 75, investigate at 5 GB monthly downloads, and review active storage
  at 500 MB.
- Set usage and budget alerts before enabling any Blaze-dependent backend.
  Budget alerts are notifications, not spending caps.
- Keep exact/prefix trainer search and pairwise comparison client-side/on RTDB
  initially. Fuzzy global search, Discord custom auth, abuse adjudication,
  Pokemon reverse indexing, or automatic matching may require Cloud Functions,
  Identity Platform, or another trusted server and therefore a billing/design
  decision.

Do not upgrade to Blaze based on registered-user count alone. Decide from
actual monitored connection/download/authentication pressure or a concrete
need for server-side indexing/background functions. The bounded-read client
architecture remains required on both Spark and Blaze; billing is not a reason
to restore broad subscriptions.

## Proposed delivery phases

### Phase 0 - Product, identity, privacy, and migration decisions

- Approve trainer-first discovery and the initial-release boundary.
- Decide visibility defaults and contact-field privacy.
- Decide trainer-name claim, rename, conflict, and recovery policies.
- Approve UID as durable identity and trainer name as mutable handle.
- Inventory current users/data and define legacy retention/export policy.
- Reconcile the existing Google-auth plan with this UID-centered model.
- Produce a Firebase read/write access map before changing root read rules.

### Phase 1 - Immediate security containment

- Harden current owner/admin authorization.
- Verify public-share payload privacy.
- Add Firebase Rules Emulator coverage before broader rule changes.

### Phase 2 - Global directory and one-profile reads

- Add visibility settings and normalized trainer-handle lookup.
- Preserve existing links while introducing stable share IDs.
- Fetch and subscribe to one selected public profile/list.
- Keep the existing community experience available as a rollback path.

### Phase 3 - Pairwise profile comparison

- Move Compare/Trade Match into the selected trainer profile.
- Highlight both trade directions and mutual opportunities.
- Generate comparison-specific search strings.
- Add exact pairwise fixtures and browser smoke coverage.

### Phase 4 - Authentication migration

- Let existing PIN users link Google to their current Firebase account.
- Add conflict handling and account recovery before new Google-first signup.
- Keep PIN login during a documented transition period.
- Evaluate email-link/password and Discord separately; do not bundle all
  providers into the first auth implementation.

### Phase 5 - Navigation and legacy-feature retirement

- Replace Browse with Find Trainer.
- Replace Schedule with Events.
- Hide Inventory/Offers from primary navigation.
- Preserve and export legacy inventory, offer, trade, and community records.
- Stop obsolete subscriptions after dependent behaviors are disabled.

### Phase 6 - Rule cutover and global launch

- Remove the root authenticated read only after the new client read model is
  deployed and tested.
- Enforce UID-owned private records and allowlisted public projections.
- Run migration QA, emulator rule tests, deployed smoke, privacy review, and a
  staged rollout with rollback criteria.

Pokemon-based global discovery and automatic global matching remain deferred
beyond these phases unless a separate indexed design is approved.

## Cross-cutting engineering requirements

These are acceptance criteria for every remaining global-app commit, including
temporary compatibility work.

### Modularity and maintainability

- Separate domain logic, validation, data access, Firebase integration,
  presentation, and feature-flag behavior.
- Put new functionality in focused modules under clear boundaries such as
  `js/domain`, `js/data`, `js/services`, and `js/ui` when reasonable. Do not
  continue expanding monolithic `index.html` feature logic by default.
- Reuse canonical trainer-name normalization, projection, visibility, privacy,
  and validation logic rather than duplicating it at call sites.
- Use explicit interfaces and predictable success/error shapes. Avoid hidden
  mutable-global dependencies and flag any proposal that materially increases
  coupling or global state.
- Add unit tests for domain logic, emulator/integration tests for Firebase
  contracts, and browser tests for user-visible workflows.
- Record phased technical debt with its compatibility purpose, owner, removal
  gate, and test coverage.

### Internationalization readiness

- Centralize new user-facing strings behind stable translation keys and locale
  catalogs. English is the fallback catalog; planned catalogs include `en`,
  `ja`, `es`, and `de`, with future locales requiring data rather than an
  architectural rewrite.
- Do not hardcode user-facing text in domain, validation, data-access, or
  Firebase modules. Use complete translated templates with placeholders rather
  than concatenating translated fragments.
- Keep database keys, normalized trainer handles, identifiers, and stored enum
  values locale-independent. Translate enums only in the presentation layer.
- Use `Intl` for dates, times, numbers, and relative-time output. Do not rely on
  capitalization for semantics or UI behavior.
- Treat localized Pokemon names separately from general interface translation;
  localized display names must not replace canonical Pokemon keys.
- Design controls and layouts for longer labels and different writing systems.

The actual locale-catalog foundation must land before substantial Settings,
privacy, profile, or Find Trainer UI. Commit 4 remains schema/rules tooling only
and does not introduce a partial localization framework.

## Proposed small implementation commits

Each commit has its own approval, tests, and rollback point. Path names remain
conceptual until the preceding schema/rules review approves them.

### 1. Add a Firebase Rules Emulator security baseline

- **Purpose:** encode current owner/admin/member/anonymous permissions and
  reproduce the known community authorization weakness before changing rules.
- **Likely files:** `firebase.json`, a checked-in rules source, package scripts,
  focused emulator tests, and security docs. No production data change.
- **Firebase paths covered:** `admins`, `users`, `authIndex`, `communities`,
  `userCommunities`, `communityRequests`, `publicShares`.
- **Tests/rollback:** emulator denies/permits an explicit identity matrix;
  current app smoke stays green. Roll back the test tooling only if it affects
  the static deployment; do not loosen rules to satisfy a failing test.

### 2. Fix the existing community authorization vulnerability

- **Purpose:** stop community writes from trusting a mutable username or a
  client-writable `users/{username}/isOwner` value. Authorize with a protected
  UID-based admin/owner authority and verify the production owner UID exists
  before deployment.
- **Likely files:** canonical Firebase rules source, `SECURITY-RULES.md`, rules
  emulator tests, and maintenance log. App code changes only if a current owner
  operation reveals an explicit rules-contract mismatch.
- **Firebase paths changed:** write rules for `communities/{communityId}`,
  `userCommunities/{uid}/{communityId}`, and
  `communityRequests/{communityId}/{requestId}`; protected authority under
  `admins/{uid}` or a separately approved UID-owned owner path.
- **Tests/rollback:** ordinary users, forged usernames, and forged `isOwner`
  values are denied; the verified owner/admin remains allowed. Export rules,
  deploy in a narrow window, run owner community-tool QA and deployed smoke,
  and restore the previous rules only from a saved version if legitimate owner
  operations fail.

**This is the point where the current community authorization vulnerability is
fixed. It should land after the emulator baseline and before global identity or
public-directory implementation.**

### 3. Add pure trainer-name normalization and migration-audit tooling

- **Purpose:** implement the still-provisional normalizer as a pure helper,
  lock all 35 current names as private migration fixtures, and generate a
  collision report without writing Firebase.
- **Likely files:** one domain helper, Node check script/tests, package script,
  and docs. No UI or production rules.
- **Firebase paths read:** migration tooling may read `loginDirectory`, `users`,
  and `authIndex` through an explicitly read-only/admin export; writes: none.
- **Tests/rollback:** exact casing, outer whitespace, Unicode, punctuation,
  collision, and invalid-value fixtures. Rollback is removal of the unused
  helper/tooling.

### 4. Add disabled global identity/visibility schema and rules

- **Purpose:** define the UID-owned account/profile, private handle reservation,
  public projection, unlisted share, and legacy-index contract without making
  it reachable from the production client.
- **Files:** `docs/GLOBAL-IDENTITY-SCHEMA.md`, a separate emulator-only rules
  fixture/config/runner, emulator tests, package script, and maintenance log.
  `index.html`, deployed rules, and Firebase app configuration are excluded.
- **Firebase paths modeled but not deployed or seeded:** `accounts/{uid}`,
  `trainerHandles/{normalizedTrainerName}`, `privateProfiles/{uid}`,
  `publicProfiles/{uid}`, `publicLists/{uid}`, `unlistedShares/{shareId}`,
  private `unlistedShareOwners/{shareId}`, `legacyUsernameIndex/{username}`, and
  `globalIdentityConfig/writesEnabled`.
- **Tests/rollback:** writes fail when the flag is missing/false; emulator-only
  flag-on tests cover uniqueness, ownership, visibility, and projection
  allowlists. A characterization test proves authenticated root reads still
  expose private candidate paths. The candidate is unsafe to deploy until root
  read removal. Rollback is deletion of unused test/docs files only.

### 5. Build a completely local UID/handle migration dry-run

- **Purpose:** reconcile `loginDirectory`, `users`, `authIndex`, protected
  `admins`, and a separate sanitized Auth export before any rules cutover or
  production write. The result is a review report, not a migration manifest.
- **Files:** read-only local migration script, synthetic fixtures/tests,
  git-ignore rules, runbook, and aggregate documentation.
- **Firebase paths changed:** none. Production output is a private local report;
  no reservation, account, index, rename, or migration write exists.
- **Tests/rollback:** conflict-first classification, absent/incomplete Auth,
  protected-admin review, inactive/orphan records, deterministic source hashes,
  aggregate-only output, private report permissions, exactly four production
  GETs, target mismatch denial, token redaction, and proof that no seed-capable
  output exists. Every record remains `seedEligible: false`; rollback removes
  the unused local tool.

The detailed contract and sanitized Auth schema are in
`docs/UID-HANDLE-DRY-RUN.md`. Public shares, communities, lists, inventory, and
prior profile publication are excluded as identity or consent signals. A later
seeding step must re-read and revalidate an explicitly reviewed subset after
private-path isolation is live; the dry-run report is never permanent authority.

### 5a. Add local-only conflict diagnostics and private review

- **Purpose:** organize source-by-source evidence for duplicate/multi-UID,
  mismatched, protected-admin, and unassociated-Auth records without deciding
  ownership or producing repair instructions. Clean missing `authIndex`
  records remain passive-login candidates under the deployed UID-bound login
  flow.
- **Files:** pure domain diagnostics, local-only source reader, private review
  reporter, thin CLI, focused tests, and documentation. `index.html` and active
  Firebase configuration are excluded.
- **Firebase paths changed:** none. The CLI accepts only local fixture or
  git-ignored private files and has no network or production mode. A fresh
  production source collection requires separate approval.
- **Tests/rollback:** candidate-UID evidence, protected/manual handling,
  disposition labels, source-hash staleness, aggregate-only console output,
  private path and `0600` enforcement, rejected unapproved roots/options, and
  proof that no ownership decision, seed manifest, write payload, or executable
  repair command exists. Rollback removes the unused offline tooling.

After this small diagnostic milestone, client read/subscription work in step 6
is the next major engineering priority. No admin repair UI or production
identity cleanup is implied by the review artifact.

### 6. Eliminate client dependence on global subscriptions

- **Purpose:** replace root/global listeners with bounded current-user,
  one-profile, public projection, event, and explicitly retained legacy reads.
  UI changes stay behind disabled flags where a production surface is not ready.
- **Likely files:** `index.html`, subscription-focused tests, Playwright smoke,
  scaling/security docs, and maintenance log.
- **Firebase paths read:** current legacy paths during transition, one exact
  trainer/list at a time, and explicit public/event paths. No new identity data
  is written.
- **Tests/rollback:** listener inventory/counts, cleanup on navigation/sign-out,
  payload targets, current production behavior with flags off, and deployed
  smoke. Roll back the client commit if existing users lose required reads.

### 7. Prepare and test narrow-read production rules

- **Purpose:** remove the authenticated root grant in a candidate and enumerate
  every current-client read explicitly, including temporary legacy allowances.
- **Likely files:** a separate rules candidate, emulator fixtures/tests,
  `SECURITY-RULES.md`, rollout/rollback runbook, and maintenance log.
- **Firebase paths changed in the candidate:** root `.read`, owner-owned current
  records, explicitly retained legacy/public/event reads, and the new identity
  contract. No production data changes.
- **Tests/rollback:** full anonymous/owner/other/admin matrix, legacy-client
  compatibility, public-share behavior, and proof that proposed private paths
  deny cross-account reads. Do not publish until all active client reads are
  represented.

### 8. Deploy narrow reads and verify private-path isolation

- **Purpose:** publish the reviewed narrow-read rules before any global identity
  record exists, then prove the privacy boundary with minimal production smoke.
- **Likely files:** deployment evidence and maintenance log only after approval.
- **Firebase paths changed:** rules only; no identity or handle records seeded.
- **Tests/rollback:** owner and ordinary login/edit smoke, public share smoke,
  exact private cross-account denial, browser error review, and saved-rule
  rollback. Any blocked legitimate current-client read or private-path exposure
  is a stop/rollback trigger.

### 9. Seed existing UID/handle mappings after the isolation gate

- **Purpose:** reserve existing trainers and preserve existing-user priority
  only after narrow rules have been live and private-path isolation is proven.
- **Likely files:** separately reviewed idempotent migration script, private
  manifest/report, runbook, and maintenance log.
- **Firebase paths written:** `accounts/{uid}`,
  `trainerHandles/{normalizedTrainerName}`, and
  `legacyUsernameIndex/{username}` only. Existing users/lists are not rewritten.
- **Tests/rollback:** local dry-run approval, zero unresolved collisions, exact
  record counts/checksums, write manifest, idempotent rerun, owner backup, and
  delete-only-new-keys rollback. This is a separate approval from Commit 5.

### 10. Establish module boundaries and the locale-catalog foundation

- **Purpose:** create the minimal global-feature service/data/UI boundaries and
  translation-key/catalog loader before building substantial profile-facing UI.
- **Likely files:** focused `js/services`, `js/data`, and `js/ui` modules, locale
  catalogs beginning with English plus fallback tests, script-load wiring,
  architecture docs, and maintenance log.
- **Firebase paths changed:** none. This milestone defines interfaces and UI
  text plumbing; it does not read or write global identity records.
- **Tests/rollback:** module dependency/load-order checks, fallback/missing-key
  behavior, placeholder formatting, locale-independent enum assertions,
  representative Japanese/Spanish/German fixture strings, responsive layout
  smoke, and flag-off behavior. Rollback removes unused modules/catalogs.

### 11. Add Settings visibility/contact controls behind the disabled flag

- **Purpose:** let a user complete setup privately and explicitly choose profile
  and per-contact visibility. Publishing requires verified email or Google.
- **Likely files:** `index.html`, focused browser tests, rules tests, docs.
- **Firebase paths changed:** owned settings under `privateProfiles/{uid}` and
  allowlisted projections under `publicProfiles/{uid}`/`publicLists/{uid}`.
- **Tests/rollback:** private default, independent contact visibility,
  authentication email never projected, unverified users cannot publish, and
  deployed smoke. Flag-off rollback restores the previous UI immediately.

### 12. Link Google credentials to existing accounts behind an auth flag

- **Purpose:** provider-link existing users before allowing Google-first account
  creation, preserving UID, handles, lists, and memberships.
- **Likely files:** auth code in `index.html`, `docs/AUTH-PLAN.md`, rules/tests,
  and migration/support runbooks.
- **Firebase paths changed:** owned provider metadata in `accounts/{uid}` and
  existing auth indexes only where the approved migration requires it; public
  profile data does not receive auth email.
- **Tests/rollback:** existing-account link, duplicate-provider/handle conflict,
  cancelled flow, orphan prevention, PIN fallback, and staged test-account QA.
  Keep the auth flag off and unlink only test credentials on rollback.

### 13. Add Find Trainer and one-profile reads behind the global flag

- **Purpose:** bounded exact/prefix directory search and one selected public
  profile/list listener; no Pokemon-wide discovery.
- **Likely files:** `index.html`, focused domain/UI helpers if justified,
  Playwright tests, rules/index docs.
- **Firebase paths read:** `trainerHandles` or a minimal public directory,
  `publicProfiles/{uid}`, `publicLists/{uid}`, `publicShares/{shareId}`.
- **Tests/rollback:** minimum query length, result cap/pagination, private and
  unlisted exclusion, listener cleanup, payload budget, anonymous share access,
  and deployed smoke. Disable the flag to restore the old navigation.

### 14. Add pairwise matching inside a selected profile

- **Purpose:** compare the signed-in user's owned list with exactly one public
  list and generate relevant search strings.
- **Likely files:** `index.html`, pure comparison fixtures/helpers, Playwright
  tests, maintenance log.
- **Firebase paths read:** viewer-owned legacy/new list paths plus one selected
  `publicLists/{uid}`; writes: none.
- **Tests/rollback:** both match directions, mutual opportunities, modifiers,
  privacy boundaries, anonymous sign-in prompt, and deployed smoke. Remove the
  profile comparison entry point without touching data.

### 15. Retire primary Inventory/Schedule/community navigation behind flags

- **Purpose:** expose read-only Legacy Inventory/export and Events while
  stopping obsolete subscriptions only after dependent UI is disabled.
- **Likely files:** `index.html`, smoke tests, retirement docs/runbook.
- **Firebase paths:** legacy `have`, `offers`, `trades`, `pendingDecrements`,
  `communities`, and `userCommunities` remain untouched during the 90-day
  rollback window; subscriptions are narrowed/removed in measured steps.
- **Tests/rollback:** legacy export/read access, no hidden write entry points,
  no data deletion, subscription counts, and deployed smoke. Feature flags
  restore old navigation during the rollback window.

The former combined “dry-run and seed” step is intentionally split between
Commit 5 and Commit 9. Local mapping analysis is safe before rules cutover;
production seeding is forbidden until Commit 8 has removed the authenticated
root grant and verified the proposed private paths in production.

## Genuinely unresolved questions

- What exact Pokemon GO trainer-name character rules and Unicode case-folding
  behavior should the app enforce? The current audit has no collisions, but
  synthetic and migration fixtures must settle punctuation and internal
  whitespace behavior before the normalizer is final.
- Is verified email sufficient for every searchable profile, or should Google
  be preferred/required for higher-risk actions such as handle recovery?
- Who may conduct exceptional recovery/impersonation review, what evidence is
  recorded, how long is a handle frozen, and is there an appeal path?
- If quantity publication is added later, is consent per profile, per Pokemon,
  or per entry/update, and how is stale quantity avoided?
- What calendar date starts the 90-day/12-month retirement schedule, and what
  notification channels can reliably reach affected legacy users?
- Which concrete server-side requirement (Discord/custom auth, abuse workflow,
  reverse indexing, or background publication) would first justify Blaze?

No implementation should start until the identity, visibility, security, and
migration decisions relevant to that commit have explicit approval.
