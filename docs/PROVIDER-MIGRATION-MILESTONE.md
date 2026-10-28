# Provider migration: source-only milestone

## Scope and current evidence

This branch was built in an independent clone from main `a3264ebe`, outside the
asset release worker's checkout. It selectively carries forward PR57's isolated
Discord prototype, then changes its contract; it does not merge PR57 or enable
any auth surface. No runtime HTML, application entry, service worker, frontend asset
inventory, deployed Functions export, Rules, release control, or account data
is changed. The final milestone uses a separate source-only readonly journal capture adapter; the shipped journal is restored unchanged. Package changes add local tests and the exact Firebase Auth SDK test dependency.

Current source enables Google public entry and existing-account linking.
Provider account creation remains separately gated. Existing Google linking
uses Firebase `linkWithPopup` on the current user and preserves that exact UID.
Discord is a private subject mapping/custom-auth design, not a Firebase built-in
Discord provider. It must not be inferred from `providerData` or a profile's
optional Discord handle.

Sources:

- [Current starting main](https://github.com/Doomsday126dev/trade-app/commit/a3264ebe)
- [PR57: source-only Discord prototype](https://github.com/Doomsday126dev/trade-app/pull/57)
- [Existing Google adapter](../js/services/googleAuthAdapter.js)
- [Existing account boundary](../js/domain/accountLinkingModel.js)
- [Provider identity tests](PROVIDER-IDENTITY-TEST-MATRIX.md)
- [Discord authorization code flow](https://docs.discord.com/developers/topics/oauth2)
- [Firebase custom authentication](https://firebase.google.com/docs/auth/web/custom-auth)

No AGENTS.md or `.agents/skills` directory exists in this checkout or its
workspace ancestors. Package scripts and repository auth/runbook instructions
were read. Local Codex memories directory was empty. All milestone tests use
synthetic identities. No saved real credentials were needed or read.

## Implemented here

- Server prototype exchanges a one-use state/PKCE-bound code with `identify`
  only, revokes issued provider tokens, then returns a **review**, without
  claiming the provider subject. The transient Discord username is display
  evidence only. The user can cancel a wrong account with no account mutation.
- A separate `/confirm` operation binds the review to the original browser,
  request, exact UID, lifecycle, recent authentication and account fingerprint.
  The in-memory transaction rechecks review expiry and foundation fingerprint
  while claiming both sides atomically. A lost confirmation response can retry
  the exact request within the review TTL; collisions do not mutate accounts.
- The browser validates exact callback URL, duplicate fields, response operation,
  state, expiry and opaque owner/lifecycle bindings. It scrubs callback fields
  before any operation that can fail, handles denied consent, avoids double
  submissions and never persists provider/custom tokens. A review is transient;
  reloading it requires restarting consent, without linking anything.
- Signed-out server completion rechecks signed-out authority after external
  awaits and before/after custom-token minting. The client rejects stale sessions
  before passing a custom token directly to the injected auth commit.
- Request/response bodies and outbound HTTP waits are bounded. Audit failures
  cannot change account operation outcomes.
- A reminder controller and accessible non-modal notice default off, require an
  exact opaque canary allowlist, require a ready legacy account and a usable
  configured replacement, and suppress once either Google or Discord is linked.
  Dismissal waits 30 days, including reload/navigation. Permanent opt-out is
  available. Broken storage suppresses the notice. Actions open Security for
  explicit review and carry owner/session guards; they never start OAuth.
- An offline version-1 private recovery envelope requires all 12 sections,
  includes SHA-256 integrity, rejects credential fields/unsafe JSON, and produces
  stable, additive **plans only**. Existing differences require conflict review.
  Importing permission/group/share references never applies authority. Cross-UID
  plans always require separately approved server identity recovery.

## Refined rollout sequence

1. **This milestone:** qualify the isolated source and synthetic browser preview;
   review a draft PR. PIN remains usable. Recovery code creates no live export
   and performs no imports. No bulk reminders or account changes.
2. **Durable Discord backend:** implement a dedicated private transactional store
   against the accepted authority schema, verified Firebase ID tokens/revocation,
   recent auth, App Check, secure browser binding, global abuse limits, bounded
   state TTL, review receipts, and exact mapped-UID custom tokens. Prove deny-by-
   default client isolation and concurrency against emulators. Do not transplant
   the prototype's synthetic `accounts.accountFingerprint` into production.
3. **Reviewed canary integration:** wire a new adapter into the existing linking
   controller and registry using an authoritative private external-link snapshot.
   Reuse the accepted account-sync/product boundary and owner lifecycle. Add
   provider-specific status/collision/recovery copy in every supported locale.
   PIN stays available; Google redirect remains explicitly unsupported.
4. **Approved provider testing/configuration:** provision only after exact target
   approval, then test existing dedicated canaries: Google and Discord sign-out/
   sign-in resolve the same UID; lists, Favorites, tags/groups, shared URLs,
   memberships and grants match before/after; wrong account/collision/cancel/
   blocked browser/reload/network uncertainty/account switch cause no accidental
   migration. Test desktop, mobile, PWA and provider outages. No real admin
   lists or permissions should be edited. No new OAuth grant is authorized by
   existing saved-credential login permission alone.
5. **Optional reminders:** after provider/recovery canaries and scoped plan
   approval, enable a small allowlist. Integrate the notice after accepted
   account hydration, once per owner session; dispose on auth change. Translate
   all copy, restore focus to the active product surface, verify keyboard/screen
   reader behavior, and expand only with a separate rollout decision. The local
   preference is device-scoped; cross-device reminder sync needs its own private
   reviewed schema. No automatic migration, exports, or access penalty.
6. **Provider-first registration:** enable only after the accepted handle authority,
   legacy namespace coverage/freeze certification, provider profile/public-share
   compatibility and onboarding contract are proven. Unlinked Discord identities
   currently return `onboarding-required`; that result creates nothing.
7. **Recovery fallback:** finish owner-scoped complete collection, immutable
   snapshot capture and server-authorized idempotent apply/readback before offering
   new-account recovery. Offer it only on explicit user request and proven account
   control; linked old UID is the preferred path. A downloaded file does not prove
   ownership of old handles, URLs, memberships or grants.
8. **Any PIN retirement:** separate proposal only after replacement and complete
   recovery work, rollback and support paths are verified. Review actual coverage,
   owner/admin recovery, inaccessible provider cases and communication timing.
   There is no date, automatic cutoff, deletion or credential rewrite in this code.

## Exact configuration prerequisites and approval boundary

Nothing is needed from the user to continue source work. No secret values should
be pasted into chat. These are pending future actions, **not attempted or denied**:

| Action / target | Purpose / impact | Required before execution |
| --- | --- | --- |
| Choose one managed HTTPS backend and exact callback URI, preferably staging first | The prototype is loopback-only and deliberately rejects production. A route such as `/auth/discord/callback` is a design candidate, not an approved URL. | Review host/project, routing, cookie scope and exact URI. The actual hostname is not known yet. |
| Create a dedicated Discord developer application, register that exact callback, request only `identify` | Creates a persistent provider security resource and user consent relationship. No bot, guild, email, friend, message or connection scope is needed. | Specific action-time approval identifying application owner, environment, callback and scope. |
| Store Discord client secret plus independent state/subject-hash keys in managed server secret storage | Gives the backend exchange authority and keyed subject isolation; stable subject-key versioning/rotation is required. | Approval for named secret resources and least-privilege backend access. Never put secret values in Git, Pages, logs or chat. |
| Add private transactional flow/review/rate/subject/receipt records, TTL and runtime permissions | Replaces synthetic in-memory storage; mapping and reverse claim must be atomic with accepted account/version checks. | Scoped schema/IAM/client-denial review. Existing E.1 production target is `trade-list-a4297`, database `phase-e-identity`, `us-central1`, but this milestone selects no new production store. |
| Connect verified Firebase authority/custom-token minting to a reviewed endpoint | Can create access to exact mapped UIDs. No email/name inference is permitted. | Review token verification, revocation/disabled-user checks, sign-in races, identity ownership, rate limiting, logging, TLS cookies, App Check and error handling; approve deploy target separately. |
| Owner-only canary OAuth link/grant and later rollout | Makes the first persistent real provider linkage and tests recovery. | Per-account scoped approval before consent/linking, then separate rollout approval. Existing username/PIN sign-in permission does not authorize this step. |

Current Discord discovery advertises OIDC and S256:
[authorization metadata](https://discord.com/.well-known/oauth-authorization-server),
[OIDC discovery](https://discord.com/.well-known/openid-configuration).
[Firebase OIDC](https://firebase.google.com/docs/auth/web/openid-connect) requires
Authentication with Identity Platform. Before selecting a production broker,
compare that supported route using an approved staging app; do not preserve the
old PR's OAuth-only inference. Discovery alone does not prove a working
Firebase/Discord integration. No Identity Platform upgrade, new `openid` scope,
or provider configuration is authorized or performed here.

Discord is not a built-in Firebase social provider. Enabling an invented
`discord.com` provider in the Firebase console is not a prerequisite for this
custom-token design. No provider settings or production Rules were changed.

## Integration gates that remain open

The original in-memory store remains deterministic test code. The second milestone adds a private Firestore candidate with real emulator coverage; see [the backend decision](DISCORD-BACKEND-DECISION.md) for the default architecture and verified existing targets.
A production host must serialize **all** auth commits (including cross-tab auth
changes) with the injected custom-token sign-in operation and observe lifecycle
changes before using the result. The client's `isCurrent` hook alone cannot
make Firebase's SDK commit atomic with unrelated account switches. Until that
host contract and end-to-end browser races are proven, live sign-in is blocked.

Discord unlink is deliberately unavailable: do not use Firebase `unlink` for a
private subject mapping. Implement an atomic server operation with recent
strong reauthentication, an independently verified alternate usable method,
reverse-index cleanup and exact readback. Never count a hidden/stale provider
row as usable and never remove the final method. Existing Google unlink remains
on its existing tested path.

The offline recovery format attests its inputs' declared completeness. A candidate collector and validated dry run now cover the current legacy/canonical feature set, with stable double-capture and full journal evidence; neither is enabled in production. Unsupported enabled provider/visibility/preference features fail closed pending their dedicated collectors. Its hash detects
accidental/tampered-file changes, not authenticity or account ownership. Its plan
has `automaticApply:false` and no apply adapter. It is not a finished migration
backup/import feature. Data-specific validators, version/tombstone semantics,
source/target locks, dry-run review, durable operation receipts, transactional
apply, retry after uncertain outcome, post-import equality, rollback and a
retention policy still need review and implementation before real recovery.

## Recovery inventory

Every section is mandatory, even if explicitly empty. Partial/unsupported
versions fail. Private bundles must stay private and exclude all auth secrets.

| Section | Required supported content / collection proof |
| --- | --- |
| canonicalEntities | All accepted trade entries, special-board rows, Favorites and tags, stable IDs, generations, field versions and tombstones |
| profile | Friend code, bio, Discord display label, avatar, intent declarations and supported trainer profile fields |
| legacyLists | Exact four supported legacy lists and compatibility projections, without replaying duplicate canonical data |
| favorites / tags | All UID-bound favorites, ordering, associations, tag metadata and groupings, not only the currently visible page |
| groups | Memberships, role/ownership references and group/tag associations; restoration requires authority proof |
| preferences | Supported private preferences, bounded recents/seen history and local-only display settings |
| sharing | Legacy/provider URLs, handle/share identity, publication versions, visibility and approved viewers; preserve references without automatically reassigning URLs |
| permissions | Membership/grant/role references and ownership evidence, never client-granted privileges |
| journal | Owner-partitioned pending/blocked/conflict operations and acknowledgements as evidence, never blind replay |
| migration | Migration plans/receipts, generation, completion and reviewed counters |
| recovery | Complete reviewed and unresolved retained evidence, candidate identities and resolutions |

## Local commands

```sh
npm run test:provider-migration
npm run test:provider-migration:browser
npm run test:google-provider
npm run test:account-sync
npm run check:durable-auth-readiness
npm run test:pages-release
npm run test:performance:static
npm --prefix functions run check:contract
```

The browser config serves `tests/fixtures/provider-migration-preview.html` on
loopback port 8886. It imports only the candidate UI and aborts non-loopback
requests. The fixture uses synthetic data and no Firebase/OAuth SDK. Screenshots
are written beneath `.local/provider-migration/`. Production inventory omission
is asserted by the source tests. The preview intentionally shows both providers
as a synthetic scenario; it is not a claim that Discord is configured.

## Qualification recorded locally

- New milestone unit/contract tests: 57 passed.
- Synthetic browser preview: 8 passed, desktop and mobile; screenshots visually
  inspected for layout, confirmation copy and focus flow.
- Existing Google/provider suite: 117 passed.
- Existing account-sync suite: 321 passed, 1 existing emulator-dependent skip.
- Durable auth readiness: 28 passed.
- Pages release: 111 passed.
- Static performance: 32 passed.
- Trusted Functions export contract: passed, still five fixed callables.
- Production entry files compared byte-for-byte against starting main: unchanged.
- Diff whitespace and changed-JavaScript syntax: checked.

The initial Google run lacked the Functions dependencies; using the existing
local dependency cache fixed that setup issue. The initial IndexedDB/browser
runs could not bind loopback inside the sandbox; approved loopback-only test
runs passed. No provider credential or real account access was involved. The
new PR workflow repeats these source/synthetic checks with read-only repository
permissions and has no deployment step.


## Second milestone qualification

The follow-up adds transactional Firestore state/release receipts, a revoked-token
Firebase authority verifier, a default-off gateway seam, a Web Locks + Firebase
blocking auth commit guard, a complete current-feature candidate collector, full
readonly journal capture and canonical import dry runs. See
[the default backend decision](DISCORD-BACKEND-DECISION.md).

- First commit `40343beb`: all three GitHub workflows completed successfully.
- Updated local unit contracts: 81 passed, 1 emulator-only skip.
- Updated desktop/mobile browser checks: 12 passed, including actual cross-tab
  Web Locks and complete IndexedDB snapshots across reopen.
- Demo Auth/Firestore emulators: 8 passed, including exact Firebase 12.14.0 SDK
  transition blocking, concurrent UID claims and denied private client reads.
- Existing Google tests: 117 passed; account sync: 321 passed, 1 existing skip;
  Pages: 111 passed; static performance: 32 passed.
- Production Firebase auth configuration reads were denied HTTP 403; existing
  staging/production Cloud Run origins were verified read-only. No security
  setting, credential, OAuth grant or data was changed.


## Third candidate milestone

- Scoped independent-review fixes: `f8129217` (operation cancellation and
  transactionally checked provider/subject lifecycle revisions).
- Candidate callback/transport composition: 93 local unit checks passed with
  1 emulator-only skip; 14 desktop/mobile checks passed.
- Expanded demo Auth/Firestore tests: 10 passed, including real custom-token
  sign-in to the same UID, in-flight cancellation and second-review-after-unlink.
- Current callback is source-only and excluded from every release inventory;
  production app bootstrap and service-worker integration remain explicit gates.
- Reviewed head `8e85912c` had green auth/product/Favorite CI and one performance
  failure (202 ms against unchanged 200 ms); paired main/candidate local
  qualification passed 8/8 each without changing budgets or renderer code.
  Final-head CI is being monitored independently of this diagnostic evidence.


## Final isolation qualification

The journal reader now lives in `js/dev/accountRecoveryJournalSnapshot.js`. The
production journal file is restored unchanged; opening a missing database aborts
rather than creating an empty export. Desktop/mobile qualification is 16 passed.
Unit contracts remain 93 passed with 1 emulator-only skip; the 10 demo emulator
checks include both independently reproduced review corrections.

Commit `83b38358` completed all four GitHub workflows successfully, including the
original frontend performance budgets. Earlier performance misses remain
recorded as diagnostics; thresholds and rendering code were never changed. The
final isolation head is separately qualified in CI.
